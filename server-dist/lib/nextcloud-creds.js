"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNCCreds = getNCCreds;
exports.getNCCred = getNCCred;
const token_crypto_1 = require("../token-crypto");
const get_client_1 = require("./get-client");
/**
 * Resolve NC credentials for the current request.
 * Password priority: X-NC-App-Password header > loginPassword from session token.
 * Username priority: X-NC-Username header > derived from user profile (Last, First).
 */
async function getNCCreds(req) {
    const token = (0, get_client_1.extractToken)(req);
    const payload = (0, token_crypto_1.decryptSession)(token);
    const appPassword = req.headers['x-nc-app-password']
        ?? req.query.ncAppPw;
    const usernameOverride = req.headers['x-nc-username']
        ?? req.query.ncUser;
    const password = appPassword ?? payload.loginPassword;
    if (!password)
        return null;
    let username = usernameOverride;
    if (!username) {
        const client = req.client;
        const me = await client.getMe();
        username = `${me.last_name || ''}, ${me.first_name || ''}`.trim() || String(me.email || '');
    }
    if (!username)
        return null;
    const baseUrl = (process.env.NEXTCLOUD_URL || 'https://cloud.bbz-rd-eck.de').replace(/\/+$/, '');
    return {
        creds: { baseUrl, username, password },
        authMode: appPassword ? 'app-password' : 'ad',
    };
}
/** Convenience wrapper — returns only the NCCredentials (no authMode). */
async function getNCCred(req) {
    return (await getNCCreds(req))?.creds ?? null;
}
