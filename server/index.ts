import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import * as fsSync from 'fs';
import { randomBytes, createHash, pbkdf2Sync, createDecipheriv } from 'crypto';
import { StashcatClient, CryptoManager, type RsaPrivateKeyJwk, type ActiveDevice } from 'stashcat-api';

function debugLog(...args: unknown[]) {
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  const logPath = path.join(process.cwd(), 'e2e-debug.log');
  try {
    fsSync.appendFileSync(logPath, line);
  } catch (e) {
    console.warn('[debugLog] could not write to', logPath, e instanceof Error ? e.message : e);
  }
  console.log(...args);
}

/** Server log to file for debugging - works in both dev and production */
function serverLog(...args: unknown[]) {
  const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  
  // Try multiple possible log locations (dev vs production)
  const possiblePaths = [
    path.join(process.cwd(), 'server.log'),
    path.join(process.cwd(), '..', 'server.log'),
    path.join('/tmp', 'stashcat-server.log'),
  ];
  
  let logged = false;
  for (const logPath of possiblePaths) {
    try {
      fsSync.appendFileSync(logPath, line);
      logged = true;
      break;
    } catch {
      // Try next path
    }
  }
  
  // Always log to console as fallback
  console.log(...args);
}
import type { RealtimeManager } from 'stashcat-api';
import type { MessageSyncPayload } from 'stashcat-api';
import { encryptSession, decryptSession } from './token-crypto';
import { getOfficeDocType, buildViewerConfig, validateDownloadToken, createDownloadToken, PUBLIC_URL } from './onlyoffice';
import { ncListFolder, ncDownload, ncUpload, ncDelete, ncMove, ncMkcol, ncQuota, ncProbe, ncCreateShare, type NCCredentials } from './nextcloud';

/** Extract error message safely from unknown catch values. */
function errorMessage(err: unknown, fallback = 'Failed'): string {
  return err instanceof Error ? err.message : fallback;
}

// Multer: store uploads in OS temp dir
const upload = multer({ dest: os.tmpdir() });

const app = express();
app.set('trust proxy', 1); // Trust first proxy (e.g. nginx) to get correct client IP for rate limiting
app.use(cors());
app.use(express.json());

// Rate limiting — exempt SSE endpoint and file/image endpoints
const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: 1000, // Increased to 1000 to allow fast channel switching and background requests
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/api/events' || req.path.startsWith('/api/file'),
});
app.use('/api/', apiLimiter);

// ── Client cache with TTL ────────────────────────────────────────────────────

interface CachedClient {
  client: StashcatClient;
  expiresAt: number;
}
const clientCache = new Map<string, CachedClient>();
const pendingClients = new Map<string, Promise<StashcatClient>>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// ── Chat Bot cache (for video meetings) ──────────────────────────────────────
interface BotInfo {
  botUserId: string;
  botConvId: string;
}
const botCache = new Map<string, BotInfo>(); // keyed by clientKey

// ── Pre-Auth cache (short-lived, for multi-step login) ───────────────────────

interface PreAuthEntry {
  client: StashcatClient;
  createdAt: number;
  expiresAt: number;
  loginPassword?: string;
}
const preAuthCache = new Map<string, PreAuthEntry>();
const PREAUTH_TTL = 5 * 60 * 1000; // 5 minutes
const PREAUTH_MAX_ENTRIES = 100;

// Cleanup expired entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of clientCache) {
    if (now > entry.expiresAt) clientCache.delete(key);
  }
  for (const [key, entry] of preAuthCache) {
    if (now > entry.expiresAt) preAuthCache.delete(key);
  }
}, 60_000);

// ── SSE connection tracking ──────────────────────────────────────────────────

interface SSEConnection {
  client: StashcatClient;
  realtime?: RealtimeManager;
  sseClients: Set<express.Response>;
}
const activeSSE = new Map<string, SSEConnection>(); // keyed by clientKey

/** Pending key_sync_request events received via Socket.io, keyed by clientKey → userId → event payload */
const pendingKeyRequests = new Map<string, Map<string, unknown>>();

function pushSSE(clientKey: string, event: string, data: unknown) {
  const conn = activeSSE.get(clientKey);
  if (!conn) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of conn.sseClients) {
    try {
      res.write(payload);
      if (typeof (res as unknown as Record<string, unknown>).flush === 'function') {
        (res as unknown as { flush: () => void }).flush();
      }
    } catch { conn.sseClients.delete(res); }
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
  const { clientKey, deviceId, baseUrl, securityPassword, privateKeyJwk } = payload;

  // Check cache
  const cached = clientCache.get(clientKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.client;
  }

  // Check if initialization is already in progress
  const pending = pendingClients.get(clientKey);
  if (pending) {
    console.log(`[getClient] clientKey=${clientKey?.slice(0,8)} waiting for pending initialization...`);
    return pending;
  }

  const initPromise = (async () => {
    try {
      console.log(`[getClient] clientKey=${clientKey?.slice(0,8)} initializing new client...`);
      // Create new client
      const client = StashcatClient.fromSession(
        { deviceId, clientKey },
        { baseUrl }
      );

      // Unlock E2E — either via securityPassword (legacy) or privateKeyJwk (device flow)
      if (securityPassword) {
        await client.unlockE2E(securityPassword);
      } else if (privateKeyJwk) {
        await client.unlockE2EWithPrivateKey(privateKeyJwk);
      } else {
        throw new Error('Session has no E2E unlock material');
      }

      clientCache.set(clientKey, { client, expiresAt: Date.now() + CACHE_TTL });
      return client;
    } finally {
      pendingClients.delete(clientKey);
    }
  })();

  pendingClients.set(clientKey, initPromise);
  return initPromise;
}

// ── Realtime setup ───────────────────────────────────────────────────────────

async function connectRealtime(client: StashcatClient, clientKey: string) {
  serverLog(`[Realtime] Connecting for clientKey ${clientKey.slice(0, 8)}…`);
  try {
    const rt = await client.createRealtimeManager({ reconnect: true, debug: true });
    const conn = activeSSE.get(clientKey);
    if (!conn) { 
      serverLog(`[Realtime] No SSE connection found, disconnecting RealtimeManager`);
      rt.disconnect(); 
      return; 
    }
    conn.realtime = rt;
    
    // Wait for new_device_connected (the critical auth event from Stashcat server)
    await new Promise<void>((resolve, reject) => {
      let resolved = false;
      
      // The server confirmation is the critical event
      rt.once('new_device_connected', () => {
        if (!resolved) {
          resolved = true;
          serverLog(`[Realtime] Auth confirmed (new_device_connected) for clientKey ${clientKey.slice(0, 8)}`);
          resolve();
        }
      });
      
      // Also listen for connect as fallback
      rt.once('connect', () => {
        serverLog(`[Realtime] Socket connected for clientKey ${clientKey.slice(0, 8)}`);
        // Don't resolve here - wait for new_device_connected
      });
      
      // Start connection
      rt.connect().catch((err) => {
        if (!resolved) {
          resolved = true;
          reject(err);
        }
      });
      
      // Timeout after 15 seconds (longer timeout for slow connections)
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(new Error(`Connection timeout: new_device_connected event not received`));
        }
      }, 15000);
    });
    
    serverLog(`[Realtime] RealtimeManager fully connected for clientKey ${clientKey.slice(0, 8)}`);

    // Handle connection errors
    rt.on('error', (err: Error) => {
      serverLog(`[Realtime] Error for clientKey ${clientKey.slice(0, 8)}:`, err.message);
    });

    // Handle connect_error — Socket.io fires this when it fails to establish
    // a connection. Without this handler, the server would never know that
    // the Socket.io client gave up, and the disconnect handler wouldn't fire.
    rt.on('connect_error', (err: Error) => {
      serverLog(`[Realtime] Connect error for clientKey ${clientKey.slice(0, 8)}:`, err.message);
      // Socket.io will auto-retry (reconnectionAttempts: Infinity after our fix),
      // so we don't need to manually reconnect here. But log it for diagnostics.
    });

    rt.on('disconnect', () => {
      serverLog(`[Realtime] Disconnected for clientKey ${clientKey.slice(0, 8)} — attempting reconnect`);
      // Auto-reconnect: if the SSE connection still has clients, re-establish the RealtimeManager
      setTimeout(() => {
        const conn = activeSSE.get(clientKey);
        if (conn && conn.sseClients.size > 0) {
          serverLog(`[Realtime] Reconnecting for clientKey ${clientKey.slice(0, 8)} (still has ${conn.sseClients.size} SSE clients)`);
          conn.realtime = undefined; // Clear stale reference
          connectRealtime(conn.client, clientKey).catch((err) => {
            serverLog(`[Realtime] Reconnect failed for ${clientKey.slice(0, 8)}:`, errorMessage(err));
          });
        } else {
          serverLog(`[Realtime] Skipping reconnect for ${clientKey.slice(0, 8)} (no more SSE clients)`);
        }
      }, 3000); // 3s delay to avoid rapid reconnect loops
    });

    rt.on('message_sync', async (data: MessageSyncPayload) => {
      serverLog(`[Realtime] Received message_sync:`, { 
        channel_id: data.channel_id, 
        conversation_id: data.conversation_id,
        id: data.id,
        hasText: !!data.text 
      });
      
      // Suppress Chat Bot conversation messages from reaching the frontend
      const convId = data.conversation_id && data.conversation_id !== 0 ? String(data.conversation_id) : null;
      if (convId && isBotConversation(convId, clientKey)) {
        serverLog(`[Realtime] Dropping bot message`);
        return; // Silently drop bot messages
      }

      const payload = { ...data };

      // Decrypt message text if E2E-encrypted
      if (data.encrypted && data.text && data.iv) {
        try {
          let aesKey: Buffer | undefined;
          const channelId = data.channel_id && data.channel_id !== 0 ? String(data.channel_id) : null;
          const msgConvId = data.conversation_id && data.conversation_id !== 0 ? String(data.conversation_id) : null;

          if (msgConvId) {
            aesKey = await client.getConversationAesKey(msgConvId);
          } else if (channelId) {
            aesKey = await client.getChannelAesKey(channelId);
          }

          if (aesKey) {
            const iv = CryptoManager.hexToBuffer(data.iv);
            payload.text = CryptoManager.decrypt(data.text, aesKey, iv);
          }
        } catch (err) {
          serverLog('[Realtime] Failed to decrypt message_sync:', errorMessage(err));
          payload.text = '[Nachricht konnte nicht entschlüsselt werden]';
        }
      }

      serverLog(`[Realtime] Pushing message_sync to SSE for clientKey ${clientKey.slice(0, 8)}`);
      pushSSE(clientKey, 'message_sync', payload);
    });

    // Incoming messages from others arrive as 'notification', not 'message_sync'.
    // 'message_sync' is only the sender's echo. Payload: { message: MessageSyncPayload }
    rt.on('notification', async (data: unknown) => {
      const raw = data as Record<string, unknown>;
      const msg = raw.message as MessageSyncPayload | undefined;
      if (!msg) {
        // Log non-message notifications so we can diagnose missed events
        serverLog(`[Realtime] Non-message notification received (keys: ${Object.keys(raw).join(', ')}):`, JSON.stringify(raw).slice(0, 500));
        return;
      }

      serverLog(`[Realtime] Received notification (new message):`, {
        channel_id: msg.channel_id,
        conversation_id: msg.conversation_id,
        id: msg.id,
      });

      // Suppress Chat Bot conversation messages
      const convId = msg.conversation_id && msg.conversation_id !== 0 ? String(msg.conversation_id) : null;
      if (convId && isBotConversation(convId, clientKey)) return;

      const payload: Record<string, unknown> = { ...msg };

      // Decrypt if E2E-encrypted
      if (msg.encrypted && msg.text && msg.iv) {
        try {
          let aesKey: Buffer | undefined;
          const channelId = msg.channel_id && msg.channel_id !== 0 ? String(msg.channel_id) : null;
          const msgConvId = msg.conversation_id && msg.conversation_id !== 0 ? String(msg.conversation_id) : null;
          if (msgConvId) aesKey = await client.getConversationAesKey(msgConvId);
          else if (channelId) aesKey = await client.getChannelAesKey(channelId);
          if (aesKey) {
            const iv = CryptoManager.hexToBuffer(msg.iv);
            payload.text = CryptoManager.decrypt(msg.text, aesKey, iv);
          }
        } catch (err) {
          serverLog('[Realtime] Failed to decrypt notification:', errorMessage(err));
          payload.text = '[Nachricht konnte nicht entschlüsselt werden]';
        }
      }

      serverLog(`[Realtime] Pushing notification as message_sync to SSE`);
      pushSSE(clientKey, 'message_sync', payload);
    });

    rt.on('user-started-typing', (chatType: string, chatId: number, userId: number) => {
      serverLog(`[Realtime] Received typing event:`, { chatType, chatId, userId });
      pushSSE(clientKey, 'typing', { chatType, chatId, userId });
    });

    // Forward key_sync_request to SSE so the frontend can display/auto-accept it
    rt.on('key_sync_request', (data: unknown) => {
      serverLog(`[Realtime] Received key_sync_request:`, JSON.stringify(data).slice(0, 300));
      pushSSE(clientKey, 'key_sync_request', data);
    });

    // Forward online status changes so the Sidebar can update availability dots in real-time
    rt.on('online_status_change', (data: unknown) => {
      serverLog(`[Realtime] Received online_status_change:`, JSON.stringify(data).slice(0, 300));
      pushSSE(clientKey, 'online_status_change', data);
    });

    // Forward call-related events to SSE so the browser can manage WebRTC
    rt.on('call_created', (data: unknown) => {
      serverLog(`[Realtime] call_created for clientKey ${clientKey.slice(0, 8)}`);
      pushSSE(clientKey, 'call_created', data);
    });

    rt.on('signal', (data: unknown) => {
      const sig = data as Record<string, unknown>;
      serverLog(`[Realtime] signal (${sig?.signalType}) for clientKey ${clientKey.slice(0, 8)}`);
      pushSSE(clientKey, 'call_signal', data);
    });

    rt.on('object_change', (data: unknown) => {
      const change = data as { type?: string };
      if (change?.type === 'call') {
        serverLog(`[Realtime] object_change (call) for clientKey ${clientKey.slice(0, 8)}`);
        pushSSE(clientKey, 'call_change', data);
      }
    });

    serverLog(`[Realtime] Connected for clientKey ${clientKey.slice(0, 8)}…`);
  } catch (err) {
    serverLog(`[Realtime] Connection failed:`, errorMessage(err));
  }
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
      loginPassword: password,
      baseUrl,
    });

    // Cache the client
    clientCache.set(serialized.clientKey, { client, expiresAt: Date.now() + CACHE_TTL });

    const me = await client.getMe();
    res.json({ token, user: me });

  } catch (err) {
    res.status(401).json({ error: errorMessage(err, 'Login failed') });
  }
});

// ── Phased Login (multi-step wizard) ─────────────────────────────────────────

/**
 * Helper: connect to push.stashcat.com via Socket.io to trigger device notification.
 * The official web client connects to push.stashcat.com immediately after login.
 * The Stashcat server detects this new connection and notifies all existing devices.
 * We only need to connect and wait briefly for the server to register the device —
 * no need to keep the connection alive.
 */
/**
 * Helper: connect to push.stashcat.com via Socket.io, then emit
 * key_sync_request to notify existing devices and receive the encrypted key.
 *
 * Reverse-engineered from official web client:
 *   key_sync_request(own_device_id, target_device_id) — sends to EACH existing device
 *
 * Since we don't know which device the user will use, we send to ALL devices
 * sequentially until one responds with key_sync_payload.
 */
/**
 * Helper: connect to push.stashcat.com, emit key_sync_request,
 * and listen for key_sync_payload in the background.
 * Does NOT wait for payload — returns immediately.
 * The payload is stored in the preAuth entry when it arrives.
 */
async function triggerDeviceNotification(client: StashcatClient, entry: unknown): Promise<void> {
  serverLog('[DeviceNotify] Creating RealtimeManager...');

  const allDevices = await client.listActiveDevices();
  const ownDeviceId = client.serialize().deviceId;

  serverLog('[DeviceNotify] Found', allDevices.length, 'total device(s), connecting to push...');

  const rt = await client.createRealtimeManager({ reconnect: false, debug: true });
  const socket = (rt as unknown as { socket: { emit: (event: string, ...args: unknown[]) => void } | null }).socket;

  // When key_sync_payload arrives, store it in the preAuth entry
  rt.on('key_sync_payload', (data: unknown) => {
    try {
      const parsed = data as Record<string, unknown> | undefined;
      if (parsed && typeof parsed.payload === 'object' && parsed.payload !== null) {
        const payload = parsed.payload as Record<string, unknown>;
        const jwkData = payload.encrypted_private_key_jwk;
        if (jwkData && typeof jwkData === 'object') {
          (entry as Record<string, unknown>).encryptedKeyData = JSON.stringify(jwkData);
          serverLog('[DeviceNotify] Stored encrypted key data:', JSON.stringify(jwkData).length, 'chars');
        } else if (typeof payload.encrypted_private_key_jwk === 'string') {
          (entry as Record<string, unknown>).encryptedKeyData = payload.encrypted_private_key_jwk;
          serverLog('[DeviceNotify] Stored encrypted key data (string)');
        }
      }
    } catch (e) {
      serverLog('[DeviceNotify] Error processing key_sync_payload:', e instanceof Error ? e.message : String(e));
    }
    setTimeout(() => { try { rt.disconnect(); } catch {} }, 1000);
  });

  rt.on('error', (err: Error) => {
    serverLog('[DeviceNotify] Error:', err.message);
  });

  rt.on('disconnect', () => {
    serverLog('[DeviceNotify] Disconnect event');
  });

  // Wait for new_device_connected, then emit key_sync_request
  rt.once('new_device_connected', () => {
    serverLog('[DeviceNotify] new_device_connected received (auth confirmed)');
    const sock = (rt as unknown as { socket: { emit: (event: string, ...args: unknown[]) => void } | null }).socket;
    if (sock) {
      const clientKey = client.serialize().clientKey;
      sock.emit('key_sync_request', ownDeviceId, clientKey);
      serverLog('[DeviceNotify] key_sync_request emitted:', ownDeviceId.slice(0, 8) + '...', 'client_key:', clientKey.slice(0, 8) + '...');
    } else {
      serverLog('[DeviceNotify] ERROR: socket is null!');
    }
  });

  rt.connect().then(() => {
    serverLog('[DeviceNotify] Socket.io connect OK, waiting for new_device_connected...');
    const sock = (rt as unknown as { socket: Record<string, unknown> }).socket;
    if (sock && typeof sock.onAny === 'function') {
      (sock.onAny as (handler: (event: string, ...args: unknown[]) => void) => void)((event: string, ...args: unknown[]) => {
        serverLog(`[DeviceNotify] 📡 "${event}"`, JSON.stringify(args).slice(0, 500));
      });
    }
  }).catch((err) => {
    serverLog('[DeviceNotify] connect() rejected:', err.message);
  });

  // Don't wait for payload — return immediately
}

/**
 * Step 1: Credentials — authenticate without E2E, return short-lived preAuthToken.
 */
app.post('/api/login/credentials', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }
    const baseUrl = process.env.STASHCAT_BASE_URL || 'https://api.stashcat.com/';

    serverLog('[LoginCredentials] Attempting loginWithoutE2E for', email);
    const client = new StashcatClient({ baseUrl });
    await client.loginWithoutE2E({ email, password });
    serverLog('[LoginCredentials] loginWithoutE2E successful');

    // Generate short-lived preAuthToken
    const preAuthToken = randomBytes(32).toString('hex');
    const createdAt = Date.now();

    // LRU eviction: drop oldest entry if at capacity
    if (preAuthCache.size >= PREAUTH_MAX_ENTRIES) {
      const oldestKey = [...preAuthCache.keys()][0];
      preAuthCache.delete(oldestKey);
    }

    preAuthCache.set(preAuthToken, {
      client,
      createdAt,
      expiresAt: createdAt + PREAUTH_TTL,
      loginPassword: password,
    });

    res.json({ preAuthToken });
  } catch (err) {
    res.status(401).json({ error: errorMessage(err, 'Login failed') });
  }
});

/**
 * Helper: consume a preAuthToken, validating TTL. Returns client + loginPassword.
 */
function consumePreAuthToken(preAuthToken: string): { client: StashcatClient; loginPassword?: string } | null {
  const entry = preAuthCache.get(preAuthToken);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    preAuthCache.delete(preAuthToken);
    return null;
  }
  preAuthCache.delete(preAuthToken);
  return { client: entry.client, loginPassword: entry.loginPassword };
}

/**
 * Step 2a: Password login — unlock E2E with securityPassword.
 */
app.post('/api/login/password', async (req, res) => {
  try {
    const { preAuthToken, securityPassword } = req.body;
    if (!preAuthToken || !securityPassword) {
      return res.status(400).json({ error: 'preAuthToken and securityPassword required' });
    }

    const preAuth = consumePreAuthToken(preAuthToken);
    if (!preAuth) {
      return res.status(400).json({ error: 'Invalid or expired preAuthToken' });
    }
    const { client, loginPassword } = preAuth;

    await client.unlockE2E(securityPassword);

    const serialized = client.serialize();
    const token = encryptSession({
      deviceId: serialized.deviceId,
      clientKey: serialized.clientKey,
      securityPassword,
      loginPassword,
      baseUrl: process.env.STASHCAT_BASE_URL || 'https://api.stashcat.com/',
    });

    clientCache.set(serialized.clientKey, { client, expiresAt: Date.now() + CACHE_TTL });
    const me = await client.getMe();
    res.json({ token, user: me });
  } catch (err) {
    res.status(401).json({ error: errorMessage(err, 'Failed to unlock E2E') });
  }
});

/**
 * Step 2: Initiate key transfer — connects to push.stashcat.com,
 * emits key_sync_request to notify all existing devices.
 * Returns immediately — key_sync_payload is stored in preAuth entry when it arrives.
 */
app.post('/api/login/device/initiate', async (req, res) => {
  try {
    const { preAuthToken } = req.body;
    if (!preAuthToken) {
      return res.status(400).json({ error: 'preAuthToken required' });
    }

    const entry = preAuthCache.get(preAuthToken);
    if (!entry || Date.now() > entry.expiresAt) {
      preAuthCache.delete(preAuthToken);
      return res.status(400).json({ error: 'Invalid or expired preAuthToken' });
    }

    // Fire-and-forget: trigger notification, payload will be stored in entry
    triggerDeviceNotification(entry.client, entry).catch((err) => {
      serverLog('[DeviceInitiate] Background error:', errorMessage(err));
    });

    res.json({ ok: true });
  } catch (err) {
    serverLog('[DeviceInitiate] Error:', errorMessage(err));
    res.status(500).json({ error: errorMessage(err, 'Failed to initiate key transfer') });
  }
});

/**
 * Decrypt the encrypted private key JWK using the 6-digit code.
 * The key_derivation_properties contains PBKDF2 params (salt, iterations).
 * KEK = PBKDF2(code, salt, iterations, 32, sha256)
 * Then decrypt ciphertext with AES-256-CBC using the KEK.
 */
function decryptJwkWithCode(encryptedJwkJson: string, code: string): RsaPrivateKeyJwk {
  const encryptedKey = JSON.parse(encryptedJwkJson);

  if (!encryptedKey.ciphertext || !encryptedKey.iv) {
    throw new Error('Invalid encrypted key structure');
  }

  const salt = Buffer.from(encryptedKey.key_derivation_properties?.salt || '', 'base64');
  const iterations = encryptedKey.key_derivation_properties?.iterations || 650000;

  // Derive KEK using PBKDF2
  const kek = pbkdf2Sync(code, salt, iterations, 32, 'sha256');

  // Decrypt ciphertext
  const ciphertextBuffer = Buffer.from(encryptedKey.ciphertext, 'base64');
  const ivBuffer = Buffer.from(encryptedKey.iv, 'base64');

  const decipher = createDecipheriv('aes-256-cbc', kek, ivBuffer);
  let decrypted = decipher.update(ciphertextBuffer);
  decrypted = Buffer.concat([decrypted, decipher.final()]);

  return JSON.parse(decrypted.toString('utf8')) as RsaPrivateKeyJwk;
}

/**
 * Step 3b: Complete key transfer with code from target device.
 * Decrypts the locally-received encrypted key data using the 6-digit code.
 */
app.post('/api/login/device/complete', async (req, res) => {
  try {
    const { preAuthToken, code } = req.body;
    if (!preAuthToken || !code) {
      return res.status(400).json({ error: 'preAuthToken and code required' });
    }

    const entry = preAuthCache.get(preAuthToken);
    if (!entry || Date.now() > entry.expiresAt) {
      preAuthCache.delete(preAuthToken);
      return res.status(400).json({ error: 'Invalid or expired preAuthToken' });
    }

    const client = entry.client;
    const loginPassword = entry.loginPassword;

    // Wait up to 30s for the encrypted key data to arrive (it's stored asynchronously)
    let encryptedKeyData: string | undefined;
    for (let attempt = 0; attempt < 30; attempt++) {
      encryptedKeyData = (entry as unknown as Record<string, unknown>).encryptedKeyData as string | undefined;
      if (encryptedKeyData) break;
      await new Promise(r => setTimeout(r, 1000));
    }

    if (!encryptedKeyData) {
      return res.status(400).json({
        error: 'Kein Gerät zur Authentifizierung verfügbar. Bitte schul.cloud auf einem eingeloggten Gerät öffnen!',
      });
    }

    serverLog('[DeviceComplete] Decrypting key with code...');
    const jwk = decryptJwkWithCode(encryptedKeyData, code);
    client.unlockE2EWithPrivateKey(jwk);
    serverLog('[DeviceComplete] E2E unlocked with decrypted JWK');

    const serialized = client.serialize();
    const token = encryptSession({
      deviceId: serialized.deviceId,
      clientKey: serialized.clientKey,
      privateKeyJwk: jwk,
      loginPassword,
      baseUrl: process.env.STASHCAT_BASE_URL || 'https://api.stashcat.com/',
    });

    clientCache.set(serialized.clientKey, { client, expiresAt: Date.now() + CACHE_TTL });
    const me = await client.getMe();
    res.json({ token, user: me });
  } catch (err) {
    serverLog('[DeviceComplete] Error:', errorMessage(err));
    res.status(401).json({ error: errorMessage(err, 'Failed to complete key transfer') });
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
        void Promise.resolve(sse.realtime?.disconnect?.()).catch(() => {});
        activeSSE.delete(payload.clientKey);
      }
    }
  } catch { /* token may be invalid, that's fine */ }
  res.json({ ok: true });
});

// ── Server-Sent Events ────────────────────────────────────────────────────────

app.get('/api/events', async (req, res) => {
  serverLog('[SSE] New connection request');
  let client: StashcatClient;
  let clientKey: string;
  try {
    const token = extractToken(req);
    const payload = decryptSession(token);
    clientKey = payload.clientKey;
    serverLog(`[SSE] Token valid, clientKey: ${clientKey.slice(0, 8)}...`);
    client = await getClient(req);
  } catch (err) { 
    serverLog('[SSE] Authentication failed:', errorMessage(err));
    res.status(401).end(); 
    return; 
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx response buffering for SSE
  res.flushHeaders();
  serverLog(`[SSE] Headers sent for clientKey: ${clientKey.slice(0, 8)}...`);

  // Heartbeat every 25 s to keep the connection alive.
  // Use a named event (not a comment) so the client can detect it
  // for its watchdog timer. SSE comments (`: ...`) are invisible to
  // EventSource.addEventListener and cannot be used for liveness tracking.
  const hb = setInterval(() => {
    try {
      res.write('event: heartbeat\ndata: {}\n\n');
      if (typeof (res as unknown as Record<string, unknown>).flush === 'function') {
        (res as unknown as { flush: () => void }).flush();
      }
      // Refresh client cache TTL while SSE connection is active
      const cached = clientCache.get(clientKey);
      if (cached) {
        cached.expiresAt = Date.now() + CACHE_TTL;
      }
    } catch { clearInterval(hb); try { res.end(); } catch {} }
  }, 25_000);

  // Get or create SSE connection for this clientKey
  let conn = activeSSE.get(clientKey);
  const isNewConnection = !conn;
  if (!conn) {
    serverLog(`[SSE] Creating new SSE connection for clientKey: ${clientKey.slice(0, 8)}...`);
    conn = { client, sseClients: new Set() };
    activeSSE.set(clientKey, conn);
  }
  conn.sseClients.add(res);
  serverLog(`[SSE] Client added. Total SSE clients for this clientKey: ${conn.sseClients.size}`);

  // Send initial connected event so client knows stream is ready
  try {
    res.write(`event: connected\ndata: {}\n\n`);
    if (typeof (res as unknown as Record<string, unknown>).flush === 'function') {
      (res as unknown as { flush: () => void }).flush();
    }
  } catch { /* ignore */ }

  // Connect realtime AFTER client is added so no events are missed
  if (isNewConnection) {
    connectRealtime(client, clientKey).catch((err) => {
      serverLog(`[SSE] Failed to connect realtime for ${clientKey.slice(0, 8)}: ${errorMessage(err)}`);
    });
  }

  req.on('close', () => {
    serverLog(`[SSE] Client disconnected for clientKey: ${clientKey.slice(0, 8)}...`);
    clearInterval(hb);
    const c = activeSSE.get(clientKey);
    if (c) {
      c.sseClients.delete(res);
      serverLog(`[SSE] Client removed. Remaining clients: ${c.sseClients.size}`);
      // If no more SSE clients, disconnect realtime and clean up
      if (c.sseClients.size === 0) {
        serverLog(`[SSE] No more clients, disconnecting realtime for clientKey: ${clientKey.slice(0, 8)}...`);
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
    res.status(500).json({ error: errorMessage(err) });
  }
});

// ── Companies ─────────────────────────────────────────────────────────────────

app.get('/api/companies', async (req, res) => {
  try {
    const client = await getClient(req);
    res.json(await client.getCompanies());
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

// ── Channels ──────────────────────────────────────────────────────────────────

app.get('/api/channels/:companyId/visible', async (req, res) => {
  try {
    const client = await getClient(req);
    const channels = await client.getVisibleChannels(req.params.companyId);
    res.json(channels);
  } catch (e) { res.status(500).json({ error: errorMessage(e) }); }
});

app.post('/api/channels/:channelId/join', async (req, res) => {
  try {
    const client = await getClient(req);
    await client.joinChannel(req.params.channelId);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: errorMessage(e) }); }
});

// ── Channel Invitations (accept / decline) ────────────────────────────────────
// The invite_id comes from the notification's content.id field (NOT the
// notification_id and NOT the channel_id). These endpoints call the
// undocumented Stashcat API /channels/acceptInvite and /channels/declineInvite
// directly via client.api.post.

app.post('/api/channels/invites/:inviteId/accept', async (req, res) => {
  try {
    const client = await getClient(req);
    const inviteId = req.params.inviteId;
    const { notificationId } = req.body as { notificationId?: string };
    serverLog(`[channel-invite] ACCEPT invite_id=${inviteId}`);
    const data = client.api.createAuthenticatedRequestData({ invite_id: inviteId });
    await client.api.post('/channels/acceptInvite', data);
    if (notificationId) {
      try { await client.deleteNotification(notificationId); } catch { /* best-effort */ }
    }
    serverLog(`[channel-invite] ACCEPT invite_id=${inviteId} — success`);
    res.json({ ok: true });
  } catch (e) {
    serverLog(`[channel-invite] ACCEPT invite_id=${req.params.inviteId} — FAILED: ${errorMessage(e)}`);
    res.status(500).json({ error: errorMessage(e) });
  }
});

app.post('/api/channels/invites/:inviteId/decline', async (req, res) => {
  try {
    const client = await getClient(req);
    const inviteId = req.params.inviteId;
    const { notificationId } = req.body as { notificationId?: string };
    serverLog(`[channel-invite] DECLINE invite_id=${inviteId}`);
    const data = client.api.createAuthenticatedRequestData({ invite_id: inviteId });
    await client.api.post('/channels/declineInvite', data);
    if (notificationId) {
      try { await client.deleteNotification(notificationId); } catch { /* best-effort */ }
    }
    serverLog(`[channel-invite] DECLINE invite_id=${inviteId} — success`);
    res.json({ ok: true });
  } catch (e) {
    serverLog(`[channel-invite] DECLINE invite_id=${req.params.inviteId} — FAILED: ${errorMessage(e)}`);
    res.status(500).json({ error: errorMessage(e) });
  }
});

app.post('/api/channels/:channelId/favorite', async (req, res) => {
  try {
    const client = await getClient(req);
    const { favorite } = req.body as { favorite: boolean };
    if (favorite) {
      await client.setChannelFavorite(req.params.channelId, true);
    } else {
      await client.setChannelFavorite(req.params.channelId, false);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: errorMessage(e) }); }
});

app.get('/api/channels/:companyId', async (req, res) => {
  try {
    const client = await getClient(req);
    const channels = await client.getChannels(req.params.companyId);
    // Flatten membership.muted into top-level muted for easier frontend use
    const mapped = channels.map((ch) => {
      const membership = (ch as any).membership;
      return {
        ...ch,
        muted: membership?.muted ?? null,
      };
    });
    res.json(mapped);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
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
    res.status(500).json({ error: errorMessage(err) });
  }
});

app.get('/api/channels/:channelId/pending-members', async (req, res) => {
  try {
    const client = await getClient(req);
    const channelId = req.params.channelId;
    const all: unknown[] = [];
    const PAGE = 100;
    let offset = 0;
    while (true) {
      const batch = await client.getChannelMembers(channelId, { limit: PAGE, offset, filter: 'membership_pending' });
      all.push(...batch);
      if (batch.length < PAGE) break;
      offset += PAGE;
    }
    console.log(`[channels/pending-members] channelId=${channelId} → ${all.length} pending members`);
    res.json(all);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

app.post('/api/channels/:channelId/notifications', async (req, res) => {
  try {
    const client = await getClient(req);
    const channelId = req.params.channelId;
    const { enabled, duration } = req.body as { enabled: boolean; duration?: number };
    if (enabled) {
      await client.enableChannelNotifications(channelId);
      console.log(`[channels/notifications] enabled for ${channelId}`);
    } else {
      // duration in seconds: 7200=2h, 86400=1d, 604800=7d, 2147483647=forever
      const muteDuration = duration && duration > 0 ? duration : 2147483647;
      await client.disableChannelNotifications(channelId, muteDuration);
      console.log(`[channels/notifications] disabled for ${channelId} (duration=${muteDuration})`);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

app.post('/api/channels/:channelId/invite', async (req, res) => {
  try {
    const client = await getClient(req);
    const { userIds } = req.body as { userIds: string[] };
    await client.inviteUsersToChannel(req.params.channelId, userIds);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

app.delete('/api/channels/:channelId/members/:userId', async (req, res) => {
  try {
    const client = await getClient(req);
    await client.removeUserFromChannel(req.params.channelId, req.params.userId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

// ── Moderator management ─────────────────────────────────────────────────────

app.post('/api/channels/:channelId/moderator/:userId', async (req, res) => {
  try {
    const client = await getClient(req);
    await client.addChannelModerator(req.params.channelId, req.params.userId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

app.delete('/api/channels/:channelId/moderator/:userId', async (req, res) => {
  try {
    const client = await getClient(req);
    await client.removeChannelModerator(req.params.channelId, req.params.userId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
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
    res.status(500).json({ error: errorMessage(err) });
  }
});

// ── Channel image ────────────────────────────────────────────────────────────
app.post('/api/channels/:channelId/image', async (req, res) => {
  try {
    const client = await getClient(req);
    const { company_id, image } = req.body as { company_id: string; image: string };
    // Access internal API to call /channels/setImage
    const api = (client as any).api;
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
  } catch (err) {
    res.status(500).json({ error: errorMessage(err, 'Failed to set channel image') });
  }
});

// ── Channel info ───────────────────────────────────────────────────────────────
app.get('/api/channels/:channelId/info', async (req, res) => {
  try {
    const client = await getClient(req);
    const ch = await client.getChannelInfo(req.params.channelId, true);
    res.json(ch);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

// ── Delete channel ────────────────────────────────────────────────────────────
app.delete('/api/channels/:channelId', async (req, res) => {
  try {
    const client = await getClient(req);
    const { channelId } = req.params;
    await client.deleteChannel(channelId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err, 'Failed to delete channel') });
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
    res.status(500).json({ error: errorMessage(err) });
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
    res.status(500).json({ error: errorMessage(err) });
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
    res.status(500).json({ error: errorMessage(err) });
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

    // Build channel options
    const channelOpts: Parameters<typeof client.createChannel>[0] = {
      channel_name: name,
      company: company_id,
      description: [description, policies ? `\n\nRichtlinien: ${policies}` : ''].filter(Boolean).join(''),
      type: isEncrypted ? 'closed' : 'public',
      visible: !hidden,
      writable: read_only ? 'manager' : 'all',
      inviteable: invite_only ? 'manager' : 'all',
      show_activities: show_activities ?? true,
      show_membership_activities: show_membership_activities ?? true,
      ...(isPassword && password ? { password, password_repeat: password_repeat ?? password } : {}),
    };

    // For encrypted channels: generate AES key, encrypt with own public key, sign
    if (isEncrypted) {
      const crypto = await import('crypto');
      const aesKey = crypto.randomBytes(32);

      if (!client.isE2EUnlocked()) {
        return res.status(400).json({ error: 'E2E not unlocked — encrypted channels require E2E. Please re-login with your security password.' });
      }

      // Get own public key
      const me = await client.getMe();
      if (!me.public_key) {
        return res.status(500).json({ error: 'Own public key not available' });
      }

      // Encrypt AES key with own RSA public key (RSA-OAEP)
      const encryptedKey = StashcatClient.encryptWithPublicKey(me.public_key, aesKey);
      channelOpts.encryption_key = encryptedKey.toString('base64');

      // Sign the encrypted key with own private signing key
      const signature = client.signData(encryptedKey);
      channelOpts.encryption_key_signature = signature.toString('hex');
    }

    const channel = await client.createChannel(channelOpts);
    console.log(`[channels/create] created channel: ${(channel as unknown as Record<string,unknown>).name ?? name}`);
    res.json(channel);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err, 'Failed to create channel') });
  }
});

// ── Set missing encryption keys for channel members ──────────────────────────

app.post('/api/channels/:channelId/keys', async (req, res) => {
  try {
    const client = await getClient(req);
    const channelId = req.params.channelId;
    const { keys } = req.body as { keys: Array<{ user_id: string; key: string; key_signature: string }> };
    if (!keys || !Array.isArray(keys)) {
      return res.status(400).json({ error: 'keys array required' });
    }
    await client.setMissingKey('channel', channelId, keys);
    console.log(`[channels/keys] distributed ${keys.length} keys for channel ${channelId}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err, 'Failed to set channel keys') });
  }
});

app.post('/api/conversations/:convId/favorite', async (req, res) => {
  try {
    const client = await getClient(req);
    const { favorite } = req.body as { favorite: boolean };
    if (favorite) {
      await client.setConversationFavorite(req.params.convId, true);
    } else {
      await client.setConversationFavorite(req.params.convId, false);
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: errorMessage(e) }); }
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
    res.status(500).json({ error: errorMessage(err, 'Failed to create conversation') });
  }
});

// ── Conversations ─────────────────────────────────────────────────────────────

app.get('/api/conversations', async (req, res) => {
  try {
    const token = extractToken(req);
    const payload = decryptSession(token);
    const client = await getClient(req);

    // When no explicit limit is passed, paginate through all conversations.
    // Stashcat's API caps each response at ~100 regardless of the requested limit,
    // so a single request would silently truncate the list (losing favorites
    // that sit further down by last_activity).
    let conversations: Array<Record<string, unknown>>;
    if (req.query.limit !== undefined) {
      const limit = Number(req.query.limit) || 50;
      const offset = Number(req.query.offset) || 0;
      conversations = await client.getConversations({ limit, offset }) as unknown as Array<Record<string, unknown>>;
    } else {
      conversations = [];
      const PAGE = 100;
      let offset = 0;
      while (true) {
        const batch = await client.getConversations({ limit: PAGE, offset }) as unknown as Array<Record<string, unknown>>;
        conversations.push(...batch);
        if (batch.length < PAGE) break;
        offset += PAGE;
      }
    }

    // Discover bot before filtering so the first request also filters correctly
    await findChatBot(client, payload.clientKey).catch(() => {});

    // Filter out the Chat Bot conversation
    const filtered = conversations.filter((c) => !isBotConversation(String(c.id), payload.clientKey));
    res.json(filtered);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

app.get('/api/conversations/:id', async (req, res) => {
  try {
    const client = await getClient(req);
    const conv = await client.getConversation(req.params.id);
    res.json(conv);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
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
    res.status(500).json({ error: errorMessage(err) });
  }
});

app.get('/api/messages/:messageId/likes', async (req, res) => {
  try {
    const client = await getClient(req);
    const likes = await client.listLikes(req.params.messageId);
    res.json({ likes });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

app.post('/api/messages/:messageId/unlike', async (req, res) => {
  try {
    const client = await getClient(req);
    await client.unlikeMessage(req.params.messageId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

app.delete('/api/messages/:messageId', async (req, res) => {
  try {
    const client = await getClient(req);
    await client.deleteMessage(req.params.messageId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

// ── Message flagging (bookmarks) ─────────────────────────────────────────────

app.post('/api/messages/:messageId/flag', async (req, res) => {
  try {
    const client = await getClient(req);
    await client.flagMessage(req.params.messageId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

app.post('/api/messages/:messageId/unflag', async (req, res) => {
  try {
    const client = await getClient(req);
    await client.unflagMessage(req.params.messageId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

app.get('/api/messages/:type/:targetId/flagged', async (req, res) => {
  try {
    const client = await getClient(req);
    const { type, targetId } = req.params;
    const chatType = type as 'channel' | 'conversation';
    const limit = Number(req.query.limit) || 50;
    const offset = Number(req.query.offset) || 0;

    const messages = await client.getFlaggedMessages(chatType, targetId, { limit, offset });

    // E2E decrypt each message (same pattern as search endpoint)
    for (const msg of messages as unknown as Array<Record<string, unknown>>) {
      if (msg.encrypted && msg.text && msg.iv) {
        try {
          let aesKey: Buffer | undefined;
          const channelId = msg.channel_id && msg.channel_id !== 0 ? String(msg.channel_id) : null;
          const msgConvId = msg.conversation_id && msg.conversation_id !== 0 ? String(msg.conversation_id) : null;
          if (msgConvId) {
            aesKey = await client.getConversationAesKey(msgConvId);
          } else if (channelId) {
            aesKey = await client.getChannelAesKey(channelId);
          }
          if (aesKey) {
            const iv = CryptoManager.hexToBuffer(String(msg.iv));
            msg.text = CryptoManager.decrypt(String(msg.text), aesKey, iv);
          }
        } catch (err) {
          serverLog('[flaggedMessages] Failed to decrypt:', errorMessage(err));
          msg.text = '[Nachricht konnte nicht entschlüsselt werden]';
        }
      }
    }

    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

// ── Date-range message search (must be BEFORE generic :targetId route) ───────

app.get('/api/messages/:type/:targetId/search', async (req, res) => {
  try {
    const client = await getClient(req);
    const { type, targetId } = req.params;
    const chatType = type as 'channel' | 'conversation';
    const startDate = Number(req.query.startDate) || 0;
    const endDate = Number(req.query.endDate) || Math.floor(Date.now() / 1000);
    const query = (req.query.query as string) || '';
    const offset = Number(req.query.offset) || 0;
    const limit = Number(req.query.limit) || 100;

    // Direct call to Stashcat /search/messages endpoint
    const searchParams: Record<string, unknown> = {
      start_time: startDate,
      end_time: endDate,
      offset,
      limit,
    };
    if (chatType === 'conversation') searchParams.conversation_id = targetId;
    else searchParams.channel_id = targetId;

    const data = client.api.createAuthenticatedRequestData(searchParams);
    const result = await client.api.post<{ messages: Array<Record<string, unknown>> }>('/search/messages', data);
    let messages = result.messages || [];

    // E2E decrypt each message
    for (const msg of messages) {
      if (msg.encrypted && msg.text && msg.iv) {
        try {
          let aesKey: Buffer | undefined;
          const channelId = msg.channel_id && msg.channel_id !== 0 ? String(msg.channel_id) : null;
          const msgConvId = msg.conversation_id && msg.conversation_id !== 0 ? String(msg.conversation_id) : null;
          if (msgConvId) {
            aesKey = await client.getConversationAesKey(msgConvId);
          } else if (channelId) {
            aesKey = await client.getChannelAesKey(channelId);
          }
          if (aesKey) {
            const iv = CryptoManager.hexToBuffer(String(msg.iv));
            msg.text = CryptoManager.decrypt(String(msg.text), aesKey, iv);
          }
        } catch {
          // Leave text as-is if decryption fails
        }
      }
    }

    // Optional server-side text filter
    if (query) {
      const q = query.toLowerCase();
      messages = messages.filter(m => typeof m.text === 'string' && m.text.toLowerCase().includes(q));
    }

    const sorted = [...messages].sort(
      (a, b) => (Number(a.time) || 0) - (Number(b.time) || 0)
    );

    res.json({ messages: sorted, hasMore: messages.length >= limit });
  } catch (err) {
    debugLog(`[searchMessages] ERROR: ${errorMessage(err)}`);
    res.status(500).json({ error: errorMessage(err) });
  }
});

// ── Generic message routes (must be AFTER specific ones) ─────────────────────

app.get('/api/messages/:type/:targetId', async (req, res) => {
  const client = await getClient(req);
  try {
    const { type, targetId } = req.params;
    const limit = Number(req.query.limit) || 40;
    const offset = Number(req.query.offset) || 0;
    const chatType = type as 'channel' | 'conversation';
    debugLog(`[getMessages:route] type=${chatType} targetId=${targetId} E2E_unlocked=${client.isE2EUnlocked()}`);
    if (chatType === 'channel') {
      try {
        const ch = await client.getChannelInfo(targetId, true);
        // Log raw channel info keys to understand structure
        // Log ALL keys present in the channel response
        const allKeys = Object.keys(ch).filter(k => k.includes('key') || k.includes('encryption') || k.includes('crypt'));
        debugLog(`[channel-info] id=${targetId} allKeyFields=${JSON.stringify(allKeys)} keyLength=${ch.key?.length} fullJson=${JSON.stringify(ch)}`);
      } catch (e) {
        debugLog(`[channel-info] failed to fetch: ${errorMessage(e)}`);
      }
    }
    const messages = await client.getMessages(targetId, chatType, { limit, offset });
    const sorted = [...messages].sort(
      (a, b) => (Number((a as unknown as Record<string, unknown>).time) || 0) - (Number((b as unknown as Record<string, unknown>).time) || 0)
    );
    res.json(sorted);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    debugLog(`[getMessages:route] ERROR: ${error.message}\n${error.stack}`);
    res.status(500).json({
      error: error.message,
    });
  }
});

app.post('/api/messages/:type/:targetId', async (req, res) => {
  try {
    const client = await getClient(req);
    const { type, targetId } = req.params;
    const { text, is_forwarded, reply_to_id, files } = req.body as { text: string; is_forwarded?: boolean; reply_to_id?: string; files?: string[] };
    const chatType = type as 'channel' | 'conversation';
    await client.sendMessage({ target: targetId, target_type: chatType, text, is_forwarded, reply_to_id, files });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
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
    res.status(500).json({ error: errorMessage(err) });
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
    res.status(500).json({ error: errorMessage(err) });
  }
});

/** Get storage quota for a channel, conversation, or personal storage */
app.get('/api/files/quota', async (req, res) => {
  try {
    const client = await getClient(req);
    const { type, typeId } = req.query;
    if (!type || !typeId) {
      res.status(400).json({ error: 'type and typeId are required' });
      return;
    }
    serverLog(`[quota] Fetching quota for type=${type}, typeId=${typeId}`);
    const quota = await client.getQuota(type as string, typeId as string);
    serverLog(`[quota] Raw API response:`, JSON.stringify(quota));
    res.json(quota);
  } catch (err) {
    serverLog(`[quota] Error:`, errorMessage(err));
    res.status(500).json({ error: errorMessage(err, 'Failed to get quota') });
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
    res.status(500).json({ error: errorMessage(err) });
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
      const me = await client.getMe() as unknown as Record<string, unknown>;
      resolvedTypeId = String(me.id);
    }

    // Ensure folder_id is a number for the API
    const folderIdNum = folderId ? parseInt(folderId, 10) : undefined;

    await client.uploadFile(namedPath, {
      type,
      type_id: resolvedTypeId,
      folder: folderIdNum,
      filename: originalName,
    });

    await fs.unlink(namedPath).catch(() => {});
    res.json({ ok: true });
  } catch (err) {
    if (tmpPath) await fs.unlink(tmpPath).catch(() => {});
    const message = errorMessage(err, String(err));
    if (err instanceof Error) debugLog(`[files/upload] ERROR: ${err.message}\n${err.stack}`);
    res.status(500).json({ error: message });
  }
});

app.post('/api/files/:fileId/move', async (req, res) => {
  try {
    const client = await getClient(req);
    const { target_folder_id } = req.body as { target_folder_id: string };
    await client.moveFile(req.params.fileId, target_folder_id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: errorMessage(e) }); }
});

// ── Create folder ─────────────────────────────────────────────────────────────
app.post('/api/files/folder/create', async (req, res) => {
  try {
    const client = await getClient(req);
    const { folder_name, parent_id, type, type_id } = req.body as {
      folder_name: string;
      parent_id: string;
      type: string;
      type_id: string;
    };
    const folder = await client.createFolder(folder_name, parent_id, type, type_id);
    res.json(folder);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err, 'Failed to create folder') });
  }
});

app.post('/api/folder/delete', async (req, res) => {
  try {
    const client = await getClient(req);
    const { folderId } = req.body as { folderId: string };
    await client.deleteFolder(parseInt(folderId, 10));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err, 'Failed to delete folder') });
  }
});

app.post('/api/files/delete', async (req, res) => {
  try {
    const client = await getClient(req);
    const { fileIds } = req.body as { fileIds: string[] };
    await client.deleteFiles(fileIds);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

app.patch('/api/files/:fileId', async (req, res) => {
  try {
    const client = await getClient(req);
    const { name } = req.body as { name: string };
    await client.renameFile(req.params.fileId, name);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
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
    res.status(500).json({ error: errorMessage(err, 'Download failed') });
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
    } as any);

    await fs.unlink(namedPath).catch(() => {});

    await client.sendMessage({
      target: targetId as any,
      target_type: chatType as any,
      text: req.body.text || '',
      files: [(fileInfo as unknown as Record<string, unknown>).id as string],
    });

    res.json({ ok: true, file: fileInfo });
  } catch (err) {
    if (tmpPath) await fs.unlink(tmpPath).catch(() => {});
    res.status(500).json({ error: errorMessage(err, 'Upload failed') });
  }
});

// ── User ──────────────────────────────────────────────────────────────────────

app.get('/api/me', async (req, res) => {
  try {
    const client = await getClient(req);
    res.json(await client.getMe());
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

// ── Account ───────────────────────────────────────────────────────────────────

app.get('/api/account/settings', async (req, res) => {
  try {
    const client = await getClient(req);
    res.json(await client.getAccountSettings());
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

app.post('/api/account/status', async (req, res) => {
  try {
    const client = await getClient(req);
    const { status } = req.body;
    await client.changeStatus(status);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

app.post('/api/account/profile-image', async (req, res) => {
  try {
    const client = await getClient(req);
    const { imgBase64 } = req.body;
    await client.storeProfileImage(imgBase64);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

app.post('/api/account/profile-image/reset', async (req, res) => {
  try {
    const client = await getClient(req);
    await client.resetProfileImage();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

// ── Link Preview ──────────────────────────────────────────────────────────────

const linkPreviewCache = new Map<string, { title?: string; description?: string; image?: string; siteName?: string; fetchedAt: number }>();
const PREVIEW_TTL = 3600_000; // 1 hour

// SSRF protection: block private/internal IPs
function isBlockedHost(hostname: string): boolean {
  return /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|169\.254\.|localhost|::1|\[::1\]|fc|fd)/i.test(hostname);
}

/** Extract OG/meta tags from a fetch response and send the preview JSON. */
async function extractAndRespondPreview(response: Response, url: string, res: express.Response) {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
    return res.json({ title: url, fetchedAt: Date.now() });
  }

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

  const getMetaContent = (nameOrProp: string): string | undefined => {
    const propRe = new RegExp(`<meta[^>]+(?:property|name)=["']${nameOrProp}["'][^>]+content=["']([^"']+)["']`, 'i');
    const propMatch = html.match(propRe);
    if (propMatch) return propMatch[1];
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
}

app.get('/api/link-preview', async (req, res) => {
  try {
    const url = req.query.url as string;
    if (!url || !/^https?:\/\//.test(url)) {
      return res.status(400).json({ error: 'Invalid URL' });
    }

    // SSRF protection: block private/internal IPs
    try {
      const parsed = new URL(url);
      if (isBlockedHost(parsed.hostname)) {
        return res.status(400).json({ error: 'URL not allowed' });
      }
    } catch {
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
      redirect: 'manual',
    });
    clearTimeout(timeout);

    // Follow redirects manually with SSRF check
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (location) {
        try {
          const redirectUrl = new URL(location, url);
          if (isBlockedHost(redirectUrl.hostname)) {
            return res.json({ title: url, fetchedAt: Date.now() });
          }
          const ctrl2 = new AbortController();
          const to2 = setTimeout(() => ctrl2.abort(), 5000);
          const response2 = await fetch(redirectUrl.href, {
            signal: ctrl2.signal,
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LinkPreviewBot/1.0)', 'Accept': 'text/html,application/xhtml+xml' },
            redirect: 'manual',
          });
          clearTimeout(to2);
          return extractAndRespondPreview(response2, url, res);
        } catch {
          return res.json({ title: url, fetchedAt: Date.now() });
        }
      }
    }

    return extractAndRespondPreview(response, url, res);
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
    res.status(500).json({ error: errorMessage(err) });
  }
});

app.post('/api/broadcasts', async (req, res) => {
  try {
    const client = await getClient(req);
    const { name, memberIds } = req.body as { name: string; memberIds: string[] };
    res.json(await client.createBroadcast(name, memberIds));
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

app.delete('/api/broadcasts/:id', async (req, res) => {
  try {
    const client = await getClient(req);
    await client.deleteBroadcast(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

app.patch('/api/broadcasts/:id', async (req, res) => {
  try {
    const client = await getClient(req);
    const { name } = req.body as { name: string };
    await client.renameBroadcast(req.params.id, name);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
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
    res.status(500).json({ error: errorMessage(err) });
  }
});

app.post('/api/broadcasts/:id/messages', async (req, res) => {
  try {
    const client = await getClient(req);
    const { text } = req.body as { text: string };
    const msg = await client.sendBroadcastMessage({ list_id: req.params.id, text });
    res.json(msg);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

app.get('/api/broadcasts/:id/members', async (req, res) => {
  try {
    const client = await getClient(req);
    res.json(await client.listBroadcastMembers(req.params.id));
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

app.post('/api/broadcasts/:id/members', async (req, res) => {
  try {
    const client = await getClient(req);
    const { memberIds } = req.body as { memberIds: string[] };
    await client.addBroadcastMembers(req.params.id, memberIds);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

app.delete('/api/broadcasts/:id/members', async (req, res) => {
  try {
    const client = await getClient(req);
    const { memberIds } = req.body as { memberIds: string[] };
    await client.removeBroadcastMembers(req.params.id, memberIds);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
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
    res.status(500).json({ error: errorMessage(err) });
  }
});

app.get('/api/calendar/events/:id', async (req, res) => {
  try {
    const client = await getClient(req);
    const event = await client.getEventDetails([req.params.id]);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    res.json(event);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

app.post('/api/calendar/events', async (req, res) => {
  try {
    const client = await getClient(req);
    const { notify_chat_id, notify_chat_type, ...eventData } = req.body;
    const eventId = await client.createEvent(eventData);

    // Send notification message to the source chat (if provided)
    if (notify_chat_id && notify_chat_type && eventId) {
      try {
        const eName = eventData.name || 'Unbenannt';
        const startTs = Number(eventData.start);
        const endTs = Number(eventData.end);
        const isAllday = eventData.allday === true || eventData.allday === '1';
        const dateOpts: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' };
        const timeOpts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
        const startDate = new Date(startTs * 1000).toLocaleDateString('de-DE', dateOpts);
        const endDate = new Date(endTs * 1000).toLocaleDateString('de-DE', dateOpts);
        const startTime = isAllday ? '' : `, ${new Date(startTs * 1000).toLocaleTimeString('de-DE', timeOpts)} Uhr`;
        const endTime = isAllday ? '' : `, ${new Date(endTs * 1000).toLocaleTimeString('de-DE', timeOpts)} Uhr`;
        const loc = eventData.location ? `\nOrt: ${eventData.location}` : '';
        const desc = eventData.description ? `\n${eventData.description}` : '';

        const msgText = `📅 **Neuer Termin: „${eName}"**${desc}\n${isAllday ? 'Ganztägig: ' : ''}${startDate}${startTime} – ${endDate}${endTime}${loc}\n\nDetails im Kalender ansehen. [%event:${eventId}%]`;

        await client.sendMessage({ target: notify_chat_id, target_type: notify_chat_type, text: msgText }).catch(() => {});
      } catch { /* non-critical */ }
    }

    res.json({ id: eventId });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

app.put('/api/calendar/events/:id', async (req, res) => {
  try {
    const client = await getClient(req);
    const eventId = await client.editEvent({ ...req.body, event_id: req.params.id });
    res.json({ id: eventId });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

app.delete('/api/calendar/events/:id', async (req, res) => {
  try {
    const client = await getClient(req);
    await client.deleteEvents([req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

app.post('/api/calendar/events/:id/respond', async (req, res) => {
  try {
    const client = await getClient(req);
    const { status: rsvp } = req.body as { status: string };
    const me = await client.getMe() as unknown as Record<string, unknown>;
    await client.respondToEvent(req.params.id, String(me.id), rsvp as 'accepted' | 'declined' | 'open');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

app.post('/api/calendar/events/:id/invite', async (req, res) => {
  try {
    const client = await getClient(req);
    const { userIds } = req.body as { userIds: string[] };
    await client.inviteToEvent(req.params.id, userIds);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

app.get('/api/calendar/channels/:companyId', async (req, res) => {
  try {
    const client = await getClient(req);
    res.json(await client.listChannelsHavingEvents(req.params.companyId));
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

// ── Notifications ─────────────────────────────────────────────────────────────

app.get('/api/notifications', async (req, res) => {
  try {
    const client = await getClient(req);
    const limit = Number(req.query.limit) || 50;
    const offset = Number(req.query.offset) || 0;
    const notifications = await client.getNotifications(limit, offset);
    serverLog(`[notifications] GET limit=${limit} offset=${offset} → ${Array.isArray(notifications) ? notifications.length : 0} notifications`);
    res.json(notifications);
  } catch (err) {
    serverLog(`[notifications] GET error: ${errorMessage(err)}`);
    res.status(500).json({ error: errorMessage(err) });
  }
});

app.get('/api/notifications/count', async (req, res) => {
  try {
    const client = await getClient(req);
    const count = await client.getNotificationCount();
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

app.delete('/api/notifications/:notificationId', async (req, res) => {
  try {
    const client = await getClient(req);
    const notificationId = req.params.notificationId;
    serverLog(`[notifications] DELETE id=${notificationId}`);
    await client.deleteNotification(notificationId);
    serverLog(`[notifications] DELETE id=${notificationId} — success`);
    res.json({ ok: true });
  } catch (err) {
    serverLog(`[notifications] DELETE id=${req.params.notificationId} — FAILED: ${errorMessage(err)}`);
    res.status(500).json({ error: errorMessage(err) });
  }
});

app.delete('/api/notifications', async (req, res) => {
  try {
    const client = await getClient(req);
    serverLog(`[notifications] DELETE ALL (serial)`);

    // Fetch all notifications first
    const notifications = await client.getNotifications(200, 0);
    const items = Array.isArray(notifications) ? notifications : [];
    serverLog(`[notifications] DELETE ALL — found ${items.length} notifications`);

    // Delete each notification serially (Stashcat has no bulk delete endpoint)
    let deleted = 0;
    let errors = 0;
    for (const n of items) {
      const id = String((n as unknown as Record<string, unknown>).id ?? '');
      if (!id) continue;
      try {
        await client.deleteNotification(id);
        deleted++;
      } catch (err) {
        errors++;
        serverLog(`[notifications] DELETE ALL — failed for id=${id}: ${errorMessage(err)}`);
      }
    }

    serverLog(`[notifications] DELETE ALL — done: ${deleted} deleted, ${errors} errors`);
    res.json({ ok: true, deleted, errors });
  } catch (err) {
    serverLog(`[notifications] DELETE ALL — FAILED: ${errorMessage(err)}`);
    res.status(500).json({ error: errorMessage(err) });
  }
});

// ── Key Sync (E2E key exchange) ───────────────────────────────────────────────

app.post('/api/key-sync/accept', async (req, res) => {
  try {
    const client = await getClient(req);
    const { userId, notificationId } = req.body as { userId?: string; notificationId?: string };
    if (!userId) return void res.status(400).json({ error: 'userId required' });
    if (!client.isE2EUnlocked()) return void res.status(400).json({ error: 'E2E not unlocked' });

    // Step 1: Get the list of conversations/channels missing keys for this user
    serverLog(`[KeySync] Fetching missing keys for user ${userId}`);
    interface MissingKeyItem {
      id: string;
      key?: string;
      foreign_user_id?: string;
      foreign_public_key?: string;
      foreign_socket_id?: string;
    }
    interface MissingKeysPayload {
      content: { conversations?: MissingKeyItem[]; channels?: MissingKeyItem[] };
    }
    const missingData = client.api.createAuthenticatedRequestData({ user_id: userId });
    const missing = await client.api.post<MissingKeysPayload>('/security/get_missing_keys', missingData);

    const conversations = missing.content.conversations ?? [];
    const channels = missing.content.channels ?? [];
    serverLog(`[KeySync] Found ${conversations.length} conversations, ${channels.length} channels missing keys`);

    const expiry = Math.floor(Date.now() / 1000) + 365 * 24 * 3600; // 1 year from now
    let processed = 0;
    let errors = 0;

    // Use foreign_public_key from the first item (same user = same key for all items)
    const foreignPublicKey = conversations[0]?.foreign_public_key ?? channels[0]?.foreign_public_key;

    for (const conv of conversations) {
      try {
        const publicKey = conv.foreign_public_key ?? foreignPublicKey;
        if (!publicKey) { errors++; continue; }

        // Step 2a: Get our AES key for this conversation
        const aesKey = await client.getConversationAesKey(conv.id);

        // Step 2b: Re-encrypt AES key with the foreign user's RSA public key (OAEP)
        const encryptedKey = StashcatClient.encryptWithPublicKey(publicKey, aesKey);
        const keyBase64 = encryptedKey.toString('base64');

        // Step 2c: Sign the encrypted key with our RSA private key
        const signature = client.signData(Buffer.from(keyBase64)).toString('hex');

        // Step 3: Submit the encrypted key
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
        serverLog(`[KeySync] Set key for conversation ${conv.id}`);
      } catch (itemErr) {
        errors++;
        serverLog(`[KeySync] Failed to set key for conversation ${conv.id}:`, errorMessage(itemErr));
      }
    }

    for (const ch of channels) {
      try {
        const publicKey = ch.foreign_public_key ?? foreignPublicKey;
        if (!publicKey) { errors++; continue; }

        const aesKey = await client.getChannelAesKey(ch.id);

        const encryptedKey = StashcatClient.encryptWithPublicKey(publicKey, aesKey);
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
        serverLog(`[KeySync] Set key for channel ${ch.id}`);
      } catch (itemErr) {
        errors++;
        serverLog(`[KeySync] Failed to set key for channel ${ch.id}:`, errorMessage(itemErr));
      }
    }

    serverLog(`[KeySync] Done: ${processed} keys set, ${errors} errors`);

    // Step 4: Delete the notification
    if (notificationId) {
      try { await client.deleteNotification(notificationId); } catch { /* best-effort */ }
    }

    if (processed === 0 && errors > 0) {
      return void res.status(500).json({ error: 'Failed to set any keys — check server log' });
    }

    res.json({ ok: true, processed, errors });
  } catch (err) {
    serverLog(`[KeySync] accept failed:`, errorMessage(err));
    res.status(500).json({ error: errorMessage(err) });
  }
});

// ── Video Meeting (Chat Bot integration) ──────────────────────────────────────

/** Returns true if a member object looks like the Stashcat Chat Bot */
function looksLikeChatBot(member: Record<string, unknown>): boolean {
  if (Boolean(member.is_bot)) return true;
  const first = String(member.first_name || '').trim().toLowerCase();
  const last  = String(member.last_name  || '').trim().toLowerCase();
  const full  = `${first} ${last}`;
  return full === 'chat bot' || first === 'chat bot' || last === 'chat bot';
}

async function findChatBot(client: StashcatClient, clientKey: string): Promise<BotInfo | null> {
  // Check cache first
  const cached = botCache.get(clientKey);
  if (cached) return cached;

  try {
    // Scan up to 200 conversations for the Chat Bot (two pages of 100)
    for (const offset of [0, 100]) {
      const conversations = await client.getConversations({ limit: 100, offset }) as unknown as Array<Record<string, unknown>>;
      console.log(`[Video] Scanning ${conversations.length} conversations at offset ${offset}`);

      for (const conv of conversations) {
        // members may be a flat array or may be missing – try both field names
        const rawMembers = (conv.members ?? conv.participants ?? []) as Array<Record<string, unknown>>;

        // If members have no user details (only IDs), fetch the full conversation
        let members = rawMembers;
        if (members.length > 0 && !members[0].first_name) {
          try {
            const full = await client.getConversation(String(conv.id)) as unknown as Record<string, unknown>;
            members = ((full.members ?? full.participants ?? []) as Array<Record<string, unknown>>);
          } catch { /* ignore */ }
        }

        for (const member of members) {
          if (looksLikeChatBot(member)) {
            const info: BotInfo = { botUserId: String(member.id ?? member.user_id), botConvId: String(conv.id) };
            botCache.set(clientKey, info);
            console.log(`[Video] Found Chat Bot: userId=${info.botUserId}, convId=${info.botConvId}`);
            return info;
          }
        }
      }

      if (conversations.length < 100) break; // no more pages
    }

    // Bot not found in conversations — try company members as fallback
    console.warn('[Video] Chat Bot not found in conversations. Searching company members...');
    try {
      const companies = await client.getCompanies() as unknown as Array<Record<string, unknown>>;
      for (const company of companies) {
        const companyId = String(company.id);
        // getCompanyMembers fetches members; the bot user should be in there
        const members = await client.getCompanyMembers(companyId) as unknown as Array<Record<string, unknown>>;
        for (const member of members) {
          if (looksLikeChatBot(member)) {
            const botUserId = String(member.id ?? member.user_id);
            console.log(`[Video] Found Chat Bot via company members: userId=${botUserId}, creating conversation...`);
            // Create/get the 1:1 conversation with the bot
            const conv = await client.createConversation([botUserId]) as unknown as Record<string, unknown>;
            const botConvId = String(conv.id);
            const info: BotInfo = { botUserId, botConvId };
            botCache.set(clientKey, info);
            console.log(`[Video] Bot conversation created/found: convId=${botConvId}`);
            return info;
          }
        }
      }
    } catch (fallbackErr) {
      console.warn('[Video] Company member fallback failed:', fallbackErr);
    }

  } catch (err) {
    console.warn('[Video] Failed to search for Chat Bot:', err);
  }

  return null;
}

/** Check if a conversation is the Chat Bot conversation */
function isBotConversation(convId: string, clientKey: string): boolean {
  const bot = botCache.get(clientKey);
  return bot ? bot.botConvId === convId : false;
}

/** Check if a message sender is the Chat Bot */
function isBotMessage(senderId: string, clientKey: string): boolean {
  const bot = botCache.get(clientKey);
  return bot ? bot.botUserId === senderId : false;
}

/** Extract sender ID from a raw message object (sender can be string or object) */
function extractSenderId(msg: Record<string, unknown>): string {
  const sender = msg.sender;
  if (typeof sender === 'string') return sender;
  if (sender && typeof sender === 'object') {
    const s = sender as Record<string, unknown>;
    return String(s.id ?? s.user_id ?? '');
  }
  return '';
}

/** Extract all stash.cat meeting links from message text */
function extractMeetingLinks(text: string): string[] {
  // Links can appear as __https://stash.cat/l/xxx__ (markdown) or plain
  // Use non-greedy match and strip trailing underscores/punctuation
  const re = /https?:\/\/stash\.cat\/l\/([a-zA-Z0-9]+)/g;
  const links: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    links.push(`https://stash.cat/l/${m[1]}`); // reconstruct clean URL without trailing __
  }
  return links;
}

app.post('/api/video/start-meeting', async (req, res) => {
  let clientKey = '';
  try {
    const token = extractToken(req);
    const payload = decryptSession(token);
    clientKey = payload.clientKey;
    const client = await getClient(req);

    // 1. Find Chat Bot
    const botInfo = await findChatBot(client, clientKey);
    if (!botInfo) {
      return res.status(503).json({ error: 'Chat Bot nicht gefunden. Schreibe zuerst eine Nachricht an den "Chat Bot" in der App, dann versuche es erneut.' });
    }

    // 2. Record existing message IDs before sending /meet (to detect new bot replies)
    const existingMsgs = await client.getMessages(botInfo.botConvId, 'conversation', { limit: 10, offset: 0 }) as unknown as Array<Record<string, unknown>>;
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
    let inviteLink: string | null = null;
    let moderatorLink: string | null = null;

    for (let attempt = 0; attempt < 60; attempt++) {
      await new Promise((r) => setTimeout(r, 500));

      const messages = await client.getMessages(botInfo.botConvId, 'conversation', { limit: 10, offset: 0 }) as unknown as Array<Record<string, unknown>>;

      for (const msg of messages) {
        const msgId = String(msg.id);
        if (existingIds.has(msgId)) continue; // Skip pre-existing messages

        const senderId = extractSenderId(msg);
        if (senderId !== botInfo.botUserId) continue; // Only bot messages

        const text = String(msg.text || '');
        const links = extractMeetingLinks(text);
        console.log(`[Video] Attempt ${attempt + 1} — new bot msg id=${msgId}, links=${JSON.stringify(links)}, text=${text.slice(0, 150)}`);

        if (links.length === 0) continue;

        // Classify by keywords in the message text
        const isInvite = text.includes('weitergeben') || text.includes('Teilnehmer') || text.includes('einzuladen');
        const isModerator = text.includes('starten') || text.includes('nur für dich') || text.includes('Konferenz ist bereit');

        if (isInvite) {
          inviteLink = links[0];
        } else if (isModerator) {
          moderatorLink = links[0];
        } else if (links.length >= 2) {
          // Single message contains both links (invite first, moderator second)
          inviteLink = inviteLink ?? links[0];
          moderatorLink = moderatorLink ?? links[1];
        } else {
          // Unclassified single link: assign to whichever slot is still empty
          if (!inviteLink) inviteLink = links[0];
          else if (!moderatorLink) moderatorLink = links[0];
        }

        // Mark this message ID so we don't re-process it
        existingIds.add(msgId);
      }

      if (inviteLink && moderatorLink) break;
    }

    if (!inviteLink && !moderatorLink) {
      return res.status(504).json({ error: 'Chat Bot hat nicht rechtzeitig geantwortet. Bitte versuche es erneut.' });
    }

    console.log(`[Video] Meeting ready — invite=${inviteLink}, moderator=${moderatorLink}`);
    res.json({ inviteLink, moderatorLink });

  } catch (err) {
    console.error('[Video] Error:', err);
    res.status(500).json({ error: errorMessage(err, 'Videokonferenz konnte nicht erstellt werden') });
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
    const constraint = (req.query.constraint as string) || 'invited_and_not_archived';
    let companyId = req.query.company_id as string | undefined;
    if (!companyId) {
      const companies = await client.getCompanies();
      const c = companies[0] as unknown as Record<string, unknown>;
      companyId = c?.id ? String(c.id) : undefined;
      if (!companyId) return res.status(500).json({ error: 'Kein Unternehmen gefunden' });
    }
    const polls = await client.listPolls(constraint, companyId);
    res.json(polls);
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

/** Get poll details including questions and all answers */
app.get('/api/polls/:id', async (req, res) => {
  try {
    const client = await getClient(req);
    const companyId = req.query.company_id as string;
    const poll = await client.getPollDetails(req.params.id, companyId || '');
    // Fetch answers for each question
    if (poll.questions && poll.questions.length > 0) {
      const questionsWithAnswers = await Promise.all(
        poll.questions.map(async (q) => {
          const rawAnswers = await client.listPollAnswers(String(q.id)).catch(() => []);
          // Map answer_count (string from API) to votes (number for frontend)
          const answers = (rawAnswers as unknown as Array<Record<string, unknown>>).map((a) => ({
            ...a,
            votes: Number(a.answer_count ?? 0),
          }));
          return { ...q, answers };
        })
      );
      (poll as unknown as Record<string, unknown>).questions = questionsWithAnswers;
    }
    res.json(poll);
  } catch (err) { res.status(500).json({ error: String(err) }); }
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
    const companyId = String((companies[0] as unknown as Record<string, unknown>)?.id ?? '');
    if (!companyId) throw new Error('Kein Unternehmen gefunden');

    const { name, description, start_time, end_time, privacy_type, hidden_results, questions = [], invite_channel_ids = [], invite_conversation_ids = [], notify_chat_id, notify_chat_type } = req.body as {
      name: string; description?: string; start_time: number; end_time: number;
      privacy_type?: string; hidden_results?: boolean;
      questions: Array<{ name: string; answer_limit?: number; answers: string[] }>;
      invite_channel_ids?: string[]; invite_conversation_ids?: string[];
      notify_chat_id?: string; notify_chat_type?: 'channel' | 'conversation';
    };

    // 2. Create the poll
    const poll = await client.createPoll({
      company_id: companyId, name,
      ...(description ? { description } : {}),
      ...(hidden_results !== undefined ? { hidden_results } : {}),
      ...(privacy_type ? { privacy_type: privacy_type as 'open' | 'hidden' | 'anonymous' } : {}),
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
        console.warn(`[Poll] inviteToPoll channels failed:`, errorMessage(e));
      });
    }

    // 5. Invite conversations (resolve members → invite as users)
    if (invite_conversation_ids.length > 0) {
      const userIds = new Set<string>();
      for (const convId of invite_conversation_ids) {
        const conv = await client.getConversation(convId).catch(() => null);
        if (conv) {
          const members = (conv as unknown as Record<string, unknown>).members as Array<Record<string, unknown>> | undefined;
          (members ?? []).forEach((m) => { if (m.id) userIds.add(String(m.id)); });
        }
      }
      if (userIds.size > 0) {
        await client.inviteToPoll(pollId, companyId, 'users', [...userIds]).catch(() => {});
      }
    }

    // 6. Publish the poll
    const published = await client.publishPoll(pollId);
    if (!published) {
      // publishPoll returned false — try once more after a short delay
      await new Promise((r) => setTimeout(r, 800));
      const retry = await client.publishPoll(pollId).catch(() => false);
      if (!retry) console.warn(`[Poll] publishPoll returned false for poll ${pollId} — poll may remain as draft`);
    }

    // 7. Send notification message to ALL selected chats
    const startDate = new Date(start_time * 1000).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const endDate = new Date(end_time * 1000).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    // Embed poll ID in a parseable format at the end of the message
    const msgText = `📊 **Neue Umfrage: „${name}"**\n${description ? description + '\n' : ''}Zeitraum: ${startDate} – ${endDate}\n\nKlicke hier, um teilzunehmen. [%poll:${pollId}%]`;

    const notifyTargets: Array<{ id: string; type: 'channel' | 'conversation' }> = [];
    for (const id of invite_channel_ids) notifyTargets.push({ id, type: 'channel' });
    for (const id of invite_conversation_ids) notifyTargets.push({ id, type: 'conversation' });
    // Also notify the source chat if opened from a specific chat (avoids duplicates)
    if (notify_chat_id && notify_chat_type && !notifyTargets.some((t) => t.id === notify_chat_id)) {
      notifyTargets.push({ id: notify_chat_id, type: notify_chat_type });
    }
    for (const target of notifyTargets) {
      await client.sendMessage({ target: target.id, target_type: target.type, text: msgText }).catch(() => {});
    }

    res.json({ id: pollId });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

/** Delete a poll */
app.delete('/api/polls/:id', async (req, res) => {
  try {
    const client = await getClient(req);
    await client.deletePoll(req.params.id);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

/** Archive / unarchive a poll */
app.post('/api/polls/:id/archive', async (req, res) => {
  try {
    const client = await getClient(req);
    const archive = req.body.archive !== false;
    await client.archivePoll(req.params.id, archive);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

/** Close a poll early (set end_time to now) */
app.post('/api/polls/:id/close', async (req, res) => {
  try {
    const client = await getClient(req);
    const { name, company_id, start_time } = req.body as { name: string; company_id: string; start_time: number };
    await client.editPoll({
      poll_id: req.params.id,
      company_id,
      name,
      start_time,
      end_time: Math.floor(Date.now() / 1000),
    });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: errorMessage(err) }); }
});

/** Submit answers for a question — { question_id, answer_ids: string[] } */
app.post('/api/polls/:id/answer', async (req, res) => {
  try {
    const client = await getClient(req);
    const { question_id, answer_ids } = req.body as { question_id: string; answer_ids: string[] };
    await client.storePollUserAnswers(question_id, answer_ids);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: String(err) }); }
});

// ── Calls (WebRTC Audio) ──────────────────────────────────────────────────────

app.post('/api/call/get_turn_server', async (req, res) => {
  try {
    const client = await getClient(req);
    const data = client.api.createAuthenticatedRequestData({});
    const result = await client.api.post<{ turn_server: unknown }>('/call/get_turn_server', data);
    res.json(result.turn_server);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err, 'TURN server request failed') });
  }
});

app.post('/api/call/create', async (req, res) => {
  try {
    const client = await getClient(req);
    const { callee_id, target_id, target, type, verification } = req.body as Record<string, string>;
    const data = client.api.createAuthenticatedRequestData({
      callee_id,
      target_id: String(target_id),
      target: target || 'conversation',
      type: type || 'audio',
      verification,
    });
    const result = await client.api.post<{ call: unknown }>('/call/create', data);
    res.json(result.call);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err, 'Call creation failed') });
  }
});

app.post('/api/call/signal', async (req, res) => {
  try {
    const token = extractToken(req);
    const sessionPayload = decryptSession(token);
    const { clientKey, deviceId } = sessionPayload;
    const conn = activeSSE.get(clientKey);
    if (!conn?.realtime) {
      return res.status(503).json({ error: 'Not connected to realtime' });
    }
    const socket = (conn.realtime as unknown as {
      socket: { emit: (event: string, ...args: unknown[]) => void } | null;
    }).socket;
    if (!socket) {
      return res.status(503).json({ error: 'Socket not available' });
    }
    const signalData = { ...req.body as Record<string, unknown>, deviceId };
    socket.emit('signal', signalData);
    serverLog(`[Call] Signal emitted: signalType=${(req.body as Record<string, unknown>).signalType}, call_id=${(req.body as Record<string, unknown>).call_id}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err, 'Signal send failed') });
  }
});

app.post('/api/call/end', async (req, res) => {
  try {
    const client = await getClient(req);
    const { call_id } = req.body as { call_id: number | string };
    const data = client.api.createAuthenticatedRequestData({ call_id: String(call_id) });
    await client.api.post('/call/end', data);
    res.json({ ok: true });
  } catch {
    // Call may already be ended — treat as success
    res.json({ ok: true });
  }
});

// ── OnlyOffice Document Server Integration (read-only) ──────────────────────

/** GET /api/onlyoffice/view — build viewer config for a file */
app.get('/api/onlyoffice/view', async (req, res) => {
  try {
    const client = await getClient(req);
    const token = extractToken(req);
    const payload = decryptSession(token);
    const { fileId, fileName } = req.query as Record<string, string>;

    if (!fileId || !fileName) {
      return res.status(400).json({ error: 'fileId and fileName required' });
    }

    if (!getOfficeDocType(fileName)) {
      return res.status(400).json({ error: 'Dateityp wird nicht unterstützt' });
    }

    const me = await client.getMe() as unknown as Record<string, unknown>;
    const userId = String(me.id);
    const userName = `${me.first_name || ''} ${me.last_name || ''}`.trim() || 'User';

    const dlToken = createDownloadToken({ fileId, clientKey: payload.clientKey });
    const downloadUrl = `${PUBLIC_URL}/api/onlyoffice/dl?secret=${encodeURIComponent(dlToken)}`;

    const result = buildViewerConfig({ fileId, fileName, userId, userName, downloadUrl });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err, 'OnlyOffice-Konfiguration fehlgeschlagen') });
  }
});

/** POST /api/onlyoffice/view-nc — OnlyOffice viewer config for Nextcloud files */
app.post('/api/onlyoffice/view-nc', async (req, res) => {
  try {
    const creds = await getNCCreds(req);
    if (!creds) return res.status(401).json({ error: 'Nextcloud-Zugangsdaten nicht konfiguriert' });

    const { path: filePath, fileName } = req.query as Record<string, string>;
    if (!filePath || !fileName) {
      return res.status(400).json({ error: 'path and fileName required' });
    }

    if (!getOfficeDocType(fileName)) {
      return res.status(400).json({ error: 'Dateityp wird nicht unterstützt' });
    }

    const token = extractToken(req);
    const payload = decryptSession(token);
    const dlToken = createDownloadToken({ ncPath: filePath, ncUsername: creds.username, ncAppPassword: creds.password, clientKey: payload.clientKey });
    const downloadUrl = `${PUBLIC_URL}/api/onlyoffice/dl-nc?secret=${encodeURIComponent(dlToken)}`;

    const userName = creds.username;
    const result = buildViewerConfig({ fileName, userId: creds.username, userName, downloadUrl });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err, 'OnlyOffice-Konfiguration fehlgeschlagen') });
  }
});

/** GET /api/onlyoffice/dl-nc — serve Nextcloud file bytes to OnlyOffice */
app.get('/api/onlyoffice/dl-nc', async (req, res) => {
  try {
    const { secret } = req.query as { secret: string };
    if (!secret) return res.status(400).json({ error: 'Missing secret' });

    const tokenData = validateDownloadToken(secret);
    if (!tokenData) return res.status(403).json({ error: 'Invalid or expired token' });
    if (!tokenData.ncPath || !tokenData.ncUsername || !tokenData.ncAppPassword) {
      return res.status(403).json({ error: 'Not a valid Nextcloud token' });
    }

    const baseUrl = process.env.NEXTCLOUD_URL || 'https://cloud.bbz-rd-eck.de';
    const creds = { baseUrl, username: tokenData.ncUsername, password: tokenData.ncAppPassword };
    const ncResp = await ncDownload(creds, tokenData.ncPath);
    const buf = Buffer.from(await ncResp.arrayBuffer());
    res.setHeader('Content-Type', ncResp.headers.get('content-type') || 'application/octet-stream');
    res.setHeader('Content-Disposition', 'inline');
    res.send(buf);
  } catch (err) {
    console.error('[OnlyOffice/dl-nc] Error:', err);
    res.status(500).json({ error: errorMessage(err, 'Download fehlgeschlagen') });
  }
});

/** GET /api/onlyoffice/dl — serve file bytes to OnlyOffice Document Server */
app.get('/api/onlyoffice/dl', async (req, res) => {
  try {
    const { secret } = req.query as { secret: string };
    if (!secret) return res.status(400).json({ error: 'Missing secret' });

    const tokenData = validateDownloadToken(secret);
    if (!tokenData) return res.status(403).json({ error: 'Invalid or expired token' });
    if (!tokenData.fileId) return res.status(403).json({ error: 'Not a Stashcat token' });

    const cached = clientCache.get(tokenData.clientKey);
    if (!cached) return res.status(403).json({ error: 'Session expired' });

    const client = cached.client;
    cached.expiresAt = Date.now() + CACHE_TTL;

    const info = await client.getFileInfo(tokenData.fileId);
    const buf = await client.downloadFile({
      id: tokenData.fileId,
      encrypted: info.encrypted,
      e2e_iv: info.e2e_iv ?? null,
    });

    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(info.name || 'document')}"`);
    res.setHeader('Content-Type', info.mime || 'application/octet-stream');
    res.send(buf);
  } catch (err) {
    console.error('[OnlyOffice/dl] Error:', err);
    res.status(500).json({ error: errorMessage(err, 'Download failed') });
  }
});

// ── Nextcloud WebDAV proxy ────────────────────────────────────────────────────

/**
 * Resolve NC credentials for the current request.
 * Password priority: X-NC-App-Password header > loginPassword from session token.
 * Username priority: X-NC-Username header > derived from user profile (Last, First).
 */
async function getNCCreds(req: express.Request): Promise<NCCredentials | null> {
  const token = extractToken(req);
  const payload = decryptSession(token);

  // Accept app password + username from header (JSON requests) or query param (direct URLs)
  const appPassword = (req.headers['x-nc-app-password'] as string | undefined)
    ?? (req.query.ncAppPw as string | undefined);
  const usernameOverride = (req.headers['x-nc-username'] as string | undefined)
    ?? (req.query.ncUser as string | undefined);

  const password = appPassword ?? payload.loginPassword;
  if (!password) return null;

  let username = usernameOverride;
  if (!username) {
    const client = await getClient(req);
    const me = await client.getMe() as unknown as Record<string, unknown>;
    username = `${me.last_name || ''}, ${me.first_name || ''}`.trim() || String(me.email || '');
  }
  if (!username) return null;

  const baseUrl = process.env.NEXTCLOUD_URL || 'https://cloud.bbz-rd-eck.de';
  return { baseUrl, username, password };
}

/** GET /api/nextcloud/status — check if credentials are available. */
app.get('/api/nextcloud/status', async (req, res) => {
  try {
    const creds = await getNCCreds(req);
    if (!creds) {
      return res.json({ configured: false, needsAppPassword: true });
    }
    res.json({ configured: true, username: creds.username });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

/** GET /api/nextcloud/probe — test credentials against WebDAV. */
app.get('/api/nextcloud/probe', async (req, res) => {
  try {
    const creds = await getNCCreds(req);
    if (!creds) {
      return res.json({ configured: false, needsAppPassword: true });
    }
    const ok = await ncProbe(creds);
    if (ok) {
      res.json({ configured: true, authMode: creds ? 'ad' : 'app-password', username: creds.username });
    } else {
      res.json({ configured: false, needsAppPassword: true });
    }
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

/** GET /api/nextcloud/folder?path=... — list folder contents. */
app.get('/api/nextcloud/folder', async (req, res) => {
  try {
    const creds = await getNCCreds(req);
    if (!creds) return res.status(401).json({ error: 'Nextcloud-Zugangsdaten nicht konfiguriert', needsAppPassword: true });
    const folderPath = (req.query.path as string) || '/';
    const entries = await ncListFolder(creds, folderPath);
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

/** GET /api/nextcloud/file?path=...&view=1 — download or view a file. */
app.get('/api/nextcloud/file', async (req, res) => {
  try {
    const creds = await getNCCreds(req);
    if (!creds) return res.status(401).json({ error: 'Nextcloud-Zugangsdaten nicht konfiguriert' });
    const filePath = req.query.path as string;
    if (!filePath) return res.status(400).json({ error: 'path required' });

    const ncRes = await ncDownload(creds, filePath);
    const contentType = ncRes.headers.get('content-type') || 'application/octet-stream';
    const disposition = req.query.view === '1' ? 'inline' : 'attachment';
    const fileName = filePath.split('/').pop() || 'download';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(fileName)}"`);
    const buf = Buffer.from(await ncRes.arrayBuffer());
    res.send(buf);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

/** POST /api/nextcloud/upload — upload a file (multer). */
app.post('/api/nextcloud/upload', upload.single('file'), async (req, res) => {
  const tmpPath = req.file?.path;
  try {
    const creds = await getNCCreds(req);
    if (!creds) return res.status(401).json({ error: 'Nextcloud-Zugangsdaten nicht konfiguriert' });
    if (!req.file) throw new Error('No file received');

    const folderPath = (req.body as Record<string, string>).path || '/';
    const originalName = req.file.originalname;
    const targetPath = folderPath.replace(/\/$/, '') + '/' + originalName;
    const buf = await fs.readFile(tmpPath!);

    await ncUpload(creds, targetPath, buf, req.file.mimetype || 'application/octet-stream');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  } finally {
    if (tmpPath) await fs.unlink(tmpPath).catch(() => {});
  }
});

/** POST /api/nextcloud/delete — delete one or more paths. */
app.post('/api/nextcloud/delete', async (req, res) => {
  try {
    const creds = await getNCCreds(req);
    if (!creds) return res.status(401).json({ error: 'Nextcloud-Zugangsdaten nicht konfiguriert' });
    const { paths } = req.body as { paths: string[] };
    for (const p of paths) await ncDelete(creds, p);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

/** POST /api/nextcloud/mkcol — create a folder. */
app.post('/api/nextcloud/mkcol', async (req, res) => {
  try {
    const creds = await getNCCreds(req);
    if (!creds) return res.status(401).json({ error: 'Nextcloud-Zugangsdaten nicht konfiguriert' });
    const { path: folderPath } = req.body as { path: string };
    await ncMkcol(creds, folderPath);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

/** POST /api/nextcloud/move — move a file/folder. */
app.post('/api/nextcloud/move', async (req, res) => {
  try {
    const creds = await getNCCreds(req);
    if (!creds) return res.status(401).json({ error: 'Nextcloud-Zugangsdaten nicht konfiguriert' });
    const { from, to } = req.body as { from: string; to: string };
    await ncMove(creds, from, to);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

/** POST /api/nextcloud/rename — rename by MOVE to same folder with new name. */
app.post('/api/nextcloud/rename', async (req, res) => {
  try {
    const creds = await getNCCreds(req);
    if (!creds) return res.status(401).json({ error: 'Nextcloud-Zugangsdaten nicht konfiguriert' });
    const { path: filePath, newName } = req.body as { path: string; newName: string };
    const parent = filePath.substring(0, filePath.lastIndexOf('/')) || '/';
    const newPath = parent.replace(/\/$/, '') + '/' + newName;
    await ncMove(creds, filePath, newPath);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

/** POST /api/nextcloud/share — create a public share link. */
app.post('/api/nextcloud/share', async (req, res) => {
  try {
    const creds = await getNCCreds(req);
    if (!creds) return res.status(401).json({ error: 'Nextcloud-Zugangsdaten nicht konfiguriert' });
    const { path: filePath, password } = req.body as { path: string; password?: string };
    const result = await ncCreateShare(creds, filePath, password);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

/** GET /api/nextcloud/quota — storage quota. */
app.get('/api/nextcloud/quota', async (req, res) => {
  try {
    const creds = await getNCCreds(req);
    if (!creds) return res.status(401).json({ error: 'Nextcloud-Zugangsdaten nicht konfiguriert' });
    const quota = await ncQuota(creds);
    res.json(quota);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

// ── Production: serve static frontend from dist/ ─────────────────────────────

// Serve static frontend — try dist/ first, then project root (for Plesk)
{
  const cwd = process.cwd();
  const distPath = path.resolve(cwd, 'dist');
  console.log(`[Static] Serving frontend from ${distPath} and ${cwd}`);
  // dist/ takes priority (contains built assets)
  app.use(express.static(distPath));
  // Also serve from project root (Plesk may set cwd to project root)
  app.use(express.static(cwd));
  // SPA fallback: serve the BUILT index.html (not the dev one)
  app.get('{*path}', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT) || 3001;

app.listen(PORT, () => {
  console.log(`BBZ Chat backend running on http://localhost:${PORT}`);
});
