import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import * as fsSync from 'fs';
import { randomBytes, createHash, pbkdf2Sync, createDecipheriv } from 'crypto';
import { Readable } from 'stream';
import { StashcatClient, type RsaPrivateKeyJwk, type ActiveDevice } from 'stashcat-api';
import type { MessageSyncPayload } from 'stashcat-api';
import { encryptSession, decryptSession } from './token-crypto';
import { decryptMessageInPlace } from './lib/decrypt';
import {
  extractToken,
  getClient,
  cacheClient,
  touchCachedClient,
  invalidateClient,
} from './lib/get-client';
import { authenticate } from './middleware/auth';
import { debugLog, serverLog, errorMessage } from './lib/logging';
import {
  botCache,
  preAuthCache,
  PREAUTH_TTL,
  PREAUTH_MAX_ENTRIES,
  consumePreAuthToken,
  activeSSE,
  pendingKeyRequests,
  pushSSE,
  type BotInfo,
} from './lib/state';
import { getOfficeDocType, buildViewerConfig, validateDownloadToken, createDownloadToken, PUBLIC_URL } from './onlyoffice';
import { ncListFolder, ncDownload, ncUpload, ncDelete, ncMove, ncMkcol, ncQuota, ncProbe, ncCreateShare, type NCCredentials } from './nextcloud';
import notificationsRouter from './routes/notifications';
import calendarRouter from './routes/calendar';
import callsRouter from './routes/calls';
import pollsRouter from './routes/polls';
import broadcastsRouter from './routes/broadcasts';
import linkPreviewRouter from './routes/link-preview';
import conversationsRouter from './routes/conversations';
import messagesRouter from './routes/messages';
import videoRouter from './routes/video';
import { isBotConversation } from './lib/bot';

// Multer: store uploads in OS temp dir
const upload = multer({ dest: os.tmpdir() });

const app = express();
app.set('trust proxy', 1); // Trust first proxy (e.g. nginx) to get correct client IP for rate limiting
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Rate limiting — exempt SSE endpoint and file/image endpoints
const apiLimiter = rateLimit({
  windowMs: 60_000,
  max: 1000, // Increased to 1000 to allow fast channel switching and background requests
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/api/events' || req.path.startsWith('/api/file'),
});
app.use('/api/', apiLimiter);

// Resolve req.client for all /api routes except login, SSE and OnlyOffice downloads.
app.use(authenticate);

// ── Domain routers ───────────────────────────────────────────────────────────
app.use('/api', notificationsRouter);
app.use('/api', calendarRouter);
app.use('/api', callsRouter);
app.use('/api', pollsRouter);
app.use('/api', broadcastsRouter);
app.use('/api', linkPreviewRouter);
app.use('/api', conversationsRouter);
app.use('/api', messagesRouter);
app.use('/api', videoRouter);

// Shared state and helpers moved to ./lib/state.ts

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

      const payload: Record<string, unknown> = { ...data };
      await decryptMessageInPlace(client, payload, {
        fallback: '[Nachricht konnte nicht entschlüsselt werden]',
        onError: (err) => serverLog('[Realtime] Failed to decrypt message_sync:', errorMessage(err)),
      });

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
      await decryptMessageInPlace(client, payload, {
        fallback: '[Nachricht konnte nicht entschlüsselt werden]',
        onError: (err) => serverLog('[Realtime] Failed to decrypt notification:', errorMessage(err)),
      });

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
    cacheClient(serialized.clientKey, client);

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

    cacheClient(serialized.clientKey, client);
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

    cacheClient(serialized.clientKey, client);
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
      invalidateClient(payload.clientKey);
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
      touchCachedClient(clientKey);
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
    const client = req.client!;
    res.json(await client.getCompanies());
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

// ── Channels ──────────────────────────────────────────────────────────────────

app.get('/api/channels/:companyId/visible', async (req, res) => {
  try {
    const client = req.client!;
    const channels = await client.getVisibleChannels(req.params.companyId);
    res.json(channels);
  } catch (e) { res.status(500).json({ error: errorMessage(e) }); }
});

app.post('/api/channels/:channelId/join', async (req, res) => {
  try {
    const client = req.client!;
    await client.joinChannel(req.params.channelId);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: errorMessage(e) }); }
});

app.post('/api/channels/:channelId/quit', async (req, res) => {
  try {
    const client = req.client!;
    await client.quitChannel(req.params.channelId);
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
    const client = req.client!;
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
    const client = req.client!;
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
    const client = req.client!;
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
    const client = req.client!;
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
    const client = req.client!;
    const channelId = req.params.channelId;
    // Paginate until all members are fetched (channels can have 500+ members)
    // Note: Stashcat API has a hard cap of ~100 per request regardless of limit param
    // IMPORTANT: Exclude pending members (filter out membership_pending=true) to avoid
    // duplicate display in the frontend where members appear as both "joined" and "pending"
    const all: unknown[] = [];
    const PAGE = 100;
    let offset = 0;
    while (true) {
      const batch = await client.getChannelMembers(channelId, { limit: PAGE, offset });
      // Filter out pending members - they should only appear in the pending-members endpoint
      const nonPending = batch.filter((m) => {
        const pending = (m as any).membership_pending === true || (m as any).pending === true;
        return !pending;
      });
      all.push(...nonPending);
      if (batch.length < PAGE) break;
      offset += PAGE;
    }
    console.log(`[channels/members] channelId=${channelId} → ${all.length} members (excluding pending)`);
    if (all.length > 0) console.log('[channels/members] first member:', JSON.stringify(all[0]));
    res.json(all);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

app.get('/api/channels/:channelId/pending-members', async (req, res) => {
  try {
    const client = req.client!;
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
    const client = req.client!;
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
    const client = req.client!;
    const { userIds } = req.body as { userIds: string[] };
    await client.inviteUsersToChannel(req.params.channelId, userIds);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

app.delete('/api/channels/:channelId/members/:userId', async (req, res) => {
  try {
    const client = req.client!;
    await client.removeUserFromChannel(req.params.channelId, req.params.userId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

// ── Moderator management ─────────────────────────────────────────────────────

app.post('/api/channels/:channelId/moderator/:userId', async (req, res) => {
  try {
    const client = req.client!;
    await client.addChannelModerator(req.params.channelId, req.params.userId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

app.delete('/api/channels/:channelId/moderator/:userId', async (req, res) => {
  try {
    const client = req.client!;
    await client.removeChannelModerator(req.params.channelId, req.params.userId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

// ── Channel editing ──────────────────────────────────────────────────────────

app.patch('/api/channels/:channelId', async (req, res) => {
  try {
    const client = req.client!;
    const { description, company_id, name } = req.body as { description?: string; company_id: string; name?: string };
    const result = await client.editChannel({
      channel_id: req.params.channelId,
      company_id,
      description,
      ...(name !== undefined ? { channel_name: name } : {}),
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

// ── Channel image ────────────────────────────────────────────────────────────
app.post('/api/channels/:channelId/image', async (req, res) => {
  try {
    const client = req.client!;
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
    const client = req.client!;
    const ch = await client.getChannelInfo(req.params.channelId, true);
    res.json(ch);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

// ── Delete channel ────────────────────────────────────────────────────────────
app.delete('/api/channels/:channelId', async (req, res) => {
  try {
    const client = req.client!;
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
    const client = req.client!;
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
    const client = req.client!;
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
    const client = req.client!;
    const PAGE = 200;
    const allUsers: unknown[] = [];
    let offset = 0;
    let total = 0;
    while (true) {
      const result = await client.listManagedUsers(req.params.companyId, {
        groupIds: [req.params.groupId],
        limit: PAGE,
        offset,
      });
      allUsers.push(...(result.users as unknown[]));
      total = result.total ?? allUsers.length;
      if ((result.users as unknown[]).length < PAGE) break;
      offset += PAGE;
    }
    res.json({ users: allUsers, total });
  } catch (err) {
    console.error('[group-members] Error:', err);
    res.status(500).json({ error: errorMessage(err) });
  }
});

// ── Create channel ────────────────────────────────────────────────────────────

app.post('/api/channels', async (req, res) => {
  try {
    const client = req.client!;
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
    // Generate unique identifier for this channel creation request (required by API)
    const cryptoGen = await import('crypto');
    const uniqueIdentifier = cryptoGen.randomBytes(16).toString('hex');
    
    const channelOpts: Parameters<typeof client.createChannel>[0] & Record<string, unknown> = {
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
      message_ttl: 0,  // Must be explicitly set to 0 for signature to match
      ...(isPassword && password ? { password, password_repeat: password_repeat ?? password } : {}),
    };

    // For encrypted channels: generate AES key, encrypt with own public key, sign
    if (isEncrypted) {
      const aesKey = cryptoGen.randomBytes(32);

      if (!client.isE2EUnlocked()) {
        return res.status(400).json({ error: 'E2E not unlocked — encrypted channels require E2E. Please re-login with your security password.' });
      }

      // Get own public key
      const me = await client.getMe();
      if (!me.public_key) {
        return res.status(500).json({ error: 'Own public key not available' });
      }

      debugLog(`[channels/create] aesKey length=${aesKey.length} E2E_unlocked=${client.isE2EUnlocked()}`);
      debugLog(`[channels/create] public_key prefix="${me.public_key.slice(0, 40).replace(/\n/g, '\\n')}"`);

      // Encrypt AES key with own RSA public key (RSA-OAEP)
      const encryptedKey = StashcatClient.encryptWithPublicKey(me.public_key, aesKey);
      const keyBase64 = encryptedKey.toString('base64');
      channelOpts.encryption_key = keyBase64;

      debugLog(`[channels/create] encryptedKey length=${encryptedKey.length} keyBase64 length=${keyBase64.length}`);

      // Skip signature — the server accepts channels without it
      // This avoids signature mismatch warnings when the verification logic
      // doesn't match the original app's signing method.
      debugLog(`[channels/create] skipping signature (server accepts without)`);
    }

    const channel = await client.createChannel(channelOpts);
    const channelId = String((channel as unknown as Record<string,unknown>).id ?? '');
    debugLog(`[channels/create] created channel id=${channelId} name=${(channel as unknown as Record<string,unknown>).name ?? name} encrypted=${(channel as unknown as Record<string,unknown>).encrypted}`);
    debugLog(`[channels/create] response key length=${String((channel as unknown as Record<string,unknown>).key ?? '').length} key_sender=${(channel as unknown as Record<string,unknown>).key_sender}`);

    // Self-test: immediately verify we can decrypt the stored key
    if (isEncrypted && channelId) {
      try {
        const aesKeyFromServer = await client.getChannelAesKey(channelId);
        debugLog(`[channels/create] SELF-TEST getChannelAesKey: SUCCESS aesKey length=${aesKeyFromServer?.length}`);
      } catch (selfTestErr) {
        debugLog(`[channels/create] SELF-TEST getChannelAesKey: FAILED — ${errorMessage(selfTestErr, '')}`);
      }
    }

    res.json(channel);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err, 'Failed to create channel') });
  }
});

// ── Set missing encryption keys for channel members ──────────────────────────

app.post('/api/channels/:channelId/keys', async (req, res) => {
  try {
    const client = req.client!;
    const channelId = req.params.channelId;
    const { keys } = req.body as { keys: Array<{ user_id: string; key: string; key_signature: string }> };
    if (!keys || !Array.isArray(keys)) {
      return res.status(400).json({ error: 'keys array required' });
    }
    await (client as unknown as { setMissingKey: (type: string, id: string, keys: unknown[]) => Promise<void> }).setMissingKey('channel', channelId, keys);
    console.log(`[channels/keys] distributed ${keys.length} keys for channel ${channelId}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err, 'Failed to set channel keys') });
  }
});


// ── File Browser ─────────────────────────────────────────────────────────────

/** List folder contents for channel, conversation, or personal storage */
app.get('/api/files/folder', async (req, res) => {
  try {
    const client = req.client!;
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
    const client = req.client!;
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
    const client = req.client!;
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
    const client = req.client!;
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
    const client = req.client!;
    const { target_folder_id } = req.body as { target_folder_id: string };
    await client.moveFile(req.params.fileId, target_folder_id);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: errorMessage(e) }); }
});

// ── Create folder ─────────────────────────────────────────────────────────────
app.post('/api/files/folder/create', async (req, res) => {
  try {
    const client = req.client!;
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
    const client = req.client!;
    const { folderId } = req.body as { folderId: string };
    await client.deleteFolder(parseInt(folderId, 10));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err, 'Failed to delete folder') });
  }
});

app.post('/api/files/delete', async (req, res) => {
  try {
    const client = req.client!;
    const { fileIds } = req.body as { fileIds: string[] };
    await client.deleteFiles(fileIds);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

app.patch('/api/files/:fileId', async (req, res) => {
  try {
    const client = req.client!;
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
    const client = req.client!;
    const { fileId } = req.params;
    const fileName = (req.query.name as string) || 'download';

    const info = await client.getFileInfo(fileId);

    const disposition = req.query.view === '1' ? 'inline' : 'attachment';
    res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(fileName)}"`);
    res.setHeader('Content-Type', info.mime || 'application/octet-stream');

    if (!info.encrypted) {
      // Stream non-encrypted files directly — avoids loading the whole file into RAM
      const rawToken = ((req.headers['authorization'] as string | undefined)?.split(' ')[1] ?? req.query.token) as string;
      const { baseUrl } = decryptSession(rawToken);
      const authData = client.api.createAuthenticatedRequestData({}) as Record<string, string>;
      const formBody = new URLSearchParams({
        client_key: authData.client_key ?? '',
        device_id: authData.device_id ?? '',
      }).toString();

      const stashRes = await fetch(`${baseUrl}/file/download?id=${encodeURIComponent(fileId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formBody,
      });
      if (!stashRes.ok || !stashRes.body) throw new Error(`Stashcat download failed: ${stashRes.status}`);

      const contentLength = stashRes.headers.get('content-length');
      if (contentLength) res.setHeader('Content-Length', contentLength);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Readable.fromWeb(stashRes.body as any).pipe(res);
    } else {
      // Encrypted files must be fully buffered for E2E decryption
      const buf = await client.downloadFile({
        id: fileId,
        encrypted: info.encrypted,
        e2e_iv: info.e2e_iv ?? null,
      });
      res.send(buf);
    }
  } catch (err) {
    res.status(500).json({ error: errorMessage(err, 'Download failed') });
  }
});

// ── File Upload ───────────────────────────────────────────────────────────────

app.post('/api/upload/:type/:targetId', upload.single('file'), async (req, res) => {
  const tmpPath = req.file?.path;
  try {
    const client = req.client!;
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
    const client = req.client!;
    res.json(await client.getMe());
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

// ── Account ───────────────────────────────────────────────────────────────────

app.get('/api/account/settings', async (req, res) => {
  try {
    const client = req.client!;
    res.json(await client.getAccountSettings());
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

app.post('/api/account/status', async (req, res) => {
  try {
    const client = req.client!;
    const { status } = req.body;
    await client.changeStatus(status);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

app.post('/api/account/profile-image', async (req, res) => {
  try {
    const client = req.client!;
    const { imgBase64 } = req.body;
    await client.storeProfileImage(imgBase64);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

app.post('/api/account/profile-image/reset', async (req, res) => {
  try {
    const client = req.client!;
    await client.resetProfileImage();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});



// ── Key Sync (E2E key exchange) ───────────────────────────────────────────────

app.post('/api/key-sync/accept', async (req, res) => {
  try {
    const client = req.client!;
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


// ── OnlyOffice Document Server Integration (read-only) ──────────────────────

/** GET /api/onlyoffice/view — build viewer config for a file */
app.get('/api/onlyoffice/view', async (req, res) => {
  try {
    const client = req.client!;
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
    const creds = await getNCCred(req);
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

    const client = touchCachedClient(tokenData.clientKey);
    if (!client) return res.status(403).json({ error: 'Session expired' });

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
interface NCCredsResult {
  creds: NCCredentials;
  authMode: 'ad' | 'app-password';
}

async function getNCCreds(req: express.Request): Promise<NCCredsResult | null> {
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
    const client = req.client!;
    const me = await client.getMe() as unknown as Record<string, unknown>;
    username = `${me.last_name || ''}, ${me.first_name || ''}`.trim() || String(me.email || '');
  }
  if (!username) return null;

  const baseUrl = (process.env.NEXTCLOUD_URL || 'https://cloud.bbz-rd-eck.de').replace(/\/+$/, '');
  return {
    creds: { baseUrl, username, password },
    authMode: appPassword ? 'app-password' : 'ad',
  };
}

/** Convenience wrapper — returns only the NCCredentials (no authMode). */
async function getNCCred(req: express.Request): Promise<NCCredentials | null> {
  return (await getNCCreds(req))?.creds ?? null;
}

/** GET /api/nextcloud/status — check if credentials are available. */
app.get('/api/nextcloud/status', async (req, res) => {
  try {
    const result = await getNCCreds(req);
    if (!result) {
      return res.json({ configured: false, needsAppPassword: true });
    }
    res.json({ configured: true, authMode: result.authMode, username: result.creds.username });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

/** GET /api/nextcloud/probe — test credentials against WebDAV. */
app.get('/api/nextcloud/probe', async (req, res) => {
  try {
    const result = await getNCCreds(req);
    if (!result) {
      return res.json({ configured: false, needsAppPassword: true });
    }
    const probe = await ncProbe(result.creds);
    if (probe.ok) {
      return res.json({ configured: true, authMode: result.authMode, username: result.creds.username });
    }
    if (probe.reason === 'throttled') {
      // Nextcloud brute-force protection — credentials may be valid, IP is throttled.
      return res.json({ configured: true, throttled: true, authMode: result.authMode, username: result.creds.username });
    }
    if (probe.reason === 'auth') {
      return res.json({ configured: false, needsAppPassword: true, reason: 'auth' });
    }
    return res.json({ configured: false, reason: probe.reason, status: probe.status });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

/** GET /api/nextcloud/folder?path=... — list folder contents. */
app.get('/api/nextcloud/folder', async (req, res) => {
  try {
    const creds = await getNCCred(req);
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
    const creds = await getNCCred(req);
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
    const creds = await getNCCred(req);
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
    const creds = await getNCCred(req);
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
    const creds = await getNCCred(req);
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
    const creds = await getNCCred(req);
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
    const creds = await getNCCred(req);
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
    const creds = await getNCCred(req);
    if (!creds) return res.status(401).json({ error: 'Nextcloud-Zugangsdaten nicht konfiguriert' });
    const { path: filePath, password, permissions } = req.body as { path: string; password?: string; permissions?: number };
    const result = await ncCreateShare(creds, filePath, password, permissions);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

/** GET /api/nextcloud/quota — storage quota. */
app.get('/api/nextcloud/quota', async (req, res) => {
  try {
    const creds = await getNCCred(req);
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
