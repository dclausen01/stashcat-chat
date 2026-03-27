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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const multer_1 = __importDefault(require("multer"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const promises_1 = __importDefault(require("fs/promises"));
const stashcat_api_1 = require("stashcat-api");
const token_crypto_1 = require("./token-crypto");
// Multer: store uploads in OS temp dir
const upload = (0, multer_1.default)({ dest: os_1.default.tmpdir() });
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json());
const clientCache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes
const botCache = new Map(); // keyed by clientKey
// Cleanup expired entries periodically
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of clientCache) {
        if (now > entry.expiresAt)
            clientCache.delete(key);
    }
}, 60_000);
const activeSSE = new Map(); // keyed by clientKey
function pushSSE(clientKey, event, data) {
    const conn = activeSSE.get(clientKey);
    if (!conn)
        return;
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of conn.sseClients) {
        try {
            res.write(payload);
        }
        catch {
            conn.sseClients.delete(res);
        }
    }
}
// ── Client resolution ────────────────────────────────────────────────────────
function extractToken(req) {
    const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
    if (!token)
        throw new Error('No token');
    return token;
}
async function getClient(req) {
    const token = extractToken(req);
    const payload = (0, token_crypto_1.decryptSession)(token);
    // Check cache
    const cached = clientCache.get(payload.clientKey);
    if (cached && Date.now() < cached.expiresAt) {
        cached.expiresAt = Date.now() + CACHE_TTL; // Refresh TTL
        return cached.client;
    }
    // Create new client
    const client = stashcat_api_1.StashcatClient.fromSession({ deviceId: payload.deviceId, clientKey: payload.clientKey }, { baseUrl: payload.baseUrl });
    // Unlock E2E
    if (payload.securityPassword) {
        await client.unlockE2E(payload.securityPassword);
    }
    clientCache.set(payload.clientKey, { client, expiresAt: Date.now() + CACHE_TTL });
    return client;
}
// ── Realtime setup ───────────────────────────────────────────────────────────
function connectRealtime(client, clientKey) {
    client.createRealtimeManager({ reconnect: true }).then((rt) => {
        const conn = activeSSE.get(clientKey);
        if (!conn) {
            rt.disconnect();
            return;
        }
        conn.realtime = rt;
        return rt.connect();
    }).then(() => {
        const conn = activeSSE.get(clientKey);
        if (!conn?.realtime)
            return;
        const rt = conn.realtime;
        rt.on('message_sync', async (data) => {
            // Suppress Chat Bot conversation messages from reaching the frontend
            const convId = data.conversation_id && data.conversation_id !== 0 ? String(data.conversation_id) : null;
            if (convId && isBotConversation(convId, clientKey)) {
                return; // Silently drop bot messages
            }
            const payload = { ...data };
            // Decrypt message text if E2E-encrypted
            if (data.encrypted && data.text && data.iv) {
                try {
                    let aesKey;
                    const channelId = data.channel_id && data.channel_id !== 0 ? String(data.channel_id) : null;
                    const convId = data.conversation_id && data.conversation_id !== 0 ? String(data.conversation_id) : null;
                    if (convId) {
                        aesKey = await client.getConversationAesKey(convId);
                    }
                    else if (channelId) {
                        aesKey = await client.getChannelAesKey(channelId);
                    }
                    if (aesKey) {
                        const iv = stashcat_api_1.CryptoManager.hexToBuffer(data.iv);
                        payload.text = stashcat_api_1.CryptoManager.decrypt(data.text, aesKey, iv);
                    }
                }
                catch (err) {
                    console.warn('[Realtime] Failed to decrypt message_sync:', err.message);
                }
            }
            pushSSE(clientKey, 'message_sync', payload);
        });
        rt.on('user-started-typing', (chatType, chatId, userId) => {
            pushSSE(clientKey, 'typing', { chatType, chatId, userId });
        });
        console.log(`[Realtime] Connected for clientKey ${clientKey.slice(0, 8)}…`);
    }).catch((err) => {
        console.warn('[Realtime] Connection failed:', err);
    });
}
// ── Auth ──────────────────────────────────────────────────────────────────────
app.post('/api/login', async (req, res) => {
    try {
        const { email, password, securityPassword } = req.body;
        const effectiveSecurityPassword = securityPassword || password;
        const baseUrl = process.env.STASHCAT_BASE_URL || 'https://api.stashcat.com/';
        const client = new stashcat_api_1.StashcatClient({ baseUrl });
        await client.login({ email, password, securityPassword: effectiveSecurityPassword });
        const serialized = client.serialize();
        const token = (0, token_crypto_1.encryptSession)({
            deviceId: serialized.deviceId,
            clientKey: serialized.clientKey,
            securityPassword: effectiveSecurityPassword,
            baseUrl,
        });
        // Cache the client
        clientCache.set(serialized.clientKey, { client, expiresAt: Date.now() + CACHE_TTL });
        const me = await client.getMe();
        res.json({ token, user: me });
    }
    catch (err) {
        res.status(401).json({ error: err instanceof Error ? err.message : 'Login failed' });
    }
});
app.post('/api/logout', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (token) {
            const payload = (0, token_crypto_1.decryptSession)(token);
            // Clean up cache and SSE
            clientCache.delete(payload.clientKey);
            const sse = activeSSE.get(payload.clientKey);
            if (sse) {
                sse.realtime?.disconnect();
                activeSSE.delete(payload.clientKey);
            }
        }
    }
    catch { /* token may be invalid, that's fine */ }
    res.json({ ok: true });
});
// ── Server-Sent Events ────────────────────────────────────────────────────────
app.get('/api/events', async (req, res) => {
    let client;
    let clientKey;
    try {
        const token = extractToken(req);
        const payload = (0, token_crypto_1.decryptSession)(token);
        clientKey = payload.clientKey;
        client = await getClient(req);
    }
    catch {
        res.status(401).end();
        return;
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx response buffering for SSE
    res.flushHeaders();
    // Heartbeat every 25 s to keep the connection alive
    const hb = setInterval(() => { try {
        res.write(': heartbeat\n\n');
    }
    catch {
        clearInterval(hb);
    } }, 25_000);
    // Get or create SSE connection for this clientKey
    let conn = activeSSE.get(clientKey);
    if (!conn) {
        conn = { client, sseClients: new Set() };
        activeSSE.set(clientKey, conn);
        // Connect realtime in background
        connectRealtime(client, clientKey);
    }
    conn.sseClients.add(res);
    req.on('close', () => {
        clearInterval(hb);
        const c = activeSSE.get(clientKey);
        if (c) {
            c.sseClients.delete(res);
            // If no more SSE clients, disconnect realtime and clean up
            if (c.sseClients.size === 0) {
                c.realtime?.disconnect();
                activeSSE.delete(clientKey);
            }
        }
    });
});
// ── Typing ────────────────────────────────────────────────────────────────────
app.post('/api/typing', (req, res) => {
    try {
        const token = extractToken(req);
        const payload = (0, token_crypto_1.decryptSession)(token);
        const { type, targetId } = req.body;
        const conn = activeSSE.get(payload.clientKey);
        conn?.realtime?.sendTyping(type, targetId);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
    }
});
// ── Companies ─────────────────────────────────────────────────────────────────
app.get('/api/companies', async (req, res) => {
    try {
        const client = await getClient(req);
        res.json(await client.getCompanies());
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
    }
});
// ── Channels ──────────────────────────────────────────────────────────────────
app.get('/api/channels/:companyId/visible', async (req, res) => {
    try {
        const client = await getClient(req);
        const channels = await client.getVisibleChannels(req.params.companyId);
        res.json(channels);
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
app.post('/api/channels/:channelId/join', async (req, res) => {
    try {
        const client = await getClient(req);
        await client.joinChannel(req.params.channelId);
        res.json({ ok: true });
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
app.post('/api/channels/:channelId/favorite', async (req, res) => {
    try {
        const client = await getClient(req);
        const { favorite } = req.body;
        if (favorite) {
            await client.setChannelFavorite(req.params.channelId, true);
        }
        else {
            await client.setChannelFavorite(req.params.channelId, false);
        }
        res.json({ ok: true });
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
app.get('/api/channels/:companyId', async (req, res) => {
    try {
        const client = await getClient(req);
        res.json(await client.getChannels(req.params.companyId));
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
    }
});
app.get('/api/channels/:channelId/members', async (req, res) => {
    try {
        const client = await getClient(req);
        const channelId = req.params.channelId;
        // Paginate until all members are fetched (channels can have 500+ members)
        // Note: Stashcat API has a hard cap of ~100 per request regardless of limit param
        const all = [];
        const PAGE = 100;
        let offset = 0;
        while (true) {
            const batch = await client.getChannelMembers(channelId, { limit: PAGE, offset });
            all.push(...batch);
            if (batch.length < PAGE)
                break;
            offset += PAGE;
        }
        console.log(`[channels/members] channelId=${channelId} → ${all.length} members`);
        if (all.length > 0)
            console.log('[channels/members] first member:', JSON.stringify(all[0]));
        res.json(all);
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
    }
});
app.post('/api/channels/:channelId/invite', async (req, res) => {
    try {
        const client = await getClient(req);
        const { userIds } = req.body;
        await client.inviteUsersToChannel(req.params.channelId, userIds);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
    }
});
app.delete('/api/channels/:channelId/members/:userId', async (req, res) => {
    try {
        const client = await getClient(req);
        await client.removeUserFromChannel(req.params.channelId, req.params.userId);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
    }
});
// ── Moderator management ─────────────────────────────────────────────────────
app.post('/api/channels/:channelId/moderator/:userId', async (req, res) => {
    try {
        const client = await getClient(req);
        await client.addChannelModerator(req.params.channelId, req.params.userId);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
    }
});
app.delete('/api/channels/:channelId/moderator/:userId', async (req, res) => {
    try {
        const client = await getClient(req);
        await client.removeChannelModerator(req.params.channelId, req.params.userId);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
    }
});
// ── Channel editing ──────────────────────────────────────────────────────────
app.patch('/api/channels/:channelId', async (req, res) => {
    try {
        const client = await getClient(req);
        const { description, company_id } = req.body;
        const result = await client.editChannel({
            channel_id: req.params.channelId,
            company_id,
            description,
        });
        res.json(result);
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
    }
});
// ── Company members (via /manage/list_users) ─────────────────────────────────
app.get('/api/companies/:companyId/members', async (req, res) => {
    try {
        const client = await getClient(req);
        const search = req.query.search;
        const limit = req.query.limit ? Number(req.query.limit) : undefined;
        const offset = req.query.offset ? Number(req.query.offset) : undefined;
        const result = await client.listManagedUsers(req.params.companyId, { search, limit, offset });
        res.json({ users: result.users, total: result.total });
    }
    catch (err) {
        console.error('[company-members] Error:', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
    }
});
// ── Company groups (AD/LDAP) ─────────────────────────────────────────────────
app.get('/api/companies/:companyId/groups', async (req, res) => {
    try {
        const client = await getClient(req);
        const groups = await client.listGroups(req.params.companyId);
        res.json(groups);
    }
    catch (err) {
        console.error('[company-groups] Error:', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
    }
});
// ── Group members ────────────────────────────────────────────────────────────
app.get('/api/companies/:companyId/groups/:groupId/members', async (req, res) => {
    try {
        const client = await getClient(req);
        const result = await client.listManagedUsers(req.params.companyId, {
            groupIds: [req.params.groupId],
            limit: 200,
        });
        res.json({ users: result.users, total: result.total });
    }
    catch (err) {
        console.error('[group-members] Error:', err);
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
    }
});
// ── Create channel ────────────────────────────────────────────────────────────
app.post('/api/channels', async (req, res) => {
    try {
        const client = await getClient(req);
        const { name, company_id, description, policies, channel_type, // 'public' | 'encrypted' | 'password'
        hidden, invite_only, read_only, show_activities, show_membership_activities, password, password_repeat, } = req.body;
        // Map channel_type to API params
        const isEncrypted = channel_type === 'encrypted';
        const isPassword = channel_type === 'password';
        // For encrypted channels generate a random AES key (hex)
        let encryption_key;
        if (isEncrypted) {
            const crypto = await Promise.resolve().then(() => __importStar(require('crypto')));
            encryption_key = crypto.randomBytes(32).toString('hex');
        }
        const channel = await client.createChannel({
            channel_name: name,
            company: company_id,
            description: [description, policies ? `\n\nRichtlinien: ${policies}` : ''].filter(Boolean).join(''),
            type: isEncrypted ? 'private' : 'public',
            visible: !hidden,
            writable: !read_only,
            inviteable: !invite_only, // inviteable=false → only managers can invite
            show_activities: show_activities ?? true,
            show_membership_activities: show_membership_activities ?? true,
            ...(isPassword && password ? { password, password_repeat: password_repeat ?? password } : {}),
            ...(isEncrypted ? { encryption_key } : {}),
        });
        console.log(`[channels/create] created channel: ${channel.name ?? name}`);
        res.json(channel);
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create channel' });
    }
});
app.post('/api/conversations/:convId/favorite', async (req, res) => {
    try {
        const client = await getClient(req);
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
        res.status(500).json({ error: e.message });
    }
});
// ── Create conversation ───────────────────────────────────────────────────────
app.post('/api/conversations', async (req, res) => {
    try {
        const client = await getClient(req);
        const { member_ids } = req.body;
        const conversation = await client.createConversation(member_ids);
        console.log(`[conversations/create] created conversation with ${member_ids.length} member(s)`);
        res.json(conversation);
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create conversation' });
    }
});
// ── Conversations ─────────────────────────────────────────────────────────────
app.get('/api/conversations', async (req, res) => {
    try {
        const token = extractToken(req);
        const payload = (0, token_crypto_1.decryptSession)(token);
        const client = await getClient(req);
        const limit = Number(req.query.limit) || 50;
        const offset = Number(req.query.offset) || 0;
        const conversations = await client.getConversations({ limit, offset });
        // Discover bot in background (non-blocking) so we can filter it
        findChatBot(client, payload.clientKey).catch(() => { });
        // Filter out the Chat Bot conversation
        const filtered = conversations.filter((c) => !isBotConversation(String(c.id), payload.clientKey));
        res.json(filtered);
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
    }
});
// ── Messages ──────────────────────────────────────────────────────────────────
// ── Specific message routes MUST come before the generic :type/:targetId routes ──
app.post('/api/messages/:messageId/like', async (req, res) => {
    try {
        const client = await getClient(req);
        await client.likeMessage(req.params.messageId);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
    }
});
app.get('/api/messages/:messageId/likes', async (req, res) => {
    try {
        const client = await getClient(req);
        const likes = await client.listLikes(req.params.messageId);
        res.json({ likes });
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
    }
});
app.post('/api/messages/:messageId/unlike', async (req, res) => {
    try {
        const client = await getClient(req);
        await client.unlikeMessage(req.params.messageId);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
    }
});
app.delete('/api/messages/:messageId', async (req, res) => {
    try {
        const client = await getClient(req);
        await client.deleteMessage(req.params.messageId);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
    }
});
// ── Generic message routes (must be AFTER specific ones) ─────────────────────
app.get('/api/messages/:type/:targetId', async (req, res) => {
    try {
        const client = await getClient(req);
        const { type, targetId } = req.params;
        const limit = Number(req.query.limit) || 40;
        const offset = Number(req.query.offset) || 0;
        const chatType = type;
        const messages = await client.getMessages(targetId, chatType, { limit, offset });
        const sorted = [...messages].sort((a, b) => (Number(a.time) || 0) - (Number(b.time) || 0));
        res.json(sorted);
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
    }
});
app.post('/api/messages/:type/:targetId', async (req, res) => {
    try {
        const client = await getClient(req);
        const { type, targetId } = req.params;
        const { text, is_forwarded, reply_to_id, files } = req.body;
        const chatType = type;
        await client.sendMessage({ target: targetId, target_type: chatType, text, is_forwarded, reply_to_id, files });
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
    }
});
app.post('/api/messages/:type/:targetId/read', async (req, res) => {
    try {
        const client = await getClient(req);
        const { type, targetId } = req.params;
        const { messageId } = req.body;
        const chatType = type;
        if (messageId) {
            await client.markAsRead(targetId, chatType, messageId);
        }
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
    }
});
// ── File Browser ─────────────────────────────────────────────────────────────
/** List folder contents for channel, conversation, or personal storage */
app.get('/api/files/folder', async (req, res) => {
    try {
        const client = await getClient(req);
        const { type, typeId, folderId, offset, limit } = req.query;
        const result = await client.listFolder({
            type: type,
            type_id: typeId,
            folder_id: folderId ?? '0',
            offset: offset ? Number(offset) : 0,
            limit: limit ? Number(limit) : 200,
        });
        console.log(`[files/folder] type=${type} typeId=${typeId} folderId=${folderId ?? '0'} → folders=${result.folder.length} files=${result.files.length}`);
        if (result.files.length > 0)
            console.log('[files/folder] first file:', JSON.stringify(result.files[0]));
        res.json(result);
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
    }
});
app.get('/api/files/personal', async (req, res) => {
    try {
        const client = await getClient(req);
        const { folderId, offset, limit } = req.query;
        const result = await client.listPersonalFiles({
            folder_id: folderId ?? '0',
            offset: offset ? Number(offset) : 0,
            limit: limit ? Number(limit) : 200,
        });
        console.log(`[files/personal] folderId=${folderId ?? '0'} → folders=${result.folder.length} files=${result.files.length}`);
        if (result.files.length > 0)
            console.log('[files/personal] first file:', JSON.stringify(result.files[0]));
        else if (result.folder.length > 0)
            console.log('[files/personal] first folder:', JSON.stringify(result.folder[0]));
        res.json(result);
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
    }
});
/** Silent file upload (no message sent) — for file browser */
app.post('/api/files/upload', upload.single('file'), async (req, res) => {
    const tmpPath = req.file?.path;
    try {
        const client = await getClient(req);
        if (!req.file)
            throw new Error('No file received');
        const { type, typeId, folderId } = req.body;
        const originalName = req.file.originalname;
        const ext = path_1.default.extname(originalName);
        const namedPath = tmpPath + ext;
        await promises_1.default.rename(tmpPath, namedPath);
        let resolvedTypeId = typeId;
        if (type === 'personal' && !resolvedTypeId) {
            const me = await client.getMe();
            resolvedTypeId = String(me.id);
        }
        await client.uploadFile(namedPath, {
            type,
            type_id: resolvedTypeId,
            folder: folderId,
            filename: originalName,
        });
        await promises_1.default.unlink(namedPath).catch(() => { });
        res.json({ ok: true });
    }
    catch (err) {
        if (tmpPath)
            await promises_1.default.unlink(tmpPath).catch(() => { });
        res.status(500).json({ error: err instanceof Error ? err.message : 'Upload failed' });
    }
});
app.post('/api/files/:fileId/move', async (req, res) => {
    try {
        const client = await getClient(req);
        const { target_folder_id } = req.body;
        await client.moveFile(req.params.fileId, target_folder_id);
        res.json({ ok: true });
    }
    catch (e) {
        res.status(500).json({ error: e.message });
    }
});
app.delete('/api/files/:fileId', async (req, res) => {
    try {
        const client = await getClient(req);
        await client.deleteFiles([req.params.fileId]);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
    }
});
app.patch('/api/files/:fileId', async (req, res) => {
    try {
        const client = await getClient(req);
        const { name } = req.body;
        await client.renameFile(req.params.fileId, name);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
    }
});
// ── File Download ─────────────────────────────────────────────────────────────
app.get('/api/file/:fileId', async (req, res) => {
    try {
        const client = await getClient(req);
        const { fileId } = req.params;
        const fileName = req.query.name || 'download';
        const info = await client.getFileInfo(fileId);
        const buf = await client.downloadFile({
            id: fileId,
            encrypted: info.encrypted,
            e2e_iv: info.e2e_iv ?? null,
        });
        const disposition = req.query.view === '1' ? 'inline' : 'attachment';
        res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(fileName)}"`);
        res.setHeader('Content-Type', info.mime || 'application/octet-stream');
        res.send(buf);
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Download failed' });
    }
});
// ── File Upload ───────────────────────────────────────────────────────────────
app.post('/api/upload/:type/:targetId', upload.single('file'), async (req, res) => {
    const tmpPath = req.file?.path;
    try {
        const client = await getClient(req);
        const { type, targetId } = req.params;
        const chatType = type;
        if (!req.file)
            throw new Error('No file received');
        const originalName = req.file.originalname;
        const ext = path_1.default.extname(originalName);
        const namedPath = tmpPath + ext;
        await promises_1.default.rename(tmpPath, namedPath);
        const fileInfo = await client.uploadFile(namedPath, {
            type: chatType,
            type_id: targetId,
            filename: originalName,
        });
        await promises_1.default.unlink(namedPath).catch(() => { });
        await client.sendMessage({
            target: targetId,
            target_type: chatType,
            text: req.body.text || '',
            files: [fileInfo.id],
        });
        res.json({ ok: true, file: fileInfo });
    }
    catch (err) {
        if (tmpPath)
            await promises_1.default.unlink(tmpPath).catch(() => { });
        res.status(500).json({ error: err instanceof Error ? err.message : 'Upload failed' });
    }
});
// ── User ──────────────────────────────────────────────────────────────────────
app.get('/api/me', async (req, res) => {
    try {
        const client = await getClient(req);
        res.json(await client.getMe());
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
    }
});
// ── Link Preview ──────────────────────────────────────────────────────────────
const linkPreviewCache = new Map();
const PREVIEW_TTL = 3600_000; // 1 hour
app.get('/api/link-preview', async (req, res) => {
    try {
        const url = req.query.url;
        if (!url || !/^https?:\/\//.test(url)) {
            return res.status(400).json({ error: 'Invalid URL' });
        }
        // Check cache
        const cached = linkPreviewCache.get(url);
        if (cached && Date.now() - cached.fetchedAt < PREVIEW_TTL) {
            return res.json(cached);
        }
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const response = await fetch(url, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; LinkPreviewBot/1.0)',
                'Accept': 'text/html,application/xhtml+xml',
            },
            redirect: 'follow',
        });
        clearTimeout(timeout);
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
            return res.json({ title: url, fetchedAt: Date.now() });
        }
        // Only read first 64kb for meta extraction
        const reader = response.body?.getReader();
        let html = '';
        if (reader) {
            const decoder = new TextDecoder();
            let bytesRead = 0;
            while (bytesRead < 65536) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                html += decoder.decode(value, { stream: true });
                bytesRead += value.length;
            }
            reader.cancel().catch(() => { });
        }
        // Extract Open Graph and meta tags
        const getMetaContent = (nameOrProp) => {
            // Try og/twitter property
            const propRe = new RegExp(`<meta[^>]+(?:property|name)=["']${nameOrProp}["'][^>]+content=["']([^"']+)["']`, 'i');
            const propMatch = html.match(propRe);
            if (propMatch)
                return propMatch[1];
            // Try reversed order: content before property
            const revRe = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${nameOrProp}["']`, 'i');
            const revMatch = html.match(revRe);
            if (revMatch)
                return revMatch[1];
            return undefined;
        };
        const title = getMetaContent('og:title')
            || getMetaContent('twitter:title')
            || html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim();
        const description = getMetaContent('og:description')
            || getMetaContent('twitter:description')
            || getMetaContent('description');
        const image = getMetaContent('og:image')
            || getMetaContent('twitter:image');
        const siteName = getMetaContent('og:site_name');
        // Decode HTML entities in extracted strings
        const decode = (s) => s?.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
        const result = {
            title: decode(title) || url,
            description: decode(description),
            image: image?.startsWith('http') ? image : undefined,
            siteName: decode(siteName),
            fetchedAt: Date.now(),
        };
        linkPreviewCache.set(url, result);
        res.json(result);
    }
    catch (err) {
        // Return minimal preview on failure
        res.json({ title: req.query.url, fetchedAt: Date.now() });
    }
});
// ── Broadcasts ───────────────────────────────────────────────────────────────
app.get('/api/broadcasts', async (req, res) => {
    try {
        const client = await getClient(req);
        res.json(await client.listBroadcasts());
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
    }
});
app.post('/api/broadcasts', async (req, res) => {
    try {
        const client = await getClient(req);
        const { name, memberIds } = req.body;
        res.json(await client.createBroadcast(name, memberIds));
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
    }
});
app.delete('/api/broadcasts/:id', async (req, res) => {
    try {
        const client = await getClient(req);
        await client.deleteBroadcast(req.params.id);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
    }
});
app.patch('/api/broadcasts/:id', async (req, res) => {
    try {
        const client = await getClient(req);
        const { name } = req.body;
        await client.renameBroadcast(req.params.id, name);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
    }
});
app.get('/api/broadcasts/:id/messages', async (req, res) => {
    try {
        const client = await getClient(req);
        const limit = Number(req.query.limit) || 50;
        const offset = Number(req.query.offset) || 0;
        const messages = await client.getBroadcastContent({
            list_id: req.params.id,
            limit,
            offset,
        });
        res.json(messages);
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
    }
});
app.post('/api/broadcasts/:id/messages', async (req, res) => {
    try {
        const client = await getClient(req);
        const { text } = req.body;
        const msg = await client.sendBroadcastMessage({ list_id: req.params.id, text });
        res.json(msg);
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
    }
});
app.get('/api/broadcasts/:id/members', async (req, res) => {
    try {
        const client = await getClient(req);
        res.json(await client.listBroadcastMembers(req.params.id));
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
    }
});
app.post('/api/broadcasts/:id/members', async (req, res) => {
    try {
        const client = await getClient(req);
        const { memberIds } = req.body;
        await client.addBroadcastMembers(req.params.id, memberIds);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
    }
});
app.delete('/api/broadcasts/:id/members', async (req, res) => {
    try {
        const client = await getClient(req);
        const { memberIds } = req.body;
        await client.removeBroadcastMembers(req.params.id, memberIds);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
    }
});
// ── Calendar ─────────────────────────────────────────────────────────────────
app.get('/api/calendar/events', async (req, res) => {
    try {
        const client = await getClient(req);
        const start = Number(req.query.start);
        const end = Number(req.query.end);
        if (!start || !end)
            return res.status(400).json({ error: 'start and end required' });
        res.json(await client.listEvents({ start, end }));
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
    }
});
app.get('/api/calendar/events/:id', async (req, res) => {
    try {
        const client = await getClient(req);
        const event = await client.getEventDetails([req.params.id]);
        if (!event)
            return res.status(404).json({ error: 'Event not found' });
        res.json(event);
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
    }
});
app.post('/api/calendar/events', async (req, res) => {
    try {
        const client = await getClient(req);
        const eventId = await client.createEvent(req.body);
        res.json({ id: eventId });
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
    }
});
app.put('/api/calendar/events/:id', async (req, res) => {
    try {
        const client = await getClient(req);
        const eventId = await client.editEvent({ ...req.body, event_id: req.params.id });
        res.json({ id: eventId });
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
    }
});
app.delete('/api/calendar/events/:id', async (req, res) => {
    try {
        const client = await getClient(req);
        await client.deleteEvents([req.params.id]);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
    }
});
app.post('/api/calendar/events/:id/respond', async (req, res) => {
    try {
        const client = await getClient(req);
        const { status: rsvp } = req.body;
        const me = await client.getMe();
        await client.respondToEvent(req.params.id, String(me.id), rsvp);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
    }
});
app.post('/api/calendar/events/:id/invite', async (req, res) => {
    try {
        const client = await getClient(req);
        const { userIds } = req.body;
        await client.inviteToEvent(req.params.id, userIds);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
    }
});
app.get('/api/calendar/channels/:companyId', async (req, res) => {
    try {
        const client = await getClient(req);
        res.json(await client.listChannelsHavingEvents(req.params.companyId));
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
    }
});
// ── Notifications ─────────────────────────────────────────────────────────────
app.get('/api/notifications', async (req, res) => {
    try {
        const client = await getClient(req);
        const limit = Number(req.query.limit) || 50;
        const offset = Number(req.query.offset) || 0;
        res.json(await client.getNotifications(limit, offset));
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
    }
});
app.get('/api/notifications/count', async (req, res) => {
    try {
        const client = await getClient(req);
        res.json(await client.getNotificationCount());
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
    }
});
app.delete('/api/notifications/:notificationId', async (req, res) => {
    try {
        const client = await getClient(req);
        await client.deleteNotification(req.params.notificationId);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
    }
});
// ── Video Meeting (Chat Bot integration) ──────────────────────────────────────
/** Returns true if a member object looks like the Stashcat Chat Bot */
function looksLikeChatBot(member) {
    if (Boolean(member.is_bot))
        return true;
    const first = String(member.first_name || '').trim().toLowerCase();
    const last = String(member.last_name || '').trim().toLowerCase();
    const full = `${first} ${last}`;
    return full === 'chat bot' || first === 'chat bot' || last === 'chat bot';
}
async function findChatBot(client, clientKey) {
    // Check cache first
    const cached = botCache.get(clientKey);
    if (cached)
        return cached;
    try {
        // Scan up to 200 conversations for the Chat Bot (two pages of 100)
        for (const offset of [0, 100]) {
            const conversations = await client.getConversations({ limit: 100, offset });
            console.log(`[Video] Scanning ${conversations.length} conversations at offset ${offset}`);
            for (const conv of conversations) {
                // members may be a flat array or may be missing – try both field names
                const rawMembers = (conv.members ?? conv.participants ?? []);
                // If members have no user details (only IDs), fetch the full conversation
                let members = rawMembers;
                if (members.length > 0 && !members[0].first_name) {
                    try {
                        const full = await client.getConversation(String(conv.id));
                        members = (full.members ?? full.participants ?? []);
                    }
                    catch { /* ignore */ }
                }
                for (const member of members) {
                    if (looksLikeChatBot(member)) {
                        const info = { botUserId: String(member.id ?? member.user_id), botConvId: String(conv.id) };
                        botCache.set(clientKey, info);
                        console.log(`[Video] Found Chat Bot: userId=${info.botUserId}, convId=${info.botConvId}`);
                        return info;
                    }
                }
            }
            if (conversations.length < 100)
                break; // no more pages
        }
        // Bot not found in conversations — try company members as fallback
        console.warn('[Video] Chat Bot not found in conversations. Searching company members...');
        try {
            const companies = await client.getCompanies();
            for (const company of companies) {
                const companyId = String(company.id);
                // getCompanyMembers fetches members; the bot user should be in there
                const members = await client.getCompanyMembers(companyId);
                for (const member of members) {
                    if (looksLikeChatBot(member)) {
                        const botUserId = String(member.id ?? member.user_id);
                        console.log(`[Video] Found Chat Bot via company members: userId=${botUserId}, creating conversation...`);
                        // Create/get the 1:1 conversation with the bot
                        const conv = await client.createConversation([botUserId]);
                        const botConvId = String(conv.id);
                        const info = { botUserId, botConvId };
                        botCache.set(clientKey, info);
                        console.log(`[Video] Bot conversation created/found: convId=${botConvId}`);
                        return info;
                    }
                }
            }
        }
        catch (fallbackErr) {
            console.warn('[Video] Company member fallback failed:', fallbackErr);
        }
    }
    catch (err) {
        console.warn('[Video] Failed to search for Chat Bot:', err);
    }
    return null;
}
/** Check if a conversation is the Chat Bot conversation */
function isBotConversation(convId, clientKey) {
    const bot = botCache.get(clientKey);
    return bot ? bot.botConvId === convId : false;
}
/** Check if a message sender is the Chat Bot */
function isBotMessage(senderId, clientKey) {
    const bot = botCache.get(clientKey);
    return bot ? bot.botUserId === senderId : false;
}
/** Extract sender ID from a raw message object (sender can be string or object) */
function extractSenderId(msg) {
    const sender = msg.sender;
    if (typeof sender === 'string')
        return sender;
    if (sender && typeof sender === 'object') {
        const s = sender;
        return String(s.id ?? s.user_id ?? '');
    }
    return '';
}
/** Extract all stash.cat meeting links from message text */
function extractMeetingLinks(text) {
    // Links can appear as __https://stash.cat/l/xxx__ (markdown) or plain
    // Use non-greedy match and strip trailing underscores/punctuation
    const re = /https?:\/\/stash\.cat\/l\/([a-zA-Z0-9]+)/g;
    const links = [];
    let m;
    while ((m = re.exec(text)) !== null) {
        links.push(`https://stash.cat/l/${m[1]}`); // reconstruct clean URL without trailing __
    }
    return links;
}
app.post('/api/video/start-meeting', async (req, res) => {
    let clientKey = '';
    try {
        const token = extractToken(req);
        const payload = (0, token_crypto_1.decryptSession)(token);
        clientKey = payload.clientKey;
        const client = await getClient(req);
        // 1. Find Chat Bot
        const botInfo = await findChatBot(client, clientKey);
        if (!botInfo) {
            return res.status(503).json({ error: 'Chat Bot nicht gefunden. Schreibe zuerst eine Nachricht an den "Chat Bot" in der App, dann versuche es erneut.' });
        }
        // 2. Record existing message IDs before sending /meet (to detect new bot replies)
        const existingMsgs = await client.getMessages(botInfo.botConvId, 'conversation', { limit: 10, offset: 0 });
        const existingIds = new Set(existingMsgs.map((m) => String(m.id)));
        console.log(`[Video] Existing message IDs: ${[...existingIds].join(', ')}`);
        // 3. Send /meet to the bot conversation
        await client.sendMessage({
            target: botInfo.botConvId,
            target_type: 'conversation',
            text: '/meet',
        });
        console.log(`[Video] Sent /meet to bot conv ${botInfo.botConvId}`);
        // 4. Poll for NEW bot response messages (max 30 seconds, every 500ms)
        let inviteLink = null;
        let moderatorLink = null;
        for (let attempt = 0; attempt < 60; attempt++) {
            await new Promise((r) => setTimeout(r, 500));
            const messages = await client.getMessages(botInfo.botConvId, 'conversation', { limit: 10, offset: 0 });
            for (const msg of messages) {
                const msgId = String(msg.id);
                if (existingIds.has(msgId))
                    continue; // Skip pre-existing messages
                const senderId = extractSenderId(msg);
                if (senderId !== botInfo.botUserId)
                    continue; // Only bot messages
                const text = String(msg.text || '');
                const links = extractMeetingLinks(text);
                console.log(`[Video] Attempt ${attempt + 1} — new bot msg id=${msgId}, links=${JSON.stringify(links)}, text=${text.slice(0, 150)}`);
                if (links.length === 0)
                    continue;
                // Classify by keywords in the message text
                const isInvite = text.includes('weitergeben') || text.includes('Teilnehmer') || text.includes('einzuladen');
                const isModerator = text.includes('starten') || text.includes('nur für dich') || text.includes('Konferenz ist bereit');
                if (isInvite) {
                    inviteLink = links[0];
                }
                else if (isModerator) {
                    moderatorLink = links[0];
                }
                else if (links.length >= 2) {
                    // Single message contains both links (invite first, moderator second)
                    inviteLink = inviteLink ?? links[0];
                    moderatorLink = moderatorLink ?? links[1];
                }
                else {
                    // Unclassified single link: assign to whichever slot is still empty
                    if (!inviteLink)
                        inviteLink = links[0];
                    else if (!moderatorLink)
                        moderatorLink = links[0];
                }
                // Mark this message ID so we don't re-process it
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
        res.status(500).json({ error: err instanceof Error ? err.message : 'Videokonferenz konnte nicht erstellt werden' });
    }
});
// ── Polls (Umfragen) ─────────────────────────────────────────────────────────
/** List polls — live-verified constraint values (2026-03-27):
 *  'created_by_and_not_archived' = eigene, aktive Umfragen
 *  'invited_and_not_archived'    = eingeladene, aktive Umfragen
 *  'archived_or_over'            = archivierte / abgelaufene Umfragen */
app.get('/api/polls', async (req, res) => {
    try {
        const client = await getClient(req);
        const constraint = req.query.constraint || 'invited_and_not_archived';
        let companyId = req.query.company_id;
        if (!companyId) {
            const companies = await client.getCompanies();
            const c = companies[0];
            companyId = c?.id ? String(c.id) : undefined;
            if (!companyId)
                return res.status(500).json({ error: 'Kein Unternehmen gefunden' });
        }
        const polls = await client.listPolls(constraint, companyId);
        res.json(polls);
    }
    catch (err) {
        res.status(500).json({ error: String(err) });
    }
});
/** Get poll details including questions and all answers */
app.get('/api/polls/:id', async (req, res) => {
    try {
        const client = await getClient(req);
        const companyId = req.query.company_id;
        const poll = await client.getPollDetails(req.params.id, companyId || '');
        // Fetch answers for each question
        if (poll.questions && poll.questions.length > 0) {
            const questionsWithAnswers = await Promise.all(poll.questions.map(async (q) => {
                const answers = await client.listPollAnswers(String(q.id)).catch(() => []);
                return { ...q, answers };
            }));
            poll.questions = questionsWithAnswers;
        }
        res.json(poll);
    }
    catch (err) {
        res.status(500).json({ error: String(err) });
    }
});
/**
 * Create a full poll in one request:
 * { name, description?, start_time, end_time, privacy_type?, hidden_results?,
 *   questions: [{ name, answer_limit?, answers: string[] }],
 *   invite_channel_ids?: string[], invite_conversation_ids?: string[],
 *   notify_chat_id?: string, notify_chat_type?: 'channel'|'conversation' }
 */
app.post('/api/polls', async (req, res) => {
    try {
        const client = await getClient(req);
        // 1. Determine company_id
        const companies = await client.getCompanies();
        const companyId = String(companies[0]?.id ?? '');
        if (!companyId)
            throw new Error('Kein Unternehmen gefunden');
        const { name, description, start_time, end_time, privacy_type, hidden_results, questions = [], invite_channel_ids = [], invite_conversation_ids = [], notify_chat_id, notify_chat_type } = req.body;
        // 2. Create the poll
        const poll = await client.createPoll({
            company_id: companyId, name,
            ...(description ? { description } : {}),
            ...(hidden_results !== undefined ? { hidden_results } : {}),
            ...(privacy_type ? { privacy_type: privacy_type } : {}),
            start_time, end_time,
        });
        const pollId = String(poll.id);
        // 3. Create questions + answers sequentially
        for (let qi = 0; qi < questions.length; qi++) {
            const q = questions[qi];
            const question = await client.createPollQuestion({
                company_id: companyId, poll_id: pollId,
                name: q.name, type: 'text',
                ...(q.answer_limit !== undefined ? { answer_limit: q.answer_limit } : {}),
                position: qi,
            });
            for (let ai = 0; ai < q.answers.length; ai++) {
                await client.createPollAnswer({
                    company_id: companyId, question_id: String(question.id),
                    type: 'text', answer_text: q.answers[ai], position: ai,
                });
            }
        }
        // 4. Invite channels
        if (invite_channel_ids.length > 0) {
            await client.inviteToPoll(pollId, companyId, 'channels', invite_channel_ids).catch((e) => {
                console.warn(`[Poll] inviteToPoll channels failed:`, e instanceof Error ? e.message : e);
            });
        }
        // 5. Invite conversations (resolve members → invite as users)
        if (invite_conversation_ids.length > 0) {
            const userIds = new Set();
            for (const convId of invite_conversation_ids) {
                const conv = await client.getConversation(convId).catch(() => null);
                if (conv) {
                    const members = conv.members;
                    (members ?? []).forEach((m) => { if (m.id)
                        userIds.add(String(m.id)); });
                }
            }
            if (userIds.size > 0) {
                await client.inviteToPoll(pollId, companyId, 'users', [...userIds]).catch(() => { });
            }
        }
        // 6. Publish the poll
        const published = await client.publishPoll(pollId);
        if (!published) {
            // publishPoll returned false — try once more after a short delay
            await new Promise((r) => setTimeout(r, 800));
            const retry = await client.publishPoll(pollId).catch(() => false);
            if (!retry)
                console.warn(`[Poll] publishPoll returned false for poll ${pollId} — poll may remain as draft`);
        }
        // 7. Send notification message to ALL selected chats
        const startDate = new Date(start_time * 1000).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const endDate = new Date(end_time * 1000).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
        const msgText = `📊 **Neue Umfrage: „${name}"**\n${description ? description + '\n' : ''}Zeitraum: ${startDate} – ${endDate}\n\nÖffne den Bereich „Umfragen" in der App, um teilzunehmen.`;
        const notifyTargets = [];
        for (const id of invite_channel_ids)
            notifyTargets.push({ id, type: 'channel' });
        for (const id of invite_conversation_ids)
            notifyTargets.push({ id, type: 'conversation' });
        // Also notify the source chat if opened from a specific chat (avoids duplicates)
        if (notify_chat_id && notify_chat_type && !notifyTargets.some((t) => t.id === notify_chat_id)) {
            notifyTargets.push({ id: notify_chat_id, type: notify_chat_type });
        }
        for (const target of notifyTargets) {
            await client.sendMessage({ target: target.id, target_type: target.type, text: msgText }).catch(() => { });
        }
        res.json({ id: pollId });
    }
    catch (err) {
        res.status(500).json({ error: String(err) });
    }
});
/** Delete a poll */
app.delete('/api/polls/:id', async (req, res) => {
    try {
        const client = await getClient(req);
        await client.deletePoll(req.params.id);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: String(err) });
    }
});
/** Archive / unarchive a poll */
app.post('/api/polls/:id/archive', async (req, res) => {
    try {
        const client = await getClient(req);
        const archive = req.body.archive !== false;
        await client.archivePoll(req.params.id, archive);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: String(err) });
    }
});
/** Submit answers for a question — { question_id, answer_ids: string[] } */
app.post('/api/polls/:id/answer', async (req, res) => {
    try {
        const client = await getClient(req);
        const { question_id, answer_ids } = req.body;
        await client.storePollUserAnswers(question_id, answer_ids);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: String(err) });
    }
});
// ── Production: serve static frontend from dist/ ─────────────────────────────
// Serve static frontend — try dist/ first, then project root (for Plesk)
{
    const cwd = process.cwd();
    const distPath = path_1.default.resolve(cwd, 'dist');
    console.log(`[Static] Serving frontend from ${distPath} and ${cwd}`);
    // dist/ takes priority (contains built assets)
    app.use(express_1.default.static(distPath));
    // Also serve from project root (Plesk may set cwd to project root)
    app.use(express_1.default.static(cwd));
    // SPA fallback: serve the BUILT index.html (not the dev one)
    app.get('{*path}', (_req, res) => {
        res.sendFile(path_1.default.join(distPath, 'index.html'));
    });
}
// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT) || 3001;
app.listen(PORT, () => {
    console.log(`BBZ Chat backend running on http://localhost:${PORT}`);
});
