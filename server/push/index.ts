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
 * The dispatcher itself listens on the existing per-session Realtime events
 * (see `connectRealtime` in `server/index.ts`) via the `notifyPush()` helper
 * exported from here. We don't subscribe globally to avoid duplicate handlers.
 */
import { Router, type Request, type Response } from 'express';
import { extractToken } from '../lib/get-client';
import { decryptSession } from '../token-crypto';
import { upsertToken, removeToken, listForUser, pruneOlderThan, type Platform } from './token-store';
import { queueMessageEvent, type IncomingMessageEvent } from './dispatcher';
import { isFcmConfigured } from './fcm-client';
import {
  loadMobileToken,
  updatePushPreview,
  extractMobileToken,
  type PushPreviewMode,
} from '../mobile-auth';

const router = Router();

function userIdFromSession(req: Request): string {
  const token = extractToken(req);
  const payload = decryptSession(token);
  // Stashcat user identity is *not* directly in the session — but the
  // clientKey is a stable per-user value and serves as our routing key.
  return payload.clientKey;
}

router.post('/push-tokens', async (req: Request, res: Response) => {
  try {
    const userId = userIdFromSession(req);
    const { token, platform, appVersion, locale } = req.body || {};
    if (!token || (platform !== 'android' && platform !== 'ios')) {
      return res.status(400).json({ error: 'token + platform (android|ios) required' });
    }
    await upsertToken({
      token,
      userId,
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
    await removeToken(req.params.token);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get('/push-tokens', async (req: Request, res: Response) => {
  try {
    const userId = userIdFromSession(req);
    const list = await listForUser(userId);
    // Don't leak the raw token; surface a hash-ish prefix only.
    res.json(list.map((r) => ({ ...r, token: r.token.slice(0, 12) + '…' })));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.get('/account/push-preferences', async (req: Request, res: Response) => {
  try {
    const mobileToken = extractMobileToken(req as unknown as { headers: Record<string, string | string[] | undefined> });
    if (mobileToken) {
      const rec = await loadMobileToken(mobileToken);
      return res.json({ pushPreviewMode: rec?.pushPreviewMode ?? 'full' });
    }
    res.json({ pushPreviewMode: 'full' });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

router.patch('/account/push-preferences', async (req: Request, res: Response) => {
  try {
    const mode = (req.body?.pushPreviewMode || 'full') as PushPreviewMode;
    if (mode !== 'full' && mode !== 'silent') {
      return res.status(400).json({ error: 'pushPreviewMode must be full|silent' });
    }
    const mobileToken = extractMobileToken(req as unknown as { headers: Record<string, string | string[] | undefined> });
    if (mobileToken) {
      await updatePushPreview(mobileToken, mode);
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
  if (!isFcmConfigured()) {
    console.log('[Push] FCM not configured — dispatcher disabled.');
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

export default router;
