import type express from 'express';
import { StashcatClient } from 'stashcat-api';
import { decryptSession } from '../token-crypto';

/**
 * Resolves the per-session `StashcatClient` from a request token, with a
 * TTL-bounded in-memory cache. Login and session-restore code paths can also
 * populate the cache directly via `cacheClient` once they have a fully
 * unlocked client, and `invalidateClient` removes an entry on logout.
 */

interface CachedClient {
  client: StashcatClient;
  expiresAt: number;
}

export const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

const clientCache = new Map<string, CachedClient>();
const pendingClients = new Map<string, Promise<StashcatClient>>();

// Sweep expired entries once a minute.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of clientCache) {
    if (now > entry.expiresAt) clientCache.delete(key);
  }
}, 60_000).unref?.();

/** Stores an already-unlocked client with a full TTL. */
export function cacheClient(clientKey: string, client: StashcatClient): void {
  clientCache.set(clientKey, { client, expiresAt: Date.now() + CACHE_TTL });
}

/**
 * Returns the cached client if present (regardless of TTL state) and refreshes
 * its TTL. Used by the SSE heartbeat and the file-download endpoint to keep a
 * session warm while it's actively in use.
 */
export function touchCachedClient(clientKey: string): StashcatClient | undefined {
  const cached = clientCache.get(clientKey);
  if (!cached) return undefined;
  cached.expiresAt = Date.now() + CACHE_TTL;
  return cached.client;
}

/** Drops the cache entry — call on logout. */
export function invalidateClient(clientKey: string): void {
  clientCache.delete(clientKey);
}

/** Extracts the Bearer token (or `?token=` fallback for EventSource/file URLs). */
export function extractToken(req: express.Request): string {
  const token = req.headers.authorization?.replace('Bearer ', '') || (req.query.token as string);
  if (!token) throw new Error('No token');
  return token;
}

/**
 * Resolves (or creates and unlocks) the `StashcatClient` for the request.
 * Coalesces concurrent initializations of the same session via `pendingClients`
 * so we never run two `unlockE2E` calls in parallel for the same clientKey.
 */
export async function getClient(req: express.Request): Promise<StashcatClient> {
  const token = extractToken(req);
  const payload = decryptSession(token);
  const { clientKey, deviceId, baseUrl, securityPassword, privateKeyJwk } = payload;

  const cached = clientCache.get(clientKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.client;
  }

  const pending = pendingClients.get(clientKey);
  if (pending) {
    console.log(`[getClient] clientKey=${clientKey?.slice(0, 8)} waiting for pending initialization...`);
    return pending;
  }

  const initPromise = (async () => {
    try {
      console.log(`[getClient] clientKey=${clientKey?.slice(0, 8)} initializing new client...`);
      const client = StashcatClient.fromSession({ deviceId, clientKey }, { baseUrl });

      if (securityPassword) {
        await client.unlockE2E(securityPassword);
      } else if (privateKeyJwk) {
        await client.unlockE2EWithPrivateKey(privateKeyJwk);
      } else {
        throw new Error('Session has no E2E unlock material');
      }

      cacheClient(clientKey, client);
      return client;
    } finally {
      pendingClients.delete(clientKey);
    }
  })();

  pendingClients.set(clientKey, initPromise);
  return initPromise;
}
