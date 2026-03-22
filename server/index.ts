import express from 'express';
import cors from 'cors';
import { StashcatClient } from 'stashcat-api';
import type { RealtimeManager } from 'stashcat-api';
import type { MessageSyncPayload } from 'stashcat-api';

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
  const token = req.headers.authorization?.replace('Bearer ', '');
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

// ── Auth ──────────────────────────────────────────────────────────────────────

app.post('/api/login', async (req, res) => {
  try {
    const { email, password, securityPassword } = req.body;
    const client = new StashcatClient({ baseUrl: 'https://api.stashcat.com/' });
    await client.login({ email, password, securityPassword: securityPassword || password });

    const token = generateToken();
    const session: Session = { client, sseClients: new Set() };
    sessions.set(token, session);

    const me = await client.getMe();
    res.json({ token, user: me });

    // Connect realtime in background (non-blocking)
    client.createRealtimeManager({ reconnect: true }).then((rt) => {
      session.realtime = rt;
      return rt.connect();
    }).then(() => {
      const rt = session.realtime!;

      rt.on('message_sync', (data: MessageSyncPayload) => {
        pushSSE(session, 'message_sync', data);
      });

      rt.on('user-started-typing', (chatType: string, chatId: number, userId: number) => {
        pushSSE(session, 'typing', { chatType, chatId, userId });
      });

      console.log(`[Realtime] Connected for session ${token.slice(0, 8)}…`);
    }).catch((err: unknown) => {
      console.warn('[Realtime] Connection failed:', err);
    });

  } catch (err) {
    res.status(401).json({ error: err instanceof Error ? err.message : 'Login failed' });
  }
});

app.post('/api/logout', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) {
    const session = sessions.get(token);
    session?.realtime?.disconnect();
    sessions.delete(token);
  }
  res.json({ ok: true });
});

// ── Server-Sent Events ────────────────────────────────────────────────────────

app.get('/api/events', (req, res) => {
  // EventSource can't set headers, so token comes as query param
  const token = (req.query.token as string) || req.headers.authorization?.replace('Bearer ', '');
  if (!token) { res.status(401).end(); return; }
  const session = sessions.get(token);
  if (!session) { res.status(401).end(); return; }

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
    // sendMessage expects a SendMessageOptions object
    await client.sendMessage({ target: targetId, target_type: chatType, text });
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

// ── User ──────────────────────────────────────────────────────────────────────

app.get('/api/me', async (req, res) => {
  try {
    const { client } = getSession(req);
    res.json(await client.getMe());
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT) || 3001;
app.listen(PORT, () => {
  console.log(`SchulChat backend running on http://localhost:${PORT}`);
});
