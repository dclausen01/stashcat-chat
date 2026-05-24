import type express from 'express';
import { StashcatClient, type RealtimeManager } from 'stashcat-api';

// ── Chat Bot cache (for video meetings) ──────────────────────────────────────
export interface BotInfo {
  botUserId: string;
  botConvId: string;
}
/** keyed by clientKey */
export const botCache = new Map<string, BotInfo>();

// ── Pre-Auth cache (short-lived, for multi-step login) ───────────────────────
export interface PreAuthEntry {
  client: StashcatClient;
  createdAt: number;
  expiresAt: number;
  loginPassword?: string;
  encryptedKeyData?: string;
}
export const preAuthCache = new Map<string, PreAuthEntry>();
export const PREAUTH_TTL = 5 * 60 * 1000; // 5 minutes
export const PREAUTH_MAX_ENTRIES = 100;

// Cleanup expired preAuth entries periodically.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of preAuthCache) {
    if (now > entry.expiresAt) preAuthCache.delete(key);
  }
}, 60_000);

/** Consume a preAuthToken, validating TTL. Returns client + loginPassword. */
export function consumePreAuthToken(preAuthToken: string): { client: StashcatClient; loginPassword?: string } | null {
  const entry = preAuthCache.get(preAuthToken);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    preAuthCache.delete(preAuthToken);
    return null;
  }
  preAuthCache.delete(preAuthToken);
  return { client: entry.client, loginPassword: entry.loginPassword };
}

// ── SSE connection tracking ──────────────────────────────────────────────────
export interface SSEConnection {
  client: StashcatClient;
  realtime?: RealtimeManager;
  sseClients: Set<express.Response>;
  /**
   * Stashcat-User-ID (`me.id`) — wird beim ersten `connectRealtime` einmal
   * gecached. Wir routen Push-Tokens und FCM-Fan-out über diese ID statt über
   * den per-Session `clientKey`, damit eine `notification` an Session A (z.B.
   * Web-Browser) trotzdem die FCM-Tokens findet, die unter Session B (z.B.
   * Mobile-App) registriert wurden.
   */
  stashcatUserId?: string;
}
/** keyed by clientKey */
export const activeSSE = new Map<string, SSEConnection>();

/**
 * Globaler Lookup `clientKey → stashcatUserId`. Wird parallel zu activeSSE
 * gepflegt, damit Push-Token-Routes (die nicht über activeSSE laufen)
 * trotzdem an die User-ID kommen, ohne pro Request einen `getMe()`-Call
 * machen zu müssen.
 */
export const stashcatUserIdByClientKey = new Map<string, string>();

/**
 * Liefert die Achse, unter der Push-Tokens für diese Session indiziert sind:
 * primaer die Stashcat-User-ID (stabil ueber Sessions desselben Users),
 * Fallback auf den per-Session clientKey, wenn die User-ID noch nicht
 * gecached wurde. MUSS sowohl beim Speichern als auch beim Lookup verwendet
 * werden — sonst greift „realtime fuer push-only halten" nie und Mobile-User
 * verlieren ihre Push-Pipeline, sobald die Web-Session geschlossen wird.
 */
export function getRoutingUserId(clientKey: string): string {
  return activeSSE.get(clientKey)?.stashcatUserId
    ?? stashcatUserIdByClientKey.get(clientKey)
    ?? clientKey;
}

export function pushSSE(clientKey: string, event: string, data: unknown) {
  const conn = activeSSE.get(clientKey);
  if (!conn) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of conn.sseClients) {
    try {
      res.write(payload);
      if (typeof (res as unknown as Record<string, unknown>).flush === 'function') {
        (res as unknown as { flush: () => void }).flush();
      }
    } catch { conn.sseClients.delete(res); }
  }
}
