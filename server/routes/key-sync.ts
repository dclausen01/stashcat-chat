import { Router } from 'express';
import { StashcatClient } from 'stashcat-api';
import { errorMessage, serverLog } from '../lib/logging';
import { DEFAULT_KEY_TTL, encryptAndSignChatKey, getSigningKey } from '../lib/signing';

const router = Router();

interface MissingKeyItem {
  id: string;
  unique_identifier?: string | null;
  key?: string;
  foreign_user_id?: string;
  foreign_public_key?: string;
  foreign_socket_id?: string;
}
interface MissingKeysPayload {
  content: { conversations?: MissingKeyItem[]; channels?: MissingKeyItem[] };
}

/**
 * Mitglieder-IDs einer Konversation — sie gehen in die signierte Zeichenkette
 * ein. Der Originalclient haengt dabei die eigene ID mit an.
 */
async function conversationMemberIds(client: StashcatClient, conversationId: string): Promise<string[]> {
  const conv = await client.getConversation(conversationId);
  const members = (conv.members ?? []) as Array<{ id?: string | number }>;
  const ids = members.map((m) => String(m?.id ?? '')).filter(Boolean);
  const me = await client.getMe();
  const myId = String((me as unknown as Record<string, unknown>).id ?? '');
  if (myId) ids.push(myId);
  return ids;
}

router.post('/key-sync/accept', async (req, res) => {
  try {
    const client = req.client!;
    const { userId, notificationId } = req.body as { userId?: string; notificationId?: string };
    if (!userId) return void res.status(400).json({ error: 'userId required' });
    if (!client.isE2EUnlocked()) return void res.status(400).json({ error: 'E2E not unlocked' });

    serverLog(`[KeySync] Fetching missing keys for user ${userId}`);
    const missingData = client.api.createAuthenticatedRequestData({ user_id: userId });
    const missing = await client.api.post<MissingKeysPayload>('/security/get_missing_keys', missingData);

    const conversations = missing.content.conversations ?? [];
    const channels = missing.content.channels ?? [];
    serverLog(`[KeySync] Found ${conversations.length} conversations, ${channels.length} channels missing keys`);

    // Einmal vorab pruefen, damit die Log-Zeile nicht pro Chat wiederholt wird.
    const hasSigningKey = (await getSigningKey(client)) !== null;
    if (!hasSigningKey) {
      serverLog('[KeySync] Ohne Signierschluessel — Schluessel werden unsigniert verteilt');
    }

    let processed = 0;
    let errors = 0;

    const foreignPublicKey = conversations[0]?.foreign_public_key ?? channels[0]?.foreign_public_key;

    const distribute = async (
      item: MissingKeyItem,
      type: 'conversation' | 'channel',
      aesKey: Buffer,
      memberIds: string[] | null,
    ) => {
      const publicKey = item.foreign_public_key ?? foreignPublicKey;
      if (!publicKey) { errors++; return; }

      const keyBase64 = StashcatClient.encryptWithPublicKey(publicKey, aesKey).toString('base64');
      const signed = await encryptAndSignChatKey(client, keyBase64, {
        chatId: item.unique_identifier,
        memberIds,
        ttl: DEFAULT_KEY_TTL,
      });

      const setData = client.api.createAuthenticatedRequestData({
        user_id: userId,
        type,
        type_id: item.id,
        key: signed.encrypted,
        signature: signed.signature ?? '',
        expiry: signed.expiryTimestamp != null ? String(signed.expiryTimestamp) : '',
      });
      await client.api.post('/security/set_missing_key', setData);
      processed++;
      serverLog(`[KeySync] Set key for ${type} ${item.id} (signiert: ${signed.signature ? 'ja' : 'nein'})`);
    };

    for (const conv of conversations) {
      try {
        await distribute(
          conv,
          'conversation',
          await client.getConversationAesKey(conv.id),
          await conversationMemberIds(client, conv.id),
        );
      } catch (itemErr) {
        errors++;
        serverLog(`[KeySync] Failed to set key for conversation ${conv.id}:`, errorMessage(itemErr));
      }
    }

    for (const ch of channels) {
      try {
        // Channels signieren ohne Mitgliederliste — so macht es der Originalclient.
        await distribute(ch, 'channel', await client.getChannelAesKey(ch.id), null);
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

    res.json({ ok: true, processed, errors, signed: hasSigningKey });
  } catch (err) {
    serverLog(`[KeySync] accept failed:`, errorMessage(err));
    res.status(500).json({ error: errorMessage(err) });
  }
});

export default router;
