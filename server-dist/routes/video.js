"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const token_crypto_1 = require("../token-crypto");
const get_client_1 = require("../lib/get-client");
const bot_1 = require("../lib/bot");
const logging_1 = require("../lib/logging");
const router = (0, express_1.Router)();
router.post('/video/start-meeting', async (req, res) => {
    let clientKey = '';
    try {
        const token = (0, get_client_1.extractToken)(req);
        const payload = (0, token_crypto_1.decryptSession)(token);
        clientKey = payload.clientKey;
        const client = req.client;
        const botInfo = await (0, bot_1.findChatBot)(client, clientKey);
        if (!botInfo) {
            return res.status(503).json({ error: 'Chat Bot nicht gefunden. Schreibe zuerst eine Nachricht an den "Chat Bot" in der App, dann versuche es erneut.' });
        }
        const existingMsgs = await client.getMessages(botInfo.botConvId, 'conversation', { limit: 10, offset: 0 });
        const existingIds = new Set(existingMsgs.map((m) => String(m.id)));
        console.log(`[Video] Existing message IDs: ${[...existingIds].join(', ')}`);
        await client.sendMessage({
            target: botInfo.botConvId,
            target_type: 'conversation',
            text: '/meet',
        });
        console.log(`[Video] Sent /meet to bot conv ${botInfo.botConvId}`);
        let inviteLink = null;
        let moderatorLink = null;
        for (let attempt = 0; attempt < 60; attempt++) {
            await new Promise((r) => setTimeout(r, 500));
            const messages = await client.getMessages(botInfo.botConvId, 'conversation', { limit: 10, offset: 0 });
            for (const msg of messages) {
                const msgId = String(msg.id);
                if (existingIds.has(msgId))
                    continue;
                const senderId = (0, bot_1.extractSenderId)(msg);
                if (senderId !== botInfo.botUserId)
                    continue;
                const text = String(msg.text || '');
                const links = (0, bot_1.extractMeetingLinks)(text);
                console.log(`[Video] Attempt ${attempt + 1} — new bot msg id=${msgId}, links=${JSON.stringify(links)}, text=${text.slice(0, 150)}`);
                if (links.length === 0)
                    continue;
                const isInvite = text.includes('weitergeben') || text.includes('Teilnehmer') || text.includes('einzuladen');
                const isModerator = text.includes('starten') || text.includes('nur für dich') || text.includes('Konferenz ist bereit');
                if (isInvite) {
                    inviteLink = links[0];
                }
                else if (isModerator) {
                    moderatorLink = links[0];
                }
                else if (links.length >= 2) {
                    inviteLink = inviteLink ?? links[0];
                    moderatorLink = moderatorLink ?? links[1];
                }
                else {
                    if (!inviteLink)
                        inviteLink = links[0];
                    else if (!moderatorLink)
                        moderatorLink = links[0];
                }
                existingIds.add(msgId);
            }
            if (inviteLink && moderatorLink)
                break;
        }
        if (!inviteLink && !moderatorLink) {
            return res.status(504).json({ error: 'Chat Bot hat nicht rechtzeitig geantwortet. Bitte versuche es erneut.' });
        }
        console.log(`[Video] Meeting ready — invite=${inviteLink}, moderator=${moderatorLink}`);
        res.json({ inviteLink, moderatorLink });
    }
    catch (err) {
        console.error('[Video] Error:', err);
        res.status(500).json({ error: (0, logging_1.errorMessage)(err, 'Videokonferenz konnte nicht erstellt werden') });
    }
});
exports.default = router;
