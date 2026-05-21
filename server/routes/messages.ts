import { Router } from 'express';
import { decryptMessageInPlace } from '../lib/decrypt';
import { debugLog, errorMessage, serverLog } from '../lib/logging';

const router = Router();

// ── Specific message routes MUST come before the generic :type/:targetId routes ──

router.post('/messages/:messageId/like', async (req, res) => {
  try {
    const client = req.client!;
    await client.likeMessage(req.params.messageId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.get('/messages/:messageId/likes', async (req, res) => {
  try {
    const client = req.client!;
    const likes = await client.listLikes(req.params.messageId);
    res.json({ likes });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.post('/messages/:messageId/unlike', async (req, res) => {
  try {
    const client = req.client!;
    await client.unlikeMessage(req.params.messageId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.delete('/messages/:messageId', async (req, res) => {
  try {
    const client = req.client!;
    await client.deleteMessage(req.params.messageId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.post('/messages/:messageId/flag', async (req, res) => {
  try {
    const client = req.client!;
    await client.flagMessage(req.params.messageId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.post('/messages/:messageId/unflag', async (req, res) => {
  try {
    const client = req.client!;
    await client.unflagMessage(req.params.messageId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.get('/messages/:type/:targetId/flagged', async (req, res) => {
  try {
    const client = req.client!;
    const { type, targetId } = req.params;
    const chatType = type as 'channel' | 'conversation';
    const limit = Number(req.query.limit) || 50;
    const offset = Number(req.query.offset) || 0;

    const messages = await client.getFlaggedMessages(chatType, targetId, { limit, offset });

    for (const msg of messages as unknown as Array<Record<string, unknown>>) {
      await decryptMessageInPlace(client, msg, {
        fallback: '[Nachricht konnte nicht entschlüsselt werden]',
        onError: (err) => serverLog('[flaggedMessages] Failed to decrypt:', errorMessage(err)),
      });
    }

    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.get('/messages/:type/:targetId/search', async (req, res) => {
  try {
    const client = req.client!;
    const { type, targetId } = req.params;
    const chatType = type as 'channel' | 'conversation';
    const startDate = Number(req.query.startDate) || 0;
    const endDate = Number(req.query.endDate) || Math.floor(Date.now() / 1000);
    const query = (req.query.query as string) || '';
    const offset = Number(req.query.offset) || 0;
    const limit = Number(req.query.limit) || 100;

    const searchParams: Record<string, unknown> = {
      start_time: startDate,
      end_time: endDate,
      offset,
      limit,
    };
    if (chatType === 'conversation') searchParams.conversation_id = targetId;
    else searchParams.channel_id = targetId;

    const data = client.api.createAuthenticatedRequestData(searchParams);
    const result = await client.api.post<{ messages: Array<Record<string, unknown>> }>('/search/messages', data);
    let messages = result.messages || [];

    for (const msg of messages) {
      await decryptMessageInPlace(client, msg);
    }

    if (query) {
      const q = query.toLowerCase();
      messages = messages.filter(m => typeof m.text === 'string' && m.text.toLowerCase().includes(q));
    }

    const sorted = [...messages].sort(
      (a, b) => (Number(a.time) || 0) - (Number(b.time) || 0)
    );

    res.json({ messages: sorted, hasMore: messages.length >= limit });
  } catch (err) {
    debugLog(`[searchMessages] ERROR: ${errorMessage(err)}`);
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.get('/messages/:type/:targetId', async (req, res) => {
  const client = req.client!;
  try {
    const { type, targetId } = req.params;
    const limit = Number(req.query.limit) || 40;
    const offset = Number(req.query.offset) || 0;
    const chatType = type as 'channel' | 'conversation';
    debugLog(`[getMessages:route] type=${chatType} targetId=${targetId} E2E_unlocked=${client.isE2EUnlocked()}`);
    if (chatType === 'channel') {
      try {
        const ch = await client.getChannelInfo(targetId, true);
        const allKeys = Object.keys(ch).filter(k => k.includes('key') || k.includes('encryption') || k.includes('crypt'));
        debugLog(`[channel-info] id=${targetId} allKeyFields=${JSON.stringify(allKeys)} keyLength=${ch.key?.length} fullJson=${JSON.stringify(ch)}`);
      } catch (e) {
        debugLog(`[channel-info] failed to fetch: ${errorMessage(e)}`);
      }
    }
    const messages = await client.getMessages(targetId, chatType, { limit, offset });
    const sorted = [...messages].sort(
      (a, b) => (Number((a as unknown as Record<string, unknown>).time) || 0) - (Number((b as unknown as Record<string, unknown>).time) || 0)
    );
    res.json(sorted);
  } catch (err) {
    if (err instanceof Error) {
      debugLog(`[getMessages:route] ERROR: ${err.message}\n${err.stack}`);
    } else {
      debugLog(`[getMessages:route] ERROR: ${String(err)}`);
    }
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.post('/messages/:type/:targetId', async (req, res) => {
  try {
    const client = req.client!;
    const { type, targetId } = req.params;
    const { text, is_forwarded, reply_to_id, files } = req.body as { text: string; is_forwarded?: boolean; reply_to_id?: string; files?: string[] };
    const chatType = type as 'channel' | 'conversation';
    await client.sendMessage({ target: targetId, target_type: chatType, text, is_forwarded, reply_to_id, files });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.post('/messages/:type/:targetId/read', async (req, res) => {
  try {
    const client = req.client!;
    const { type, targetId } = req.params;
    const { messageId } = req.body as { messageId?: string };
    const chatType = type as 'channel' | 'conversation';
    if (messageId) {
      await client.markAsRead(targetId, chatType, messageId);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.post('/messages/:type/:targetId/unread', async (req, res) => {
  try {
    const client = req.client!;
    const { type, targetId } = req.params;
    await client.markChatAsUnread(type as 'channel' | 'conversation', targetId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

export default router;
