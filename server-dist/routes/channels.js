"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const stashcat_api_1 = require("stashcat-api");
const logging_1 = require("../lib/logging");
const router = (0, express_1.Router)();
router.get('/companies', async (req, res) => {
    try {
        const client = req.client;
        res.json(await client.getCompanies());
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err) });
    }
});
router.get('/channels/:companyId/visible', async (req, res) => {
    try {
        const client = req.client;
        const channels = await client.getVisibleChannels(req.params.companyId);
        res.json(channels);
    }
    catch (e) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(e) });
    }
});
router.post('/channels/:channelId/join', async (req, res) => {
    try {
        const client = req.client;
        await client.joinChannel(req.params.channelId);
        res.json({ ok: true });
    }
    catch (e) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(e) });
    }
});
router.post('/channels/:channelId/quit', async (req, res) => {
    try {
        const client = req.client;
        await client.quitChannel(req.params.channelId);
        res.json({ ok: true });
    }
    catch (e) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(e) });
    }
});
router.post('/channels/invites/:inviteId/accept', async (req, res) => {
    try {
        const client = req.client;
        const inviteId = req.params.inviteId;
        const { notificationId } = req.body;
        (0, logging_1.serverLog)(`[channel-invite] ACCEPT invite_id=${inviteId}`);
        const data = client.api.createAuthenticatedRequestData({ invite_id: inviteId });
        await client.api.post('/channels/acceptInvite', data);
        if (notificationId) {
            try {
                await client.deleteNotification(notificationId);
            }
            catch { /* best-effort */ }
        }
        (0, logging_1.serverLog)(`[channel-invite] ACCEPT invite_id=${inviteId} — success`);
        res.json({ ok: true });
    }
    catch (e) {
        (0, logging_1.serverLog)(`[channel-invite] ACCEPT invite_id=${req.params.inviteId} — FAILED: ${(0, logging_1.errorMessage)(e)}`);
        res.status(500).json({ error: (0, logging_1.errorMessage)(e) });
    }
});
router.post('/channels/invites/:inviteId/decline', async (req, res) => {
    try {
        const client = req.client;
        const inviteId = req.params.inviteId;
        const { notificationId } = req.body;
        (0, logging_1.serverLog)(`[channel-invite] DECLINE invite_id=${inviteId}`);
        const data = client.api.createAuthenticatedRequestData({ invite_id: inviteId });
        await client.api.post('/channels/declineInvite', data);
        if (notificationId) {
            try {
                await client.deleteNotification(notificationId);
            }
            catch { /* best-effort */ }
        }
        (0, logging_1.serverLog)(`[channel-invite] DECLINE invite_id=${inviteId} — success`);
        res.json({ ok: true });
    }
    catch (e) {
        (0, logging_1.serverLog)(`[channel-invite] DECLINE invite_id=${req.params.inviteId} — FAILED: ${(0, logging_1.errorMessage)(e)}`);
        res.status(500).json({ error: (0, logging_1.errorMessage)(e) });
    }
});
router.post('/channels/:channelId/favorite', async (req, res) => {
    try {
        const client = req.client;
        const { favorite } = req.body;
        await client.setChannelFavorite(req.params.channelId, Boolean(favorite));
        res.json({ ok: true });
    }
    catch (e) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(e) });
    }
});
router.get('/channels/:companyId', async (req, res) => {
    try {
        const client = req.client;
        const channels = await client.getChannels(req.params.companyId);
        const mapped = channels.map((ch) => {
            const membership = ch.membership;
            return {
                ...ch,
                muted: membership?.muted ?? null,
            };
        });
        res.json(mapped);
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err) });
    }
});
router.get('/channels/:channelId/members', async (req, res) => {
    try {
        const client = req.client;
        const channelId = req.params.channelId;
        const all = [];
        const PAGE = 100;
        let offset = 0;
        while (true) {
            const batch = await client.getChannelMembers(channelId, { limit: PAGE, offset });
            const nonPending = batch.filter((m) => {
                const pending = m.membership_pending === true || m.pending === true;
                return !pending;
            });
            all.push(...nonPending);
            if (batch.length < PAGE)
                break;
            offset += PAGE;
        }
        console.log(`[channels/members] channelId=${channelId} → ${all.length} members (excluding pending)`);
        if (all.length > 0)
            console.log('[channels/members] first member:', JSON.stringify(all[0]));
        res.json(all);
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err) });
    }
});
router.get('/channels/:channelId/pending-members', async (req, res) => {
    try {
        const client = req.client;
        const channelId = req.params.channelId;
        const all = [];
        const PAGE = 100;
        let offset = 0;
        while (true) {
            const batch = await client.getChannelMembers(channelId, { limit: PAGE, offset, filter: 'membership_pending' });
            all.push(...batch);
            if (batch.length < PAGE)
                break;
            offset += PAGE;
        }
        console.log(`[channels/pending-members] channelId=${channelId} → ${all.length} pending members`);
        res.json(all);
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err) });
    }
});
router.post('/channels/:channelId/notifications', async (req, res) => {
    try {
        const client = req.client;
        const channelId = req.params.channelId;
        const { enabled, duration } = req.body;
        if (enabled) {
            await client.enableChannelNotifications(channelId);
            console.log(`[channels/notifications] enabled for ${channelId}`);
        }
        else {
            const muteDuration = duration && duration > 0 ? duration : 2147483647;
            await client.disableChannelNotifications(channelId, muteDuration);
            console.log(`[channels/notifications] disabled for ${channelId} (duration=${muteDuration})`);
        }
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err) });
    }
});
router.post('/channels/:channelId/invite', async (req, res) => {
    try {
        const client = req.client;
        const { userIds } = req.body;
        await client.inviteUsersToChannel(req.params.channelId, userIds);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err) });
    }
});
router.delete('/channels/:channelId/members/:userId', async (req, res) => {
    try {
        const client = req.client;
        await client.removeUserFromChannel(req.params.channelId, req.params.userId);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err) });
    }
});
router.post('/channels/:channelId/moderator/:userId', async (req, res) => {
    try {
        const client = req.client;
        await client.addChannelModerator(req.params.channelId, req.params.userId);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err) });
    }
});
router.delete('/channels/:channelId/moderator/:userId', async (req, res) => {
    try {
        const client = req.client;
        await client.removeChannelModerator(req.params.channelId, req.params.userId);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err) });
    }
});
router.patch('/channels/:channelId', async (req, res) => {
    try {
        const client = req.client;
        const { description, company_id, name } = req.body;
        const result = await client.editChannel({
            channel_id: req.params.channelId,
            company_id,
            description,
            ...(name !== undefined ? { channel_name: name } : {}),
        });
        res.json(result);
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err) });
    }
});
router.post('/channels/:channelId/image', async (req, res) => {
    try {
        const client = req.client;
        const { company_id, image } = req.body;
        const api = client.api;
        if (!api || typeof api.createAuthenticatedRequestData !== 'function') {
            throw new Error('API client not available');
        }
        const requestData = api.createAuthenticatedRequestData({
            channel_id: req.params.channelId,
            company_id,
            imgBase64: image,
        });
        const result = await api.post('/channels/setImage', requestData);
        res.json(result);
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err, 'Failed to set channel image') });
    }
});
router.get('/channels/:channelId/info', async (req, res) => {
    try {
        const client = req.client;
        const ch = await client.getChannelInfo(req.params.channelId, true);
        res.json(ch);
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err) });
    }
});
router.delete('/channels/:channelId', async (req, res) => {
    try {
        const client = req.client;
        const { channelId } = req.params;
        await client.deleteChannel(channelId);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err, 'Failed to delete channel') });
    }
});
router.get('/companies/:companyId/members', async (req, res) => {
    try {
        const client = req.client;
        const search = req.query.search;
        const limit = req.query.limit ? Number(req.query.limit) : undefined;
        const offset = req.query.offset ? Number(req.query.offset) : undefined;
        const result = await client.listManagedUsers(req.params.companyId, { search, limit, offset });
        res.json({ users: result.users, total: result.total });
    }
    catch (err) {
        console.error('[company-members] Error:', err);
        res.status(500).json({ error: (0, logging_1.errorMessage)(err) });
    }
});
router.get('/companies/:companyId/groups', async (req, res) => {
    try {
        const client = req.client;
        const groups = await client.listGroups(req.params.companyId);
        res.json(groups);
    }
    catch (err) {
        console.error('[company-groups] Error:', err);
        res.status(500).json({ error: (0, logging_1.errorMessage)(err) });
    }
});
router.get('/companies/:companyId/groups/:groupId/members', async (req, res) => {
    try {
        const client = req.client;
        const PAGE = 200;
        const allUsers = [];
        let offset = 0;
        let total = 0;
        while (true) {
            const result = await client.listManagedUsers(req.params.companyId, {
                groupIds: [req.params.groupId],
                limit: PAGE,
                offset,
            });
            allUsers.push(...result.users);
            total = result.total ?? allUsers.length;
            if (result.users.length < PAGE)
                break;
            offset += PAGE;
        }
        res.json({ users: allUsers, total });
    }
    catch (err) {
        console.error('[group-members] Error:', err);
        res.status(500).json({ error: (0, logging_1.errorMessage)(err) });
    }
});
router.post('/channels', async (req, res) => {
    try {
        const client = req.client;
        const { name, company_id, description, policies, channel_type, hidden, invite_only, read_only, show_activities, show_membership_activities, password, password_repeat, } = req.body;
        const isEncrypted = channel_type === 'encrypted';
        const isPassword = channel_type === 'password';
        const cryptoGen = await Promise.resolve().then(() => __importStar(require('crypto')));
        const uniqueIdentifier = cryptoGen.randomBytes(16).toString('hex');
        const channelOpts = {
            unique_identifier: uniqueIdentifier,
            channel_name: name,
            company: company_id,
            description: [description, policies ? `\n\nRichtlinien: ${policies}` : ''].filter(Boolean).join(''),
            type: isEncrypted ? 'closed' : 'public',
            visible: !hidden,
            writable: read_only ? 'manager' : 'all',
            inviteable: invite_only ? 'manager' : 'all',
            show_activities: show_activities ?? true,
            show_membership_activities: show_membership_activities ?? true,
            message_ttl: 0,
            ...(isPassword && password ? { password, password_repeat: password_repeat ?? password } : {}),
        };
        if (isEncrypted) {
            const aesKey = cryptoGen.randomBytes(32);
            if (!client.isE2EUnlocked()) {
                return res.status(400).json({ error: 'E2E not unlocked — encrypted channels require E2E. Please re-login with your security password.' });
            }
            const me = await client.getMe();
            if (!me.public_key) {
                return res.status(500).json({ error: 'Own public key not available' });
            }
            (0, logging_1.debugLog)(`[channels/create] aesKey length=${aesKey.length} E2E_unlocked=${client.isE2EUnlocked()}`);
            (0, logging_1.debugLog)(`[channels/create] public_key prefix="${me.public_key.slice(0, 40).replace(/\n/g, '\\n')}"`);
            const encryptedKey = stashcat_api_1.StashcatClient.encryptWithPublicKey(me.public_key, aesKey);
            const keyBase64 = encryptedKey.toString('base64');
            channelOpts.encryption_key = keyBase64;
            (0, logging_1.debugLog)(`[channels/create] encryptedKey length=${encryptedKey.length} keyBase64 length=${keyBase64.length}`);
            (0, logging_1.debugLog)(`[channels/create] skipping signature (server accepts without)`);
        }
        const channel = await client.createChannel(channelOpts);
        const channelId = String(channel.id ?? '');
        (0, logging_1.debugLog)(`[channels/create] created channel id=${channelId} name=${channel.name ?? name} encrypted=${channel.encrypted}`);
        (0, logging_1.debugLog)(`[channels/create] response key length=${String(channel.key ?? '').length} key_sender=${channel.key_sender}`);
        if (isEncrypted && channelId) {
            try {
                const aesKeyFromServer = await client.getChannelAesKey(channelId);
                (0, logging_1.debugLog)(`[channels/create] SELF-TEST getChannelAesKey: SUCCESS aesKey length=${aesKeyFromServer?.length}`);
            }
            catch (selfTestErr) {
                (0, logging_1.debugLog)(`[channels/create] SELF-TEST getChannelAesKey: FAILED — ${(0, logging_1.errorMessage)(selfTestErr, '')}`);
            }
        }
        res.json(channel);
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err, 'Failed to create channel') });
    }
});
router.post('/channels/:channelId/keys', async (req, res) => {
    try {
        const client = req.client;
        const channelId = req.params.channelId;
        const { keys } = req.body;
        if (!keys || !Array.isArray(keys)) {
            return res.status(400).json({ error: 'keys array required' });
        }
        await client.setMissingKey('channel', channelId, keys);
        console.log(`[channels/keys] distributed ${keys.length} keys for channel ${channelId}`);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err, 'Failed to set channel keys') });
    }
});
exports.default = router;
