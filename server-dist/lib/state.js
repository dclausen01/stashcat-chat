"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pendingKeyRequests = exports.activeSSE = exports.PREAUTH_MAX_ENTRIES = exports.PREAUTH_TTL = exports.preAuthCache = exports.botCache = void 0;
exports.consumePreAuthToken = consumePreAuthToken;
exports.pushSSE = pushSSE;
/** keyed by clientKey */
exports.botCache = new Map();
exports.preAuthCache = new Map();
exports.PREAUTH_TTL = 5 * 60 * 1000; // 5 minutes
exports.PREAUTH_MAX_ENTRIES = 100;
// Cleanup expired preAuth entries periodically.
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of exports.preAuthCache) {
        if (now > entry.expiresAt)
            exports.preAuthCache.delete(key);
    }
}, 60_000);
/** Consume a preAuthToken, validating TTL. Returns client + loginPassword. */
function consumePreAuthToken(preAuthToken) {
    const entry = exports.preAuthCache.get(preAuthToken);
    if (!entry)
        return null;
    if (Date.now() > entry.expiresAt) {
        exports.preAuthCache.delete(preAuthToken);
        return null;
    }
    exports.preAuthCache.delete(preAuthToken);
    return { client: entry.client, loginPassword: entry.loginPassword };
}
/** keyed by clientKey */
exports.activeSSE = new Map();
/** Pending key_sync_request events received via Socket.io, keyed by clientKey → userId → event payload */
exports.pendingKeyRequests = new Map();
function pushSSE(clientKey, event, data) {
    const conn = exports.activeSSE.get(clientKey);
    if (!conn)
        return;
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of conn.sseClients) {
        try {
            res.write(payload);
            if (typeof res.flush === 'function') {
                res.flush();
            }
        }
        catch {
            conn.sseClients.delete(res);
        }
    }
}
