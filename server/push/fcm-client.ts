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
import { serverLog } from '../lib/logging';

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
    serverLog('[FCM] Failed to read service account:', (err as Error).message);
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
  // Doppelt — einmal in der dedizierten Fehlerdatei (Audit), einmal im
  // server.log via serverLog, damit diagnostische Korrelation moeglich ist.
  serverLog('[FCM]', msg);
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
  /**
   * Stable identifier zum Zusammenfassen aufeinanderfolgender Notifications.
   * Android: nutzt das als `android.notification.tag` → mehrere Pushs mit
   * demselben Tag überschreiben sich, statt zu stapeln.
   * iOS: nutzt das als `apns-collapse-id` (selber Effekt).
   * Konvention: `"c/<channelId>"` für Channels, `"d/<conversationId>"` für DMs.
   * Default (wenn nicht gesetzt): pro-Push eigener Eintrag.
   */
  collapseKey?: string;
}

// 24 Stunden TTL — FCM hält die Nachricht für offline Devices länger vor.
// Default ist 4 Wochen, aber wir wollen alte Backlogs nicht durchspielen
// (User loggt sich nach 1 Woche Urlaub ein → keine 100 alten Banner).
const TTL_SECONDS = 24 * 60 * 60;

function buildPayload(input: FcmMessageInput): Record<string, unknown> {
  const data: Record<string, string> = { ...(input.data ?? {}) };
  // Always include title/body in data so Android can render the banner from
  // data-only messages (high priority, works when app is killed).
  // Defensive defaults — FCM weigert sich, JSON mit `undefined`-Werten zu
  // akzeptieren, und Flutter würde sonst leeren Banner-Title sehen.
  data.title = input.title || 'Neue Nachricht';
  data.body = input.silent ? '' : (input.body || '');
  // Marker, damit Flutter im Background-Handler entscheiden kann, ob es
  // selbst eine Local-Notification anzeigen muss oder die System-Notification
  // (notification-Block) schon angezeigt wurde.
  data.hasNotification = 'true';

  const title = input.title || 'Neue Nachricht';
  const body = input.silent ? '' : (input.body || '');

  // Per-Chat collapseKey, damit aufeinanderfolgende Nachrichten im selben
  // Chat/Channel den vorherigen Banner-Eintrag ersetzen (statt zu stapeln),
  // verschiedene Chats aber jeweils eine eigene Notification haben.
  // Fallback `'bbz-chat-msg'` falls aus irgendeinem Grund kein Key kommt.
  const collapseKey = input.collapseKey || 'bbz-chat-msg';

  if (input.platform === 'ios') {
    // iOS: notification-Block sorgt für Lockscreen-Rendering. APNs hält das
    // bei Offline-Devices länger vor als reine data-only-Pushes.
    const expirationSeconds = Math.floor(Date.now() / 1000) + TTL_SECONDS;
    return {
      token: input.token,
      notification: { title, body },
      apns: {
        headers: {
          'apns-priority': '10',
          'apns-expiration': String(expirationSeconds),
          // Ersetzt eine vorhandene Notification mit derselben collapse-id im
          // Notification-Center, statt sie zu stapeln.
          'apns-collapse-id': collapseKey,
        },
        payload: {
          aps: {
            'mutable-content': 1,
            sound: 'default',
            // thread-id gruppiert Notifications visuell pro Chat (iOS 12+):
            // im Notification-Center werden alle Nachrichten desselben Chats
            // aufgeklappt in eine Gruppe gepackt.
            'thread-id': collapseKey,
            ...(typeof input.badge === 'number' ? { badge: input.badge } : {}),
          },
        },
      },
      data,
    };
  }
  // Android: hybrid notification + data.
  // - System rendert das Banner aus dem notification-Block (zuverlässig auch
  //   nach längerer Offline-Zeit, weil FCM notification-Payloads länger hält
  //   als data-only).
  // - data enthält die strukturierten Felder (deeplink, channelName, …) und
  //   einen `hasNotification`-Marker, damit Flutter weiß: System rendert das
  //   schon — nicht zusätzlich eine Local-Notification rendern, sonst Doppel-
  //   Banner.
  // - android.ttl: 24h, damit Pushs nach Flugmodus / längerer Offline-Phase
  //   noch zugestellt werden, statt von FCM verworfen zu werden.
  return {
    token: input.token,
    notification: { title, body },
    android: {
      priority: 'HIGH',
      ttl: `${TTL_SECONDS}s`,
      // collapse_key reduziert die Anzahl der zugestellten Pushs im selben
      // Chat, falls das Device länger offline war (Doc: "android.collapse_key").
      collapse_key: collapseKey,
      notification: {
        // tag: aufeinanderfolgende Pushs im selben Chat ersetzen einander
        // im Notification-Drawer. Verschiedene Chats → verschiedene Tags
        // → eigene Notifications.
        tag: collapseKey,
      },
    },
    data,
  };
}

/**
 * Outcome eines sendFcm-Aufrufs.
 *
 * `permanentFailure` bedeutet: der Token ist dauerhaft ungueltig (FCM
 * `UNREGISTERED`/`INVALID_ARGUMENT`) und sollte vom Caller aus dem Store
 * entfernt werden. `transientFailure` ist ein temporaerer Fehler (Quota,
 * 5xx, Netzwerk) — Token behalten, nur loggen.
 */
export type FcmSendResult =
  | { ok: true }
  | { ok: false; permanentFailure: boolean };

/** FCM-HTTP-v1 Fehler-Codes, die einen Token dauerhaft kaputt machen. */
const PERMANENT_FAILURE_CODES = new Set([
  'UNREGISTERED',
  'INVALID_ARGUMENT',
  'SENDER_ID_MISMATCH',
  'NOT_FOUND',
]);

function isPermanentFcmFailure(status: number, body: string): boolean {
  // 404 = Token unbekannt (UNREGISTERED). 400 = manchmal INVALID_ARGUMENT
  // (z.B. korrupter Token).
  if (status === 404) return true;
  if (status !== 400) return false;
  try {
    const parsed = JSON.parse(body) as { error?: { details?: Array<{ errorCode?: string }> } };
    const details = parsed?.error?.details ?? [];
    return details.some((d) => typeof d.errorCode === 'string' && PERMANENT_FAILURE_CODES.has(d.errorCode));
  } catch {
    return false;
  }
}

export async function sendFcm(input: FcmMessageInput): Promise<FcmSendResult> {
  if (!isFcmConfigured()) return { ok: false, permanentFailure: false };
  const sa = loadServiceAccount();
  const token = await getAccessToken();
  if (!sa || !token) return { ok: false, permanentFailure: false };
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
      const permanent = isPermanentFcmFailure(res.status, text);
      logError(`FCM send failed (${res.status}, ${permanent ? 'PERMANENT' : 'transient'}) for token ${input.token.slice(0, 12)}…: ${text.slice(0, 400)}`);
      return { ok: false, permanentFailure: permanent };
    }
    serverLog(`[FCM] sent ${input.platform} → token ${input.token.slice(0, 12)}… ("${input.title}")`);
    return { ok: true };
  } catch (err) {
    logError(`FCM send threw: ${(err as Error).message}`);
    return { ok: false, permanentFailure: false };
  }
}
