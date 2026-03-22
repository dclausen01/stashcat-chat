import express from 'express';
import cors from 'cors';
import multer from 'multer';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { StashcatClient, CryptoManager } from 'stashcat-api';
import type { RealtimeManager } from 'stashcat-api';
import type { MessageSyncPayload } from 'stashcat-api';
import { saveSession, loadSessions, deleteSession } from './session-store';

// Multer: store uploads in OS temp dir
const upload = multer({ dest: os.tmpdir() });

const app = express();
app.use(cors());
app.use(express.json());

// ── Session store ─────────────────────────────────────────────────────────────

interface Session {
  client: StashcatClient;
  realtime?: RealtimeManager;
  // SSE clients listening for this session's events
  sseClients: Set<express.Response>;
}

const sessions = new Map<string, Session>();

function generateToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function getSession(req: express.Request): Session {
  // Support token both as Bearer header and as ?token= query param (for EventSource/download links)
  const token = req.headers.authorization?.replace('Bearer ', '') || (req.query.token as string);
  if (!token) throw new Error('No token');
  const session = sessions.get(token);
  if (!session) throw new Error('Invalid session');
  return session;
}

function pushSSE(session: Session, event: string, data: unknown) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of session.sseClients) {
    try { res.write(payload); } catch { session.sseClients.delete(res); }
  }
}

// ── Realtime setup (shared between login and session restore) ─────────────────

function connectRealtime(client: StashcatClient, session: Session, tokenHint: string) {
  client.createRealtimeManager({ reconnect: true }).then((rt) => {
    session.realtime = rt;
    return rt.connect();
  }).then(() => {
    const rt = session.realtime!;

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

      pushSSE(session, 'message_sync', payload);
    });

    rt.on('user-started-typing', (chatType: string, chatId: number, userId: number) => {
      pushSSE(session, 'typing', { chatType, chatId, userId });
    });

    console.log(`[Realtime] Connected for session ${tokenHint.slice(0, 8)}…`);
  }).catch((err: unknown) => {
    console.warn('[Realtime] Connection failed:', err);
  });
}

// ── Auth ──────────────────────────────────────────────────────────────────────

app.post('/api/login', async (req, res) => {
  try {
    const { email, password, securityPassword } = req.body;
    const effectiveSecurityPassword = securityPassword || password;

    const client = new StashcatClient({ baseUrl: 'https://api.stashcat.com/' });
    await client.login({ email, password, securityPassword: effectiveSecurityPassword });

    const token = generateToken();
    const session: Session = { client, sseClients: new Set() };
    sessions.set(token, session);

    const me = await client.getMe();
    res.json({ token, user: me });

    // Persist session for survival across server restarts
    saveSession(token, client.serialize(), effectiveSecurityPassword).catch(() => {});

    // Connect realtime in background (non-blocking)
    connectRealtime(client, session, token);

  } catch (err) {
    res.status(401).json({ error: err instanceof Error ? err.message : 'Login failed' });
  }
});

app.post('/api/logout', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) {
    const session = sessions.get(token);
    session?.realtime?.disconnect();
    sessions.delete(token);
    // Remove from persistent store
    deleteSession(token).catch(() => {});
  }
  res.json({ ok: true });
});

// ── Server-Sent Events ────────────────────────────────────────────────────────

app.get('/api/events', (req, res) => {
  let session: Session;
  try { session = getSession(req); } catch { res.status(401).end(); return; }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  // Heartbeat every 25 s to keep the connection alive
  const hb = setInterval(() => { try { res.write(': heartbeat\n\n'); } catch { clearInterval(hb); } }, 25_000);

  session.sseClients.add(res);

  req.on('close', () => {
    clearInterval(hb);
    session.sseClients.delete(res);
  });
});

// ── Typing ────────────────────────────────────────────────────────────────────

app.post('/api/typing', (req, res) => {
  try {
    const session = getSession(req);
    const { type, targetId } = req.body as { type: 'channel' | 'conversation'; targetId: string };
    session.realtime?.sendTyping(type, targetId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

// ── Companies ─────────────────────────────────────────────────────────────────

app.get('/api/companies', async (req, res) => {
  try {
    const { client } = getSession(req);
    res.json(await client.getCompanies());
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

// ── Channels ──────────────────────────────────────────────────────────────────

app.get('/api/channels/:companyId', async (req, res) => {
  try {
    const { client } = getSession(req);
    res.json(await client.getChannels(req.params.companyId));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

app.get('/api/channels/:channelId/members', async (req, res) => {
  try {
    const { client } = getSession(req);
    res.json(await client.getChannelMembers(req.params.channelId));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

// ── Conversations ─────────────────────────────────────────────────────────────

app.get('/api/conversations', async (req, res) => {
  try {
    const { client } = getSession(req);
    const limit = Number(req.query.limit) || 50;
    const offset = Number(req.query.offset) || 0;
    res.json(await client.getConversations({ limit, offset }));
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

// ── Messages ──────────────────────────────────────────────────────────────────

app.get('/api/messages/:type/:targetId', async (req, res) => {
  try {
    const { client } = getSession(req);
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
    const { client } = getSession(req);
    const { type, targetId } = req.params;
    const { text } = req.body as { text: string };
    const chatType = type as 'channel' | 'conversation';
    await client.sendMessage({ target: targetId, target_type: chatType, text });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

app.post('/api/messages/:messageId/like', async (req, res) => {
  try {
    const { client } = getSession(req);
    await client.likeMessage(req.params.messageId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

app.post('/api/messages/:messageId/unlike', async (req, res) => {
  try {
    const { client } = getSession(req);
    await client.unlikeMessage(req.params.messageId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

app.delete('/api/messages/:messageId', async (req, res) => {
  try {
    const { client } = getSession(req);
    await client.deleteMessage(req.params.messageId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

app.post('/api/messages/:type/:targetId/read', async (req, res) => {
  try {
    const { client } = getSession(req);
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

// ── File Download ─────────────────────────────────────────────────────────────

app.get('/api/file/:fileId', async (req, res) => {
  try {
    const { client } = getSession(req);
    const { fileId } = req.params;
    const fileName = (req.query.name as string) || 'download';

    const info = await client.getFileInfo(fileId);
    const buf = await client.downloadFile({
      id: fileId,
      encrypted: info.encrypted,
      e2e_iv: info.e2e_iv ?? null,
    });

    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
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
    const { client } = getSession(req);
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
    const { client } = getSession(req);
    res.json(await client.getMe());
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

// ── Startup: restore persisted sessions ───────────────────────────────────────

async function restorePersistedSessions(): Promise<void> {
  const stored = await loadSessions();
  if (stored.length === 0) return;

  console.log(`[SessionStore] Restoring ${stored.length} session(s)…`);

  await Promise.allSettled(stored.map(async ({ token, serialized, securityPassword }) => {
    try {
      const client = StashcatClient.fromSession(serialized, { baseUrl: serialized.baseUrl });

      // Verify session is still valid against Stashcat server
      await client.getMe();

      // Re-unlock E2E decryption
      if (securityPassword) {
        await client.unlockE2E(securityPassword);
      }

      const session: Session = { client, sseClients: new Set() };
      sessions.set(token, session);

      // Reconnect realtime in background
      connectRealtime(client, session, token);

      console.log(`[SessionStore] Restored session ${token.slice(0, 8)}…`);
    } catch (err) {
      console.warn(`[SessionStore] Session ${token.slice(0, 8)}… expired or invalid — removing`);
      await deleteSession(token).catch(() => {});
    }
  }));
}

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT) || 3001;

restorePersistedSessions().then(() => {
  app.listen(PORT, () => {
    console.log(`SchulChat backend running on http://localhost:${PORT}`);
  });
}).catch((err) => {
  console.error('Failed to restore sessions:', err);
  app.listen(PORT, () => {
    console.log(`SchulChat backend running on http://localhost:${PORT}`);
  });
});
