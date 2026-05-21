"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveAuth = resolveAuth;
const token_crypto_1 = require("../token-crypto");
const mobile_auth_1 = require("../mobile-auth");
const SESSION_TOKEN_RE = /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i;
const MOBILE_TOKEN_RE = /^[0-9a-f]{64}$/i;
function extractBearer(req) {
    const header = req.headers['authorization'];
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
        const token = header.slice('Bearer '.length).trim();
        return token || null;
    }
    // Query-param fallback (used by EventSource / file URLs elsewhere).
    const q = req.query?.token;
    if (typeof q === 'string' && q)
        return q;
    return null;
}
/**
 * Resolve the incoming bearer to a `{ userId, sessionToken }` tuple. Returns
 * null if no/invalid auth was provided — the caller should 401.
 */
async function resolveAuth(req) {
    const bearer = extractBearer(req);
    if (!bearer)
        return null;
    // Mobile token first: 64-hex, looked up in `.mobile-tokens.json`.
    if (MOBILE_TOKEN_RE.test(bearer)) {
        const record = await (0, mobile_auth_1.touchMobileToken)(bearer);
        if (record) {
            return {
                userId: record.userId,
                isMobile: true,
                mobileToken: bearer,
                sessionToken: record.sessionToken,
            };
        }
        // Fall through — could still be a session token in some edge case, though
        // 64-hex collisions with the `iv:ct:tag` format are impossible.
    }
    // Legacy session token: AES-GCM iv:ct:tag triple.
    if (SESSION_TOKEN_RE.test(bearer)) {
        try {
            const payload = (0, token_crypto_1.decryptSession)(bearer);
            return {
                userId: payload.clientKey,
                isMobile: false,
                mobileToken: null,
                sessionToken: bearer,
            };
        }
        catch {
            return null;
        }
    }
    return null;
}
