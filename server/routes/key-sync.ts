import { Router } from 'express';
import { StashcatClient } from 'stashcat-api';
import { errorMessage, serverLog } from '../lib/logging';

const router = Router();

router.post('/key-sync/accept', async (req, res) => {
  try {
    const client = req.client!;
    const { userId, notificationId } = req.body as { userId?: string; notificationId?: string };
    if (!userId) return void res.status(400).json({ error: 'userId required' });
    if (!client.isE2EUnlocked()) return void res.status(400).json({ error: 'E2E not unlocked' });

    serverLog(`[KeySync] Fetching missing keys for user ${userId}`);
    interface MissingKeyItem {
      id: string;
      key?: string;
      foreign_user_id?: string;
      foreign_public_key?: string;
      foreign_socket_id?: string;
    }
    interface MissingKeysPayload {
      content: { conversations?: MissingKeyItem[]; channels?: MissingKeyItem[] };
    }
    const missingData = client.api.createAuthenticatedRequestData({ user_id: userId });
    const missing = await client.api.post<MissingKeysPayload>('/security/get_missing_keys', missingData);

    const conversations = missing.content.conversations ?? [];
    const channels = missing.content.channels ?? [];
    serverLog(`[KeySync] Found ${conversations.length} conversations, ${channels.length} channels missing keys`);

    const expiry = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
    let processed = 0;
    let errors = 0;

    const foreignPublicKey = conversations[0]?.foreign_public_key ?? channels[0]?.foreign_public_key;

    for (const conv of conversations) {
      try {
        const publicKey = conv.foreign_public_key ?? foreignPublicKey;
        if (!publicKey) { errors++; continue; }

        const aesKey = await client.getConversationAesKey(conv.id);
        const encryptedKey = StashcatClient.encryptWithPublicKey(publicKey, aesKey);
        const keyBase64 = encryptedKey.toString('base64');
        const signature = client.signData(Buffer.from(keyBase64)).toString('hex');

        const setData = client.api.createAuthenticatedRequestData({
          user_id: userId,
          type: 'conversation',
          type_id: conv.id,
          key: keyBase64,
          signature,
          expiry: String(expiry),
        });
        await client.api.post('/security/set_missing_key', setData);
        processed++;
        serverLog(`[KeySync] Set key for conversation ${conv.id}`);
      } catch (itemErr) {
        errors++;
        serverLog(`[KeySync] Failed to set key for conversation ${conv.id}:`, errorMessage(itemErr));
      }
    }

    for (const ch of channels) {
      try {
        const publicKey = ch.foreign_public_key ?? foreignPublicKey;
        if (!publicKey) { errors++; continue; }

        const aesKey = await client.getChannelAesKey(ch.id);
        const encryptedKey = StashcatClient.encryptWithPublicKey(publicKey, aesKey);
        const keyBase64 = encryptedKey.toString('base64');
        const signature = client.signData(Buffer.from(keyBase64)).toString('hex');

        const setData = client.api.createAuthenticatedRequestData({
          user_id: userId,
          type: 'channel',
          type_id: ch.id,
          key: keyBase64,
          signature,
          expiry: String(expiry),
        });
        await client.api.post('/security/set_missing_key', setData);
        processed++;
        serverLog(`[KeySync] Set key for channel ${ch.id}`);
      } catch (itemErr) {
        errors++;
        serverLog(`[KeySync] Failed to set key for channel ${ch.id}:`, errorMessage(itemErr));
      }
    }

    serverLog(`[KeySync] Done: ${processed} keys set, ${errors} errors`);

    if (notificationId) {
      try { await client.deleteNotification(notificationId); } catch { /* best-effort */ }
    }

    if (processed === 0 && errors > 0) {
      return void res.status(500).json({ error: 'Failed to set any keys — check server log' });
    }

    res.json({ ok: true, processed, errors });
  } catch (err) {
    serverLog(`[KeySync] accept failed:`, errorMessage(err));
    res.status(500).json({ error: errorMessage(err) });
  }
});

export default router;
