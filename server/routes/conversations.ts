import { Router } from 'express';
import { decryptSession } from '../token-crypto';
import { extractToken } from '../lib/get-client';
import { findChatBot, isBotConversation } from '../lib/bot';
import { errorMessage } from '../lib/logging';

const router = Router();

router.post('/conversations/:convId/favorite', async (req, res) => {
  try {
    const client = req.client!;
    const { favorite } = req.body as { favorite: boolean };
    if (favorite) {
      await client.setConversationFavorite(req.params.convId, true);
    } else {
      await client.setConversationFavorite(req.params.convId, false);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: errorMessage(e) }); }
});

router.post('/conversations', async (req, res) => {
  try {
    const client = req.client!;
    const { member_ids } = req.body as { member_ids: string[] };
    const conversation = await client.createConversation(member_ids);
    console.log(`[conversations/create] created conversation with ${member_ids.length} member(s)`);
    res.json(conversation);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err, 'Failed to create conversation') });
  }
});

router.get('/conversations', async (req, res) => {
  try {
    const token = extractToken(req);
    const payload = decryptSession(token);
    const client = req.client!;

    // When no explicit limit is passed, paginate through all conversations.
    // Stashcat's API caps each response at ~100 regardless of the requested limit,
    // so a single request would silently truncate the list (losing favorites
    // that sit further down by last_activity).
    let conversations: Array<Record<string, unknown>>;
    if (req.query.limit !== undefined) {
      const limit = Number(req.query.limit) || 50;
      const offset = Number(req.query.offset) || 0;
      conversations = await client.getConversations({ limit, offset }) as unknown as Array<Record<string, unknown>>;
    } else {
      conversations = [];
      const PAGE = 100;
      let offset = 0;
      while (true) {
        const batch = await client.getConversations({ limit: PAGE, offset }) as unknown as Array<Record<string, unknown>>;
        conversations.push(...batch);
        if (batch.length < PAGE) break;
        offset += PAGE;
      }
    }

    await findChatBot(client, payload.clientKey).catch(() => {});

    const filtered = conversations.filter((c) => !isBotConversation(String(c.id), payload.clientKey));
    res.json(filtered);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.get('/conversations/:id', async (req, res) => {
  try {
    const client = req.client!;
    const conv = await client.getConversation(req.params.id);
    res.json(conv);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.post('/conversations/:id/archive', async (req, res) => {
  try {
    const client = req.client!;
    const { id } = req.params;
    await client.archiveConversation(id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

export default router;
