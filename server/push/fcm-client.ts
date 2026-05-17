/**
 * Minimal FCM HTTP v1 client.
 *
 * Reads a Google service-account JSON file (path in env `FCM_SERVICE_ACCOUNT`),
 * mints a short-lived OAuth access token via the standard signed-JWT bearer
 * flow, and posts FCM messages to
 *   https://fcm.googleapis.com/v1/projects/<id>/messages:send
 *
 * We deliberately avoid `firebase-admin` — it pulls a huge dep tree for the
 * trivial subset we need.
 */
import { readFileSync, existsSync, appendFileSync } from 'fs';
import { sign } from 'jsonwebtoken';
import path from 'path';

const SERVICE_ACCOUNT_PATH = process.env.FCM_SERVICE_ACCOUNT || '';
const PUSH_ERROR_LOG = path.join(process.cwd(), '.push-errors.log');

interface ServiceAccount {
  client_email: string;
  private_key: string;
  project_id: string;
  token_uri?: string;
}

let serviceAccount: ServiceAccount | null = null;
let accessToken: { value: string; expiresAt: number } | null = null;

/** Reasons the FCM dispatcher might be inactive — surfaced at startup so the
 *  ops team can debug ohne Quelltext zu lesen. */
export type FcmConfigStatus =
  | { ok: true }
  | { ok: false; reason: 'env-missing' }
  | { ok: false; reason: 'file-missing'; path: string }
  | { ok: false; reason: 'file-unreadable'; path: string; error: string }
  | { ok: false; reason: 'disabled' };

function loadServiceAccount(): ServiceAccount | null {
  if (serviceAccount) return serviceAccount;
  if (!SERVICE_ACCOUNT_PATH || !existsSync(SERVICE_ACCOUNT_PATH)) return null;
  try {
    serviceAccount = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, 'utf8')) as ServiceAccount;
    return serviceAccount;
  } catch (err) {
    console.warn('[FCM] Failed to read service account:', (err as Error).message);
    return null;
  }
}

export function describeFcmConfig(): FcmConfigStatus {
  if (process.env.PUSH_ENABLED === 'false') return { ok: false, reason: 'disabled' };
  if (!SERVICE_ACCOUNT_PATH) return { ok: false, reason: 'env-missing' };
  if (!existsSync(SERVICE_ACCOUNT_PATH)) {
    return { ok: false, reason: 'file-missing', path: SERVICE_ACCOUNT_PATH };
  }
  try {
    JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: 'file-unreadable',
      path: SERVICE_ACCOUNT_PATH,
      error: (err as Error).message,
    };
  }
}

export function isFcmConfigured(): boolean {
  return loadServiceAccount() !== null && process.env.PUSH_ENABLED !== 'false';
}

function logError(msg: string): void {
  try {
    appendFileSync(PUSH_ERROR_LOG, `[${new Date().toISOString()}] ${msg}\n`);
  } catch { /* noop */ }
  console.warn('[FCM]', msg);
}

async function getAccessToken(): Promise<string | null> {
  if (accessToken && accessToken.expiresAt > Date.now() + 60_000) {
    return accessToken.value;
  }
  const sa = loadServiceAccount();
  if (!sa) return null;

  const now = Math.floor(Date.now() / 1000);
  const jwt = sign(
    {
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: sa.token_uri || 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    },
    sa.private_key,
    { algorithm: 'RS256' },
  );

  try {
    const res = await fetch(sa.token_uri || 'https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }).toString(),
    });
    if (!res.ok) {
      logError(`OAuth token request failed: ${res.status} ${await res.text().catch(() => '')}`);
      return null;
    }
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) return null;
    accessToken = {
      value: json.access_token,
      expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
    };
    return accessToken.value;
  } catch (err) {
    logError(`OAuth fetch failed: ${(err as Error).message}`);
    return null;
  }
}

export type Platform = 'android' | 'ios';

export interface FcmMessageInput {
  token: string;
  platform: Platform;
  title: string;
  body: string;
  data?: Record<string, string>;
  badge?: number;
  /** Whether the payload should suppress message content (`silent`). */
  silent?: boolean;
}

function buildPayload(input: FcmMessageInput): Record<string, unknown> {
  const data: Record<string, string> = { ...(input.data ?? {}) };
  // Always include title/body in data so Android can render the banner from
  // data-only messages (high priority, works when app is killed).
  // Defensive defaults — FCM weigert sich, JSON mit `undefined`-Werten zu
  // akzeptieren, und Flutter würde sonst leeren Banner-Title sehen.
  data.title = input.title || 'Neue Nachricht';
  data.body = input.silent ? '' : (input.body || '');

  if (input.platform === 'ios') {
    return {
      token: input.token,
      notification: {
        title: input.title,
        body: input.silent ? '' : input.body,
      },
      apns: {
        headers: { 'apns-priority': '10' },
        payload: {
          aps: {
            'mutable-content': 1,
            sound: 'default',
            ...(typeof input.badge === 'number' ? { badge: input.badge } : {}),
          },
        },
      },
      data,
    };
  }
  // Android: data-only, high priority. Flutter renders the local notification.
  return {
    token: input.token,
    android: { priority: 'HIGH' },
    data,
  };
}

export async function sendFcm(input: FcmMessageInput): Promise<boolean> {
  if (!isFcmConfigured()) return false;
  const sa = loadServiceAccount();
  const token = await getAccessToken();
  if (!sa || !token) return false;
  const url = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: buildPayload(input) }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logError(`FCM send failed (${res.status}) for token ${input.token.slice(0, 12)}…: ${text.slice(0, 400)}`);
      return false;
    }
    console.log(`[FCM] sent ${input.platform} → token ${input.token.slice(0, 12)}… ("${input.title}")`);
    return true;
  } catch (err) {
    logError(`FCM send threw: ${(err as Error).message}`);
    return false;
  }
}
