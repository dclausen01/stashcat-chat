import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { randomBytes, pbkdf2Sync, createDecipheriv } from 'crypto';
import { StashcatClient, type RsaPrivateKeyJwk } from 'stashcat-api';
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
import { serverLog, errorMessage } from './lib/logging';
import {
  preAuthCache,
  PREAUTH_TTL,
  PREAUTH_MAX_ENTRIES,
  consumePreAuthToken,
  activeSSE,
  pushSSE,
} from './lib/state';
import notificationsRouter from './routes/notifications';
import calendarRouter from './routes/calendar';
import callsRouter from './routes/calls';
import pollsRouter from './routes/polls';
import broadcastsRouter from './routes/broadcasts';
import linkPreviewRouter from './routes/link-preview';
import conversationsRouter from './routes/conversations';
import messagesRouter from './routes/messages';
import videoRouter from './routes/video';
import channelsRouter from './routes/channels';
import filesRouter from './routes/files';
import accountRouter from './routes/account';
import keySyncRouter from './routes/key-sync';
import onlyOfficeRouter from './routes/onlyoffice';
import nextcloudRouter from './routes/nextcloud';
import { isBotConversation } from './lib/bot';

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
app.use('/api', channelsRouter);
app.use('/api', filesRouter);
app.use('/api', accountRouter);
app.use('/api', keySyncRouter);
app.use('/api', onlyOfficeRouter);
app.use('/api', nextcloudRouter);

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
