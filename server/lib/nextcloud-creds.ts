import type express from 'express';
import { decryptSession } from '../token-crypto';
import { extractToken } from './get-client';
import type { NCCredentials } from '../nextcloud';

export interface NCCredsResult {
  creds: NCCredentials;
  authMode: 'ad' | 'app-password';
}

/**
 * Resolve NC credentials for the current request.
 * Password priority: X-NC-App-Password header > loginPassword from session token.
 * Username priority: X-NC-Username header > derived from user profile (Last, First).
 */
export async function getNCCreds(req: express.Request): Promise<NCCredsResult | null> {
  const token = extractToken(req);
  const payload = decryptSession(token);

  const appPassword = (req.headers['x-nc-app-password'] as string | undefined)
    ?? (req.query.ncAppPw as string | undefined);
  const usernameOverride = (req.headers['x-nc-username'] as string | undefined)
    ?? (req.query.ncUser as string | undefined);

  const password = appPassword ?? payload.loginPassword;
  if (!password) return null;

  let username = usernameOverride;
  if (!username) {
    const client = req.client!;
    const me = await client.getMe() as unknown as Record<string, unknown>;
    username = `${me.last_name || ''}, ${me.first_name || ''}`.trim() || String(me.email || '');
  }
  if (!username) return null;

  const baseUrl = (process.env.NEXTCLOUD_URL || 'https://cloud.bbz-rd-eck.de').replace(/\/+$/, '');
  return {
    creds: { baseUrl, username, password },
    authMode: appPassword ? 'app-password' : 'ad',
  };
}

/** Convenience wrapper — returns only the NCCredentials (no authMode). */
export async function getNCCred(req: express.Request): Promise<NCCredentials | null> {
  return (await getNCCreds(req))?.creds ?? null;
}
