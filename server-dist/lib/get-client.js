"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CACHE_TTL = void 0;
exports.cacheClient = cacheClient;
exports.touchCachedClient = touchCachedClient;
exports.invalidateClient = invalidateClient;
exports.extractToken = extractToken;
exports.getClient = getClient;
const stashcat_api_1 = require("stashcat-api");
const token_crypto_1 = require("../token-crypto");
exports.CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const clientCache = new Map();
const pendingClients = new Map();
// Sweep expired entries once a minute.
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of clientCache) {
        if (now > entry.expiresAt)
            clientCache.delete(key);
    }
}, 60_000).unref?.();
/** Stores an already-unlocked client with a full TTL. */
function cacheClient(clientKey, client) {
    clientCache.set(clientKey, { client, expiresAt: Date.now() + exports.CACHE_TTL });
}
/**
 * Returns the cached client if present (regardless of TTL state) and refreshes
 * its TTL. Used by the SSE heartbeat and the file-download endpoint to keep a
 * session warm while it's actively in use.
 */
function touchCachedClient(clientKey) {
    const cached = clientCache.get(clientKey);
    if (!cached)
        return undefined;
    cached.expiresAt = Date.now() + exports.CACHE_TTL;
    return cached.client;
}
/** Drops the cache entry — call on logout. */
function invalidateClient(clientKey) {
    clientCache.delete(clientKey);
}
/** Extracts the Bearer token (or `?token=` fallback for EventSource/file URLs). */
function extractToken(req) {
    const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
    if (!token)
        throw new Error('No token');
    return token;
}
/**
 * Resolves (or creates and unlocks) the `StashcatClient` for the request.
 * Coalesces concurrent initializations of the same session via `pendingClients`
 * so we never run two `unlockE2E` calls in parallel for the same clientKey.
 */
async function getClient(req) {
    const token = extractToken(req);
    const payload = (0, token_crypto_1.decryptSession)(token);
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
            const client = stashcat_api_1.StashcatClient.fromSession({ deviceId, clientKey }, { baseUrl });
            if (securityPassword) {
                await client.unlockE2E(securityPassword);
            }
            else if (privateKeyJwk) {
                await client.unlockE2EWithPrivateKey(privateKeyJwk);
            }
            else {
                throw new Error('Session has no E2E unlock material');
            }
            cacheClient(clientKey, client);
            return client;
        }
        finally {
            pendingClients.delete(clientKey);
        }
    })();
    pendingClients.set(clientKey, initPromise);
    return initPromise;
}
