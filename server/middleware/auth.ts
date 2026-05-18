import type express from 'express';
import type { StashcatClient } from 'stashcat-api';
import { getClient } from '../lib/get-client';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /**
       * The unlocked StashcatClient for this session, injected by
       * `authenticate`. Only present on routes that go through the
       * middleware — open routes (login, SSE, OnlyOffice downloads)
       * still resolve the client themselves where needed.
       */
      client?: StashcatClient;
    }
  }
}

/**
 * Paths under `/api/` that must bypass the authenticate middleware.
 * - login/logout flows: no Bearer token yet, or token may be stale.
 * - /api/events: SSE endpoint handles auth itself to return its own status code.
 * - OnlyOffice downloads: authenticated via `?secret=` token, not Bearer.
 */
const OPEN_PATHS = new Set<string>([
  '/api/login',
  '/api/login/credentials',
  '/api/login/password',
  '/api/login/device/initiate',
  '/api/login/device/complete',
  '/api/logout',
  '/api/auth/mobile-login',
  '/api/auth/mobile-session',
  '/api/auth/mobile-logout',
  '/api/events',
  '/api/onlyoffice/dl',
  '/api/onlyoffice/dl-nc',
  // Public runtime config — keine sensitiven Daten, vor Login lesbar damit
  // das Frontend schon auf der Loginseite konsistente URLs verwenden kann.
  '/api/config',
]);

/**
 * Paths that accept *either* the legacy session token or the mobile token
 * issued by `/api/auth/mobile-login`. The route handler is responsible for
 * resolving the bearer token itself (see `server/push/auth.ts`).
 */
const OPEN_PATH_PREFIXES = [
  '/api/push-tokens',
  '/api/account/push-preferences',
];

/**
 * Resolves the session's StashcatClient via the Bearer token (or `?token=`
 * query fallback) and attaches it to `req.client`. On any failure responds
 * 401 — the route handler never runs.
 */
export async function authenticate(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): Promise<void> {
  if (
    !req.path.startsWith('/api/') ||
    OPEN_PATHS.has(req.path) ||
    OPEN_PATH_PREFIXES.some((p) => req.path === p || req.path.startsWith(`${p}/`))
  ) {
    return next();
  }
  try {
    req.client = await getClient(req);
    next();
  } catch (err) {
    res.status(401).json({ error: err instanceof Error ? err.message : 'Unauthorized' });
  }
}
