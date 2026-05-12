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
}
/** keyed by clientKey */
export const activeSSE = new Map<string, SSEConnection>();

/** Pending key_sync_request events received via Socket.io, keyed by clientKey → userId → event payload */
export const pendingKeyRequests = new Map<string, Map<string, unknown>>();

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
