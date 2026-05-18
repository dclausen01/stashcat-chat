/**
 * Push API routes and dispatcher bootstrap.
 *
 * Routes:
 *   POST   /api/push-tokens                — register/refresh a token
 *   DELETE /api/push-tokens/:token         — unregister
 *   GET    /api/push-tokens                — list own tokens
 *   PATCH  /api/account/push-preferences   — set push preview mode
 *   GET    /api/account/push-preferences   — read push preview mode
 *
 * All routes accept *either* the legacy session token OR the mobile token
 * returned by `/api/auth/mobile-login` as Bearer. The auth-resolution helper
 * lives in `./auth.ts`; these routes are listed in `OPEN_PATH_PREFIXES` so
 * the global `authenticate` middleware (which only handles session tokens)
 * leaves them alone.
 *
 * The dispatcher itself listens on the existing per-session Realtime events
 * (see `connectRealtime` in `server/index.ts`) via the `notifyPush()` helper
 * exported from here. We don't subscribe globally to avoid duplicate handlers.
 */
import { Router, type Request, type Response } from 'express';
import { upsertToken, removeToken, listForUser, pruneOlderThan, type Platform } from './token-store';
import { queueMessageEvent, type IncomingMessageEvent } from './dispatcher';
import { isFcmConfigured, describeFcmConfig } from './fcm-client';
import { resolveAuth, loadMobileTokenFromRequest } from './auth';
import { loadMobileToken, updatePushPreview, type PushPreviewMode } from '../mobile-auth';
import { stashcatUserIdByClientKey } from '../lib/state';
import { getClient } from '../lib/get-client';

const router = Router();

/**
 * Resolve the routing-userId for push-tokens. Prefer the Stashcat user id
 * (stable across sessions of the same user — Phone + Web teilen sich diese
 * ID), fall back to clientKey if we don't have a cache entry yet.
 *
 * Wichtig: Wenn der Caller mit einem mobileToken (64-hex) authentifiziert ist,
 * würde `getClient(req)` an `decryptSession` scheitern. Daher nutzen wir den
 * `sessionToken` aus dem aufgelösten Auth-Record und bauen damit ein
 * fake-req, das `getClient` versteht.
 */
async function resolveRoutingUserId(_req: Request, clientKey: string, sessionToken: string): Promise<string> {
  const cached = stashcatUserIdByClientKey.get(clientKey);
  if (cached) return cached;
  try {
    const fakeReq = { headers: { authorization: `Bearer ${sessionToken}` }, query: {} } as unknown as Request;
    const client = await getClient(fakeReq);
    const me = await client.getMe();
    const id = String((me as unknown as { id?: string | number }).id ?? '');
    if (id) {
      stashcatUserIdByClientKey.set(clientKey, id);
      return id;
    }
  } catch {
    /* getClient/getMe can fail when session is expired; we silently fall back */
  }
  return clientKey;
}

router.post('/push-tokens', async (req: Request, res: Response) => {
  try {
    const auth = await resolveAuth(req);
    if (!auth) return res.status(401).json({ error: 'Unauthorized' });
    const { token, platform, appVersion, locale } = req.body || {};
    if (!token || (platform !== 'android' && platform !== 'ios')) {
      return res.status(400).json({ error: 'token + platform (android|ios) required' });
    }
    const routingUserId = await resolveRoutingUserId(req, auth.userId, auth.sessionToken);
    await upsertToken({
      token,
      userId: routingUserId,
      platform: platform as Platform,
      appVersion,
      locale,
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.delete('/push-tokens/:token', async (req: Request, res: Response) => {
  try {
    const auth = await resolveAuth(req);
    if (!auth) return res.status(401).json({ error: 'Unauthorized' });
    const token = req.params.token;
    if (typeof token !== 'string' || !token) {
      return res.status(400).json({ error: 'token param required' });
    }
    await removeToken(token);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get('/push-tokens', async (req: Request, res: Response) => {
  try {
    const auth = await resolveAuth(req);
    if (!auth) return res.status(401).json({ error: 'Unauthorized' });
    const routingUserId = await resolveRoutingUserId(req, auth.userId, auth.sessionToken);
    const list = await listForUser(routingUserId);
    // Don't leak the raw token; surface a hash-ish prefix only.
    res.json(list.map((r) => ({ ...r, token: r.token.slice(0, 12) + '…' })));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get('/account/push-preferences', async (req: Request, res: Response) => {
  try {
    // Both authentication paths are accepted, but only mobile-token sessions
    // actually have a stored preference. Desktop callers always get 'full'.
    const auth = await resolveAuth(req);
    if (!auth) return res.status(401).json({ error: 'Unauthorized' });
    if (auth.isMobile && auth.mobileToken) {
      const rec = await loadMobileToken(auth.mobileToken);
      return res.json({ pushPreviewMode: rec?.pushPreviewMode ?? 'full' });
    }
    res.json({ pushPreviewMode: 'full' });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.patch('/account/push-preferences', async (req: Request, res: Response) => {
  try {
    const auth = await resolveAuth(req);
    if (!auth) return res.status(401).json({ error: 'Unauthorized' });
    const mode = (req.body?.pushPreviewMode || 'full') as PushPreviewMode;
    if (mode !== 'full' && mode !== 'silent') {
      return res.status(400).json({ error: 'pushPreviewMode must be full|silent' });
    }
    if (auth.isMobile && auth.mobileToken) {
      await updatePushPreview(auth.mobileToken, mode);
      return res.json({ ok: true, pushPreviewMode: mode });
    }
    // No mobile token: silently no-op (desktop sessions don't need this).
    res.json({ ok: true, pushPreviewMode: mode });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/** Called by `connectRealtime()` for every incoming message_sync/notification. */
export function notifyPush(evt: IncomingMessageEvent): void {
  if (!isFcmConfigured()) return;
  try {
    queueMessageEvent(evt);
  } catch (err) {
    console.warn('[Push] queue failed:', (err as Error).message);
  }
}

const DAY = 24 * 60 * 60 * 1000;
const PRUNE_TTL = 90 * DAY;

export function initPushDispatcher(): void {
  const cfg = describeFcmConfig();
  if (!cfg.ok) {
    switch (cfg.reason) {
      case 'disabled':
        console.log('[Push] PUSH_ENABLED=false → dispatcher disabled.');
        break;
      case 'env-missing':
        console.log('[Push] FCM_SERVICE_ACCOUNT env not set → dispatcher disabled. ' +
          'Im Plesk-Panel unter Node.js → Custom Environment Variables setzen.');
        break;
      case 'file-missing':
        console.log(`[Push] Service-Account-Datei nicht gefunden: ${cfg.path}. ` +
          'Pfad in FCM_SERVICE_ACCOUNT prüfen oder Datei dort ablegen (chmod 640).');
        break;
      case 'file-unreadable':
        console.log(`[Push] Service-Account-Datei nicht lesbar/parsebar: ${cfg.path} ` +
          `— ${cfg.error}`);
        break;
    }
    return;
  }
  console.log('[Push] FCM configured. Batch window:', process.env.PUSH_BATCH_MS || 2000, 'ms');
  // Periodic cleanup of stale tokens (every 24h).
  setInterval(() => {
    pruneOlderThan(PRUNE_TTL)
      .then((n) => { if (n > 0) console.log(`[Push] Pruned ${n} stale token(s)`); })
      .catch(() => {});
  }, DAY).unref?.();
}

// Re-export so callers (e.g. dispatcher tests) can still grab a mobile token.
export { loadMobileTokenFromRequest };

export default router;
