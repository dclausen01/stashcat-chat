"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const stashcat_api_1 = require("stashcat-api");
const logging_1 = require("../lib/logging");
const router = (0, express_1.Router)();
router.post('/key-sync/accept', async (req, res) => {
    try {
        const client = req.client;
        const { userId, notificationId } = req.body;
        if (!userId)
            return void res.status(400).json({ error: 'userId required' });
        if (!client.isE2EUnlocked())
            return void res.status(400).json({ error: 'E2E not unlocked' });
        (0, logging_1.serverLog)(`[KeySync] Fetching missing keys for user ${userId}`);
        const missingData = client.api.createAuthenticatedRequestData({ user_id: userId });
        const missing = await client.api.post('/security/get_missing_keys', missingData);
        const conversations = missing.content.conversations ?? [];
        const channels = missing.content.channels ?? [];
        (0, logging_1.serverLog)(`[KeySync] Found ${conversations.length} conversations, ${channels.length} channels missing keys`);
        const expiry = Math.floor(Date.now() / 1000) + 365 * 24 * 3600;
        let processed = 0;
        let errors = 0;
        const foreignPublicKey = conversations[0]?.foreign_public_key ?? channels[0]?.foreign_public_key;
        for (const conv of conversations) {
            try {
                const publicKey = conv.foreign_public_key ?? foreignPublicKey;
                if (!publicKey) {
                    errors++;
                    continue;
                }
                const aesKey = await client.getConversationAesKey(conv.id);
                const encryptedKey = stashcat_api_1.StashcatClient.encryptWithPublicKey(publicKey, aesKey);
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
                (0, logging_1.serverLog)(`[KeySync] Set key for conversation ${conv.id}`);
            }
            catch (itemErr) {
                errors++;
                (0, logging_1.serverLog)(`[KeySync] Failed to set key for conversation ${conv.id}:`, (0, logging_1.errorMessage)(itemErr));
            }
        }
        for (const ch of channels) {
            try {
                const publicKey = ch.foreign_public_key ?? foreignPublicKey;
                if (!publicKey) {
                    errors++;
                    continue;
                }
                const aesKey = await client.getChannelAesKey(ch.id);
                const encryptedKey = stashcat_api_1.StashcatClient.encryptWithPublicKey(publicKey, aesKey);
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
                (0, logging_1.serverLog)(`[KeySync] Set key for channel ${ch.id}`);
            }
            catch (itemErr) {
                errors++;
                (0, logging_1.serverLog)(`[KeySync] Failed to set key for channel ${ch.id}:`, (0, logging_1.errorMessage)(itemErr));
            }
        }
        (0, logging_1.serverLog)(`[KeySync] Done: ${processed} keys set, ${errors} errors`);
        if (notificationId) {
            try {
                await client.deleteNotification(notificationId);
            }
            catch { /* best-effort */ }
        }
        if (processed === 0 && errors > 0) {
            return void res.status(500).json({ error: 'Failed to set any keys — check server log' });
        }
        res.json({ ok: true, processed, errors });
    }
    catch (err) {
        (0, logging_1.serverLog)(`[KeySync] accept failed:`, (0, logging_1.errorMessage)(err));
        res.status(500).json({ error: (0, logging_1.errorMessage)(err) });
    }
});
exports.default = router;
