import express from 'express';
import cors from 'cors';
import multer from 'multer';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { StashcatClient, CryptoManager } from 'stashcat-api';
import type { RealtimeManager } from 'stashcat-api';
import type { MessageSyncPayload } from 'stashcat-api';
import { encryptSession, decryptSession } from './token-crypto';

// Multer: store uploads in OS temp dir
const upload = multer({ dest: os.tmpdir() });

const app = express();
app.use(cors());
app.use(express.json());

// ── Client cache with TTL ────────────────────────────────────────────────────

interface CachedClient {
  client: StashcatClient;
  expiresAt: number;
}
const clientCache = new Map<string, CachedClient>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// Cleanup expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of clientCache) {
    if (now > entry.expiresAt) clientCache.delete(key);
  }
}, 60_000);

// ── SSE connection tracking ──────────────────────────────────────────────────

interface SSEConnection {
  client: StashcatClient;
  realtime?: RealtimeManager;
  sseClients: Set<express.Response>;
}
const activeSSE = new Map<string, SSEConnection>(); // keyed by clientKey

function pushSSE(clientKey: string, event: string, data: unknown) {
  const conn = activeSSE.get(clientKey);
  if (!conn) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of conn.sseClients) {
    try { res.write(payload); } catch { conn.sseClients.delete(res); }
  }
}

// ── Client resolution ────────────────────────────────────────────────────────

function extractToken(req: express.Request): string {
  const token = req.headers.authorization?.replace('Bearer ', '') || (req.query.token as string);
  if (!token) throw new Error('No token');
  return token;
}

async function getClient(req: express.Request): Promise<StashcatClient> {
  const token = extractToken(req);
  const payload = decryptSession(token);

  // Check cache
  const cached = clientCache.get(payload.clientKey);
  if (cached && Date.now() < cached.expiresAt) {
    cached.expiresAt = Date.now() + CACHE_TTL; // Refresh TTL
    return cached.client;
  }

  // Create new client
  const client = StashcatClient.fromSession(
    { deviceId: payload.deviceId, clientKey: payload.clientKey },
    { baseUrl: payload.baseUrl }
  );

  // Unlock E2E
  if (payload.securityPassword) {
    await client.unlockE2E(payload.securityPassword);
  }

  clientCache.set(payload.clientKey, { client, expiresAt: Date.now() + CACHE_TTL });
  return client;
}

// ── Realtime setup ───────────────────────────────────────────────────────────

function connectRealtime(client: StashcatClient, clientKey: string) {
  client.createRealtimeManager({ reconnect: true }).then((rt) => {
    const conn = activeSSE.get(clientKey);
    if (!conn) { rt.disconnect(); return; }
    conn.realtime = rt;
    return rt.connect();
  }).then(() => {
    const conn = activeSSE.get(clientKey);
    if (!conn?.realtime) return;
    const rt = conn.realtime;

    rt.on('message_sync', async (data: MessageSyncPayload) => {
      const payload = { ...data };

      // Decrypt message text if E2E-encrypted
      if (data.encrypted && data.text && data.iv) {
        try {
          let aesKey: Buffer | undefined;
          const channelId = data.channel_id && data.channel_id !== 0 ? String(data.channel_id) : null;
          const convId    = data.conversation_id && data.conversation_id !== 0 ? String(data.conversation_id) : null;

          if (convId) {
            aesKey = await client.getConversationAesKey(convId);
          } else if (channelId) {
            aesKey = await client.getChannelAesKey(channelId);
          }

          if (aesKey) {
            const iv = CryptoManager.hexToBuffer(data.iv);
            payload.text = CryptoManager.decrypt(data.text, aesKey, iv);
          }
        } catch (err) {
          console.warn('[Realtime] Failed to decrypt message_sync:', (err as Error).message);
        }
      }

      pushSSE(clientKey, 'message_sync', payload);
    });

    rt.on('user-started-typing', (chatType: string, chatId: number, userId: number) => {
      pushSSE(clientKey, 'typing', { chatType, chatId, userId });
    });

    console.log(`[Realtime] Connected for clientKey ${clientKey.slice(0, 8)}…`);
  }).catch((err: unknown) => {
    console.warn('[Realtime] Connection failed:', err);
  });
}

// ── Auth ──────────────────────────────────────────────────────────────────────

app.post('/api/login', async (req, res) => {
  try {
    const { email, password, securityPassword } = req.body;
    const effectiveSecurityPassword = securityPassword || password;
    const baseUrl = process.env.STASHCAT_BASE_URL || 'https://api.stashcat.com/';

    const client = new StashcatClient({ baseUrl });
    await client.login({ email, password, securityPassword: effectiveSecurityPassword });

    const serialized = client.serialize();
    const token = encryptSession({
      deviceId: serialized.deviceId,
      clientKey: serialized.clientKey,
      securityPassword: effectiveSecurityPassword,
      baseUrl,
    });

    // Cache the client
    clientCache.set(serialized.clientKey, { client, expiresAt: Date.now() + CACHE_TTL });

    const me = await client.getMe();
    res.json({ token, user: me });

  } catch (err) {
    res.status(401).json({ error: err instanceof Error ? err.message : 'Login failed' });
  }
});

app.post('/api/logout', async (req, res) => {
  try {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) {
      const payload = decryptSession(token);
      // Clean up cache and SSE
      clientCache.delete(payload.clientKey);
      const sse = activeSSE.get(payload.clientKey);
      if (sse) {
        sse.realtime?.disconnect();
        activeSSE.delete(payload.clientKey);
      }
    }
  } catch { /* token may be invalid, that's fine */ }
  res.json({ ok: true });
});

// ── Server-Sent Events ────────────────────────────────────────────────────────

app.get('/api/events', async (req, res) => {
  let client: StashcatClient;
  let clientKey: string;
  try {
    const token = extractToken(req);
    const payload = decryptSession(token);
    clientKey = payload.clientKey;
    client = await getClient(req);
  } catch { res.status(401).end(); return; }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Heartbeat every 25 s to keep the connection alive
  const hb = setInterval(() => { try { res.write(': heartbeat\n\n'); } catch { clearInterval(hb); } }, 25_000);

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
    const payload = decryptSession(token);
    const { type, targetId } = req.body as { type: 'channel' | 'conversation'; targetId: string };
    const conn = activeSSE.get(payload.clientKey);
    conn?.realtime?.sendTyping(type, targetId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

// ── Companies ─────────────────────────────────────────────────────────────────

app.get('/api/companies', async (req, res) => {
  try {
    const client = await getClient(req);
    res.json(await client.getCompanies());
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

// ── Channels ──────────────────────────────────────────────────────────────────

app.get('/api/channels/:companyId', async (req, res) => {
  try {
    const client = await getClient(req);
    res.json(await client.getChannels(req.params.companyId));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

app.get('/api/channels/:channelId/members', async (req, res) => {
  try {
    const client = await getClient(req);
    const channelId = req.params.channelId;
    // Paginate until all members are fetched (channels can have 500+ members)
    // Note: Stashcat API has a hard cap of ~100 per request regardless of limit param
    const all: unknown[] = [];
    const PAGE = 100;
    let offset = 0;
    while (true) {
      const batch = await client.getChannelMembers(channelId, { limit: PAGE, offset });
      all.push(...batch);
      if (batch.length < PAGE) break;
      offset += PAGE;
    }
    console.log(`[channels/members] channelId=${channelId} → ${all.length} members`);
    if (all.length > 0) console.log('[channels/members] first member:', JSON.stringify(all[0]));
    res.json(all);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

app.post('/api/channels/:channelId/invite', async (req, res) => {
  try {
    const client = await getClient(req);
    const { userIds } = req.body as { userIds: string[] };
    await client.inviteUsersToChannel(req.params.channelId, userIds);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

app.delete('/api/channels/:channelId/members/:userId', async (req, res) => {
  try {
    const client = await getClient(req);
    await client.removeUserFromChannel(req.params.channelId, req.params.userId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

// ── Moderator management ─────────────────────────────────────────────────────

app.post('/api/channels/:channelId/moderator/:userId', async (req, res) => {
  try {
    const client = await getClient(req);
    await client.addChannelModerator(req.params.channelId, req.params.userId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

app.delete('/api/channels/:channelId/moderator/:userId', async (req, res) => {
  try {
    const client = await getClient(req);
    await client.removeChannelModerator(req.params.channelId, req.params.userId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

// ── Channel editing ──────────────────────────────────────────────────────────

app.patch('/api/channels/:channelId', async (req, res) => {
  try {
    const client = await getClient(req);
    const { description, company_id } = req.body as { description?: string; company_id: string };
    const result = await client.editChannel({
      channel_id: req.params.channelId,
      company_id,
      description,
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

// ── Company members (via /manage/list_users) ─────────────────────────────────

app.get('/api/companies/:companyId/members', async (req, res) => {
  try {
    const client = await getClient(req);
    const search = req.query.search as string | undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;

    const result = await client.listManagedUsers(req.params.companyId, { search, limit, offset });
    res.json({ users: result.users, total: result.total });
  } catch (err) {
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
  } catch (err) {
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
  } catch (err) {
    console.error('[group-members] Error:', err);
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

// ── Create channel ────────────────────────────────────────────────────────────

app.post('/api/channels', async (req, res) => {
  try {
    const client = await getClient(req);
    const {
      name, company_id, description, policies,
      channel_type,                      // 'public' | 'encrypted' | 'password'
      hidden, invite_only, read_only,
      show_activities, show_membership_activities,
      password, password_repeat,
    } = req.body as {
      name: string;
      company_id: string;
      description?: string;
      policies?: string;
      channel_type?: string;
      hidden?: boolean;
      invite_only?: boolean;
      read_only?: boolean;
      show_activities?: boolean;
      show_membership_activities?: boolean;
      password?: string;
      password_repeat?: string;
    };

    // Map channel_type to API params
    const isEncrypted = channel_type === 'encrypted';
    const isPassword  = channel_type === 'password';

    // For encrypted channels generate a random AES key (hex)
    let encryption_key: string | undefined;
    if (isEncrypted) {
      const crypto = await import('crypto');
      encryption_key = crypto.randomBytes(32).toString('hex');
    }

    const channel = await client.createChannel({
      channel_name: name,
      company: company_id,
      description: [description, policies ? `\n\nRichtlinien: ${policies}` : ''].filter(Boolean).join(''),
      type: isEncrypted ? 'private' : 'public',
      visible: !hidden,
      writable: !read_only,
      inviteable: !invite_only,          // inviteable=false → only managers can invite
      show_activities: show_activities ?? true,
      show_membership_activities: show_membership_activities ?? true,
      ...(isPassword && password ? { password, password_repeat: password_repeat ?? password } : {}),
      ...(isEncrypted ? { encryption_key } : {}),
    });
    console.log(`[channels/create] created channel: ${(channel as Record<string,unknown>).name ?? name}`);
    res.json(channel);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create channel' });
  }
});

// ── Create conversation ───────────────────────────────────────────────────────

app.post('/api/conversations', async (req, res) => {
  try {
    const client = await getClient(req);
    const { member_ids } = req.body as { member_ids: string[] };
    const conversation = await client.createConversation(member_ids);
    console.log(`[conversations/create] created conversation with ${member_ids.length} member(s)`);
    res.json(conversation);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create conversation' });
  }
});

// ── Conversations ─────────────────────────────────────────────────────────────

app.get('/api/conversations', async (req, res) => {
  try {
    const client = await getClient(req);
    const limit = Number(req.query.limit) || 50;
    const offset = Number(req.query.offset) || 0;
    res.json(await client.getConversations({ limit, offset }));
  } catch (err) {
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
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

app.get('/api/messages/:messageId/likes', async (req, res) => {
  try {
    const client = await getClient(req);
    const likes = await client.listLikes(req.params.messageId);
    res.json({ likes });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

app.post('/api/messages/:messageId/unlike', async (req, res) => {
  try {
    const client = await getClient(req);
    await client.unlikeMessage(req.params.messageId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

app.delete('/api/messages/:messageId', async (req, res) => {
  try {
    const client = await getClient(req);
    await client.deleteMessage(req.params.messageId);
    res.json({ ok: true });
  } catch (err) {
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
    const chatType = type as 'channel' | 'conversation';
    const messages = await client.getMessages(targetId, chatType, { limit, offset });
    const sorted = [...messages].sort(
      (a: Record<string, unknown>, b: Record<string, unknown>) =>
        (Number(a.time) || 0) - (Number(b.time) || 0)
    );
    res.json(sorted);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

app.post('/api/messages/:type/:targetId', async (req, res) => {
  try {
    const client = await getClient(req);
    const { type, targetId } = req.params;
    const { text, is_forwarded } = req.body as { text: string; is_forwarded?: boolean };
    const chatType = type as 'channel' | 'conversation';
    await client.sendMessage({ target: targetId, target_type: chatType, text, is_forwarded });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

app.post('/api/messages/:type/:targetId/read', async (req, res) => {
  try {
    const client = await getClient(req);
    const { type, targetId } = req.params;
    const { messageId } = req.body as { messageId?: string };
    const chatType = type as 'channel' | 'conversation';
    if (messageId) {
      await client.markAsRead(targetId, chatType, messageId);
    }
    res.json({ ok: true });
  } catch (err) {
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
      type: type as string,
      type_id: typeId as string,
      folder_id: (folderId as string | undefined) ?? '0',
      offset: offset ? Number(offset) : 0,
      limit: limit ? Number(limit) : 200,
    });
    console.log(`[files/folder] type=${type} typeId=${typeId} folderId=${folderId ?? '0'} → folders=${result.folder.length} files=${result.files.length}`);
    if (result.files.length > 0) console.log('[files/folder] first file:', JSON.stringify(result.files[0]));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

app.get('/api/files/personal', async (req, res) => {
  try {
    const client = await getClient(req);
    const { folderId, offset, limit } = req.query;
    const result = await client.listPersonalFiles({
      folder_id: (folderId as string | undefined) ?? '0',
      offset: offset ? Number(offset) : 0,
      limit: limit ? Number(limit) : 200,
    });
    console.log(`[files/personal] folderId=${folderId ?? '0'} → folders=${result.folder.length} files=${result.files.length}`);
    if (result.files.length > 0) console.log('[files/personal] first file:', JSON.stringify(result.files[0]));
    else if (result.folder.length > 0) console.log('[files/personal] first folder:', JSON.stringify(result.folder[0]));
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

/** Silent file upload (no message sent) — for file browser */
app.post('/api/files/upload', upload.single('file'), async (req, res) => {
  const tmpPath = req.file?.path;
  try {
    const client = await getClient(req);
    if (!req.file) throw new Error('No file received');

    const { type, typeId, folderId } = req.body as { type: string; typeId?: string; folderId?: string };
    const originalName = req.file.originalname;
    const ext = path.extname(originalName);
    const namedPath = tmpPath + ext;
    await fs.rename(tmpPath!, namedPath);

    let resolvedTypeId = typeId;
    if (type === 'personal' && !resolvedTypeId) {
      const me = await client.getMe() as Record<string, unknown>;
      resolvedTypeId = String(me.id);
    }

    await client.uploadFile(namedPath, {
      type,
      type_id: resolvedTypeId,
      folder: folderId,
      filename: originalName,
    });

    await fs.unlink(namedPath).catch(() => {});
    res.json({ ok: true });
  } catch (err) {
    if (tmpPath) await fs.unlink(tmpPath).catch(() => {});
    res.status(500).json({ error: err instanceof Error ? err.message : 'Upload failed' });
  }
});

app.delete('/api/files/:fileId', async (req, res) => {
  try {
    const client = await getClient(req);
    await client.deleteFiles([req.params.fileId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

app.patch('/api/files/:fileId', async (req, res) => {
  try {
    const client = await getClient(req);
    const { name } = req.body as { name: string };
    await client.renameFile(req.params.fileId, name);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

// ── File Download ─────────────────────────────────────────────────────────────

app.get('/api/file/:fileId', async (req, res) => {
  try {
    const client = await getClient(req);
    const { fileId } = req.params;
    const fileName = (req.query.name as string) || 'download';

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
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Download failed' });
  }
});

// ── File Upload ───────────────────────────────────────────────────────────────

app.post('/api/upload/:type/:targetId', upload.single('file'), async (req, res) => {
  const tmpPath = req.file?.path;
  try {
    const client = await getClient(req);
    const { type, targetId } = req.params;
    const chatType = type as 'channel' | 'conversation';

    if (!req.file) throw new Error('No file received');

    const originalName = req.file.originalname;
    const ext = path.extname(originalName);
    const namedPath = tmpPath + ext;
    await fs.rename(tmpPath!, namedPath);

    const fileInfo = await client.uploadFile(namedPath, {
      type: chatType,
      type_id: targetId,
      filename: originalName,
    });

    await fs.unlink(namedPath).catch(() => {});

    await client.sendMessage({
      target: targetId,
      target_type: chatType,
      text: req.body.text || '',
      files: [fileInfo.id],
    });

    res.json({ ok: true, file: fileInfo });
  } catch (err) {
    if (tmpPath) await fs.unlink(tmpPath).catch(() => {});
    res.status(500).json({ error: err instanceof Error ? err.message : 'Upload failed' });
  }
});

// ── User ──────────────────────────────────────────────────────────────────────

app.get('/api/me', async (req, res) => {
  try {
    const client = await getClient(req);
    res.json(await client.getMe());
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

// ── Link Preview ──────────────────────────────────────────────────────────────

const linkPreviewCache = new Map<string, { title?: string; description?: string; image?: string; siteName?: string; fetchedAt: number }>();
const PREVIEW_TTL = 3600_000; // 1 hour

app.get('/api/link-preview', async (req, res) => {
  try {
    const url = req.query.url as string;
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
        if (done) break;
        html += decoder.decode(value, { stream: true });
        bytesRead += value.length;
      }
      reader.cancel().catch(() => {});
    }

    // Extract Open Graph and meta tags
    const getMetaContent = (nameOrProp: string): string | undefined => {
      // Try og/twitter property
      const propRe = new RegExp(`<meta[^>]+(?:property|name)=["']${nameOrProp}["'][^>]+content=["']([^"']+)["']`, 'i');
      const propMatch = html.match(propRe);
      if (propMatch) return propMatch[1];
      // Try reversed order: content before property
      const revRe = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${nameOrProp}["']`, 'i');
      const revMatch = html.match(revRe);
      if (revMatch) return revMatch[1];
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
    const decode = (s?: string) => s?.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");

    const result = {
      title: decode(title) || url,
      description: decode(description),
      image: image?.startsWith('http') ? image : undefined,
      siteName: decode(siteName),
      fetchedAt: Date.now(),
    };

    linkPreviewCache.set(url, result);
    res.json(result);
  } catch (err) {
    // Return minimal preview on failure
    res.json({ title: req.query.url, fetchedAt: Date.now() });
  }
});

// ── Broadcasts ───────────────────────────────────────────────────────────────

app.get('/api/broadcasts', async (req, res) => {
  try {
    const client = await getClient(req);
    res.json(await client.listBroadcasts());
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

app.post('/api/broadcasts', async (req, res) => {
  try {
    const client = await getClient(req);
    const { name, memberIds } = req.body as { name: string; memberIds: string[] };
    res.json(await client.createBroadcast(name, memberIds));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

app.delete('/api/broadcasts/:id', async (req, res) => {
  try {
    const client = await getClient(req);
    await client.deleteBroadcast(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

app.patch('/api/broadcasts/:id', async (req, res) => {
  try {
    const client = await getClient(req);
    const { name } = req.body as { name: string };
    await client.renameBroadcast(req.params.id, name);
    res.json({ ok: true });
  } catch (err) {
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
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

app.post('/api/broadcasts/:id/messages', async (req, res) => {
  try {
    const client = await getClient(req);
    const { text } = req.body as { text: string };
    const msg = await client.sendBroadcastMessage({ list_id: req.params.id, text });
    res.json(msg);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

app.get('/api/broadcasts/:id/members', async (req, res) => {
  try {
    const client = await getClient(req);
    res.json(await client.listBroadcastMembers(req.params.id));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

app.post('/api/broadcasts/:id/members', async (req, res) => {
  try {
    const client = await getClient(req);
    const { memberIds } = req.body as { memberIds: string[] };
    await client.addBroadcastMembers(req.params.id, memberIds);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

app.delete('/api/broadcasts/:id/members', async (req, res) => {
  try {
    const client = await getClient(req);
    const { memberIds } = req.body as { memberIds: string[] };
    await client.removeBroadcastMembers(req.params.id, memberIds);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

// ── Calendar ─────────────────────────────────────────────────────────────────

app.get('/api/calendar/events', async (req, res) => {
  try {
    const client = await getClient(req);
    const start = Number(req.query.start);
    const end = Number(req.query.end);
    if (!start || !end) return res.status(400).json({ error: 'start and end required' });
    res.json(await client.listEvents({ start, end }));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

app.get('/api/calendar/events/:id', async (req, res) => {
  try {
    const client = await getClient(req);
    const event = await client.getEventDetails([req.params.id]);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    res.json(event);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

app.post('/api/calendar/events', async (req, res) => {
  try {
    const client = await getClient(req);
    const eventId = await client.createEvent(req.body);
    res.json({ id: eventId });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

app.put('/api/calendar/events/:id', async (req, res) => {
  try {
    const client = await getClient(req);
    const eventId = await client.editEvent({ ...req.body, event_id: req.params.id });
    res.json({ id: eventId });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

app.delete('/api/calendar/events/:id', async (req, res) => {
  try {
    const client = await getClient(req);
    await client.deleteEvents([req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

app.post('/api/calendar/events/:id/respond', async (req, res) => {
  try {
    const client = await getClient(req);
    const { status: rsvp } = req.body as { status: string };
    const me = await client.getMe() as Record<string, unknown>;
    await client.respondToEvent(req.params.id, String(me.id), rsvp as 'accepted' | 'declined' | 'open');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

app.post('/api/calendar/events/:id/invite', async (req, res) => {
  try {
    const client = await getClient(req);
    const { userIds } = req.body as { userIds: string[] };
    await client.inviteToEvent(req.params.id, userIds);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

app.get('/api/calendar/channels/:companyId', async (req, res) => {
  try {
    const client = await getClient(req);
    res.json(await client.listChannelsHavingEvents(req.params.companyId));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

// ── Production: serve static frontend from dist/ ─────────────────────────────

if (process.env.NODE_ENV === 'production') {
  const distPath = path.join(__dirname, '..', 'dist');
  app.use(express.static(distPath));
  // SPA fallback: all non-API routes → index.html
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT) || 3001;

app.listen(PORT, () => {
  console.log(`BBZ Chat backend running on http://localhost:${PORT}`);
});
