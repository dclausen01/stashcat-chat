import express from 'express';
import cors from 'cors';
import { StashcatClient } from 'stashcat-api';

const app = express();
app.use(cors());
app.use(express.json());

// Session store: token -> StashcatClient instance
const sessions = new Map<string, StashcatClient>();

function generateToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function getClient(req: express.Request): StashcatClient {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) throw new Error('No token');
  const client = sessions.get(token);
  if (!client) throw new Error('Invalid session');
  return client;
}

// --- Auth ---

app.post('/api/login', async (req, res) => {
  try {
    const { email, password, securityPassword } = req.body;
    const client = new StashcatClient({ baseUrl: 'https://api.stashcat.com/' });
    await client.login({ email, password, securityPassword: securityPassword || password });
    const token = generateToken();
    sessions.set(token, client);
    const me = await client.getMe();
    res.json({ token, user: me });
  } catch (err) {
    res.status(401).json({ error: err instanceof Error ? err.message : 'Login failed' });
  }
});

app.post('/api/logout', (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (token) sessions.delete(token);
  res.json({ ok: true });
});

// --- Companies ---

app.get('/api/companies', async (req, res) => {
  try {
    const client = getClient(req);
    const companies = await client.getCompanies();
    res.json(companies);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

// --- Channels ---

app.get('/api/channels/:companyId', async (req, res) => {
  try {
    const client = getClient(req);
    const channels = await client.getChannels(req.params.companyId);
    res.json(channels);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

app.get('/api/channels/:channelId/members', async (req, res) => {
  try {
    const client = getClient(req);
    const members = await client.getChannelMembers(req.params.channelId);
    res.json(members);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

// --- Conversations ---

app.get('/api/conversations', async (req, res) => {
  try {
    const client = getClient(req);
    const limit = Number(req.query.limit) || 50;
    const offset = Number(req.query.offset) || 0;
    const conversations = await client.getConversations({ limit, offset });
    res.json(conversations);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

// --- Messages ---

app.get('/api/messages/:type/:targetId', async (req, res) => {
  try {
    const client = getClient(req);
    const { type, targetId } = req.params;
    const limit = Number(req.query.limit) || 40;
    const offset = Number(req.query.offset) || 0;
    const chatType = type as 'channel' | 'conversation';
    const messages = await client.getMessages(targetId, chatType, { limit, offset });
    // Sort ascending by time so newest messages appear at the bottom
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
    const client = getClient(req);
    const { type, targetId } = req.params;
    const { text } = req.body;
    const chatType = type as 'channel' | 'conversation';
    await client.sendMessage(targetId, chatType, text);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

app.post('/api/messages/:type/:targetId/read', async (req, res) => {
  try {
    const client = getClient(req);
    const { type, targetId } = req.params;
    const chatType = type as 'channel' | 'conversation';
    await client.markAsRead(targetId, chatType);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

// --- User ---

app.get('/api/me', async (req, res) => {
  try {
    const client = getClient(req);
    const me = await client.getMe();
    res.json(me);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed' });
  }
});

// --- Start ---

const PORT = Number(process.env.PORT) || 3001;
app.listen(PORT, () => {
  console.log(`SchulChat backend running on http://localhost:${PORT}`);
});
