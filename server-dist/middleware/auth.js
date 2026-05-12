"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticate = authenticate;
const get_client_1 = require("../lib/get-client");
/**
 * Paths under `/api/` that must bypass the authenticate middleware.
 * - login/logout flows: no Bearer token yet, or token may be stale.
 * - /api/events: SSE endpoint handles auth itself to return its own status code.
 * - OnlyOffice downloads: authenticated via `?secret=` token, not Bearer.
 */
const OPEN_PATHS = new Set([
    '/api/login',
    '/api/login/credentials',
    '/api/login/password',
    '/api/login/device/initiate',
    '/api/login/device/complete',
    '/api/logout',
    '/api/events',
    '/api/onlyoffice/dl',
    '/api/onlyoffice/dl-nc',
]);
/**
 * Resolves the session's StashcatClient via the Bearer token (or `?token=`
 * query fallback) and attaches it to `req.client`. On any failure responds
 * 401 — the route handler never runs.
 */
async function authenticate(req, res, next) {
    if (!req.path.startsWith('/api/') || OPEN_PATHS.has(req.path)) {
        return next();
    }
    try {
        req.client = await (0, get_client_1.getClient)(req);
        next();
    }
    catch (err) {
        res.status(401).json({ error: err instanceof Error ? err.message : 'Unauthorized' });
    }
}
