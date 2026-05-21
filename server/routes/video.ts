import { Router } from 'express';
import { decryptSession } from '../token-crypto';
import { extractToken } from '../lib/get-client';
import { findChatBot, extractSenderId, extractMeetingLinks } from '../lib/bot';
import { errorMessage, serverLog } from '../lib/logging';

const router = Router();

router.post('/video/start-meeting', async (req, res) => {
  // Wenn der Browser die Verbindung abbricht (z.B. User schliesst Tab waehrend
  // wir den Bot pollen), brechen wir den 30s-Wartepoll ab statt sinnlos
  // weiterzulaufen.
  let aborted = false;
  req.on('close', () => { aborted = true; });

  let clientKey = '';
  try {
    const token = extractToken(req);
    const payload = decryptSession(token);
    clientKey = payload.clientKey;
    const client = req.client!;

    const botInfo = await findChatBot(client, clientKey);
    if (!botInfo) {
      return res.status(503).json({ error: 'Chat Bot nicht gefunden. Schreibe zuerst eine Nachricht an den "Chat Bot" in der App, dann versuche es erneut.' });
    }

    const existingMsgs = await client.getMessages(botInfo.botConvId, 'conversation', { limit: 10, offset: 0 }) as unknown as Array<Record<string, unknown>>;
    const existingIds = new Set(existingMsgs.map((m) => String(m.id)));
    serverLog(`[Video] Existing message IDs: ${[...existingIds].join(', ')}`);

    await client.sendMessage({
      target: botInfo.botConvId,
      target_type: 'conversation',
      text: '/meet',
    });
    serverLog(`[Video] Sent /meet to bot conv ${botInfo.botConvId}`);

    let inviteLink: string | null = null;
    let moderatorLink: string | null = null;

    for (let attempt = 0; attempt < 60; attempt++) {
      if (aborted) {
        serverLog(`[Video] Client disconnected, aborting bot poll`);
        return;
      }
      await new Promise((r) => setTimeout(r, 500));
      if (aborted) return;

      const messages = await client.getMessages(botInfo.botConvId, 'conversation', { limit: 10, offset: 0 }) as unknown as Array<Record<string, unknown>>;

      for (const msg of messages) {
        const msgId = String(msg.id);
        if (existingIds.has(msgId)) continue;

        const senderId = extractSenderId(msg);
        if (senderId !== botInfo.botUserId) continue;

        const text = String(msg.text || '');
        const links = extractMeetingLinks(text);
        serverLog(`[Video] Attempt ${attempt + 1} — new bot msg id=${msgId}, links=${JSON.stringify(links)}, text=${text.slice(0, 150)}`);

        if (links.length === 0) continue;

        const isInvite = text.includes('weitergeben') || text.includes('Teilnehmer') || text.includes('einzuladen');
        const isModerator = text.includes('starten') || text.includes('nur für dich') || text.includes('Konferenz ist bereit');

        if (isInvite) {
          inviteLink = links[0];
        } else if (isModerator) {
          moderatorLink = links[0];
        } else if (links.length >= 2) {
          inviteLink = inviteLink ?? links[0];
          moderatorLink = moderatorLink ?? links[1];
        } else {
          if (!inviteLink) inviteLink = links[0];
          else if (!moderatorLink) moderatorLink = links[0];
        }

        existingIds.add(msgId);
      }

      if (inviteLink && moderatorLink) break;
    }

    if (aborted) return;

    if (!inviteLink && !moderatorLink) {
      return res.status(504).json({ error: 'Chat Bot hat nicht rechtzeitig geantwortet. Bitte versuche es erneut.' });
    }

    serverLog(`[Video] Meeting ready — invite=${inviteLink}, moderator=${moderatorLink}`);
    res.json({ inviteLink, moderatorLink });

  } catch (err) {
    if (aborted) return;
    serverLog('[Video] Error:', errorMessage(err));
    res.status(500).json({ error: errorMessage(err, 'Videokonferenz konnte nicht erstellt werden') });
  }
});

export default router;
