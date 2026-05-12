"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const token_crypto_1 = require("../token-crypto");
const get_client_1 = require("../lib/get-client");
const bot_1 = require("../lib/bot");
const logging_1 = require("../lib/logging");
const router = (0, express_1.Router)();
router.post('/conversations/:convId/favorite', async (req, res) => {
    try {
        const client = req.client;
        const { favorite } = req.body;
        if (favorite) {
            await client.setConversationFavorite(req.params.convId, true);
        }
        else {
            await client.setConversationFavorite(req.params.convId, false);
        }
        res.json({ ok: true });
    }
    catch (e) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(e) });
    }
});
router.post('/conversations', async (req, res) => {
    try {
        const client = req.client;
        const { member_ids } = req.body;
        const conversation = await client.createConversation(member_ids);
        console.log(`[conversations/create] created conversation with ${member_ids.length} member(s)`);
        res.json(conversation);
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err, 'Failed to create conversation') });
    }
});
router.get('/conversations', async (req, res) => {
    try {
        const token = (0, get_client_1.extractToken)(req);
        const payload = (0, token_crypto_1.decryptSession)(token);
        const client = req.client;
        // When no explicit limit is passed, paginate through all conversations.
        // Stashcat's API caps each response at ~100 regardless of the requested limit,
        // so a single request would silently truncate the list (losing favorites
        // that sit further down by last_activity).
        let conversations;
        if (req.query.limit !== undefined) {
            const limit = Number(req.query.limit) || 50;
            const offset = Number(req.query.offset) || 0;
            conversations = await client.getConversations({ limit, offset });
        }
        else {
            conversations = [];
            const PAGE = 100;
            let offset = 0;
            while (true) {
                const batch = await client.getConversations({ limit: PAGE, offset });
                conversations.push(...batch);
                if (batch.length < PAGE)
                    break;
                offset += PAGE;
            }
        }
        await (0, bot_1.findChatBot)(client, payload.clientKey).catch(() => { });
        const filtered = conversations.filter((c) => !(0, bot_1.isBotConversation)(String(c.id), payload.clientKey));
        res.json(filtered);
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err) });
    }
});
router.get('/conversations/:id', async (req, res) => {
    try {
        const client = req.client;
        const conv = await client.getConversation(req.params.id);
        res.json(conv);
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err) });
    }
});
router.post('/conversations/:id/archive', async (req, res) => {
    try {
        const client = req.client;
        const { id } = req.params;
        await client.archiveConversation(id);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err) });
    }
});
exports.default = router;
