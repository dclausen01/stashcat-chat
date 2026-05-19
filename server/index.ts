import express from 'express';
import type { Request as ExpressRequest } from 'express';
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
  stashcatUserIdByClientKey,
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
import configRouter from './routes/config';
import { isBotConversation } from './lib/bot';
import {
  generateMobileToken,
  saveMobileToken,
  loadMobileToken,
  touchMobileToken,
  deleteMobileToken,
  extractMobileToken,
} from './mobile-auth';
import pushRouter, { initPushDispatcher, notifyPush } from './push';
import { listForUser as listPushTokensForUser } from './push/token-store';

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
app.use('/api', configRouter);
app.use('/api', pushRouter);

// Bootstrap the push dispatcher once the realtime listeners are wired below.
initPushDispatcher();

// Periodisches Health-Log der Realtime/Push-Pipeline (alle 60 s).
// Damit sehen wir, ob "Push-only"-Verbindungen tatsächlich am Leben bleiben.
setInterval(() => {
  let total = 0;
  let withSse = 0;
  let pushOnly = 0;
  let realtimeAlive = 0;
  for (const conn of activeSSE.values()) {
    total += 1;
    if (conn.sseClients.size > 0) withSse += 1;
    else pushOnly += 1;
    if (conn.realtime) realtimeAlive += 1;
  }
  if (total > 0) {
    serverLog(`[Health] activeSSE=${total} (sse=${withSse}, push-only=${pushOnly}, realtime-alive=${realtimeAlive})`);
  }
}, 60_000).unref?.();

// Shared state and helpers moved to ./lib/state.ts

// ── Push-Dedup-Cache ─────────────────────────────────────────────────────────
// Stashcat schickt eine eingehende Nachricht je nach Online-Status mal als
// 'notification', mal als 'message_sync'. Wir wollen aus beiden Handlern
// notifyPush() rufen (damit Push auch im Background-mit-aktiver-SSE-Fall
// rauskommt), aber jede Message nur EINMAL pushen. Dedup-Key = "<userId>:<msgId>".
const recentPushKeys = new Map<string, number>(); // key → timestamp
const PUSH_DEDUP_WINDOW_MS = 60_000;

function shouldPushOnce(userId: string, msgId: string | undefined): boolean {
  if (!msgId) return true; // ohne ID gar nicht erst deduplizieren
  const key = `${userId}:${msgId}`;
  const now = Date.now();
  // Periodisches Cleanup (lazy — beim nächsten Aufruf)
  if (recentPushKeys.size > 500) {
    for (const [k, ts] of recentPushKeys) {
      if (now - ts > PUSH_DEDUP_WINDOW_MS) recentPushKeys.delete(k);
    }
  }
  if (recentPushKeys.has(key)) return false;
  recentPushKeys.set(key, now);
  return true;
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

    // Diagnose: jeden vom Stashcat-Server kommenden Event protokollieren —
    // hilft, wenn wir Events erwarten (z.B. 'notification' bei neuer Nachricht)
    // aber nichts in unseren Spezial-Handlern feuert. Args werden auf 400
    // Zeichen gekürzt damit das Log nicht explodiert.
    const sockAny = (rt as unknown as { socket?: { onAny?: (cb: (event: string, ...args: unknown[]) => void) => void } }).socket;
    if (sockAny && typeof sockAny.onAny === 'function') {
      sockAny.onAny((event: string, ...args: unknown[]) => {
        // 'connect'/'disconnect'/'ping'/'pong' sind Socket.io-Internals — uninteressant
        if (event === 'connect' || event === 'disconnect' || event === 'ping' || event === 'pong') return;
        const preview = JSON.stringify(args).slice(0, 400);
        serverLog(`[Realtime] 📡 ${clientKey.slice(0, 8)} "${event}" ${preview}`);
      });
    }

    // Stashcat-User-ID einmalig cachen — wird für Token-Routing benötigt,
    // damit eine `notification` an Web-Session A trotzdem die FCM-Tokens
    // findet, die Mobile-Session B desselben Users registriert hat.
    // getMe() schlägt fehl wenn die Session abgelaufen ist; in dem Fall
    // fällt notifyPush einfach auf clientKey als Schlüssel zurück.
    try {
      const meRaw = await client.getMe();
      const stashcatUserId = String((meRaw as unknown as { id?: string | number }).id ?? '');
      if (stashcatUserId) {
        conn.stashcatUserId = stashcatUserId;
        stashcatUserIdByClientKey.set(clientKey, stashcatUserId);
        serverLog(`[Realtime] stashcatUserId für ${clientKey.slice(0, 8)} = ${stashcatUserId}`);
      }
    } catch (err) {
      serverLog(`[Realtime] getMe für ${clientKey.slice(0, 8)} fehlgeschlagen:`, errorMessage(err));
    }

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
      // Auto-reconnect: SSE-Clients ODER registrierte Push-Tokens halten die
      // Stashcat-Realtime-Connection am Leben. Push-User dürfen die App
      // backgrounden, ohne dass wir ihre Push-Pipeline kappen.
      setTimeout(async () => {
        const conn = activeSSE.get(clientKey);
        if (!conn) {
          serverLog(`[Realtime] Skipping reconnect for ${clientKey.slice(0, 8)} (SSE entry gone)`);
          return;
        }
        if (conn.sseClients.size > 0) {
          serverLog(`[Realtime] Reconnecting for clientKey ${clientKey.slice(0, 8)} (still has ${conn.sseClients.size} SSE clients)`);
          conn.realtime = undefined;
          connectRealtime(conn.client, clientKey).catch((err) => {
            serverLog(`[Realtime] Reconnect failed for ${clientKey.slice(0, 8)}:`, errorMessage(err));
          });
          return;
        }
        // Konservativ: Bei einem Lookup-Fehler reconnecten wir trotzdem.
        // Lieber unnötig eine Verbindung mehr als pro Disk-Glitch einen
        // Push-User in den Push-Verlust schicken.
        let pushTokens: { token: string }[] | null = null;
        try {
          pushTokens = await listPushTokensForUser(clientKey);
        } catch (err) {
          serverLog(
            `[Realtime] Push-Token-Lookup für ${clientKey.slice(0, 8)} fehlgeschlagen — reconnecte vorsorglich:`,
            errorMessage(err),
          );
        }
        if (pushTokens === null || pushTokens.length > 0) {
          const reason = pushTokens === null
            ? '(no SSE, push-lookup failed → conservative reconnect)'
            : `(no SSE but ${pushTokens.length} push token(s))`;
          serverLog(`[Realtime] Reconnecting for clientKey ${clientKey.slice(0, 8)} ${reason}`);
          conn.realtime = undefined;
          connectRealtime(conn.client, clientKey).catch((err) => {
            serverLog(`[Realtime] Reconnect failed for ${clientKey.slice(0, 8)}:`, errorMessage(err));
          });
        } else {
          serverLog(`[Realtime] Skipping reconnect for ${clientKey.slice(0, 8)} (no SSE clients, no push tokens)`);
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

      // Fan out to FCM auch bei message_sync, falls Stashcat das Event statt
      // 'notification' geliefert hat (typisch wenn der User noch "online" gilt
      // — also App im Hintergrund, aber WebView/SSE noch nicht pausiert).
      // Self-Echo (eigene Nachrichten) wird per Sender-Check übersprungen.
      try {
        const p = payload as Record<string, unknown>;
        const senderRaw = p.sender as Record<string, unknown> | undefined;
        const senderIdRaw = senderRaw?.id;
        const senderId = senderIdRaw != null ? String(senderIdRaw) : '';
        const conn = activeSSE.get(clientKey);
        const ownId = conn?.stashcatUserId || stashcatUserIdByClientKey.get(clientKey);
        if (!ownId || !senderId || senderId === ownId) return;
        const rawIdMs = p.id;
        const msgIdMs = rawIdMs != null ? String(rawIdMs) : undefined;
        const routeUserIdMs = ownId;
        if (!shouldPushOnce(routeUserIdMs, msgIdMs)) {
          serverLog(`[Realtime] message_sync push deduped (msgId=${msgIdMs})`);
          return;
        }
        const senderName = senderRaw
          ? `${(senderRaw.first_name as string | undefined) ?? ''} ${(senderRaw.last_name as string | undefined) ?? ''}`.trim() || undefined
          : undefined;
        const channelRawMs = (p.channel ?? p.target) as Record<string, unknown> | undefined;
        const channelNameMs = (typeof channelRawMs?.name === 'string' ? channelRawMs.name : undefined)
          ?? (typeof p.channel_name === 'string' ? p.channel_name : undefined)
          ?? undefined;
        const rawTextMs = p.text;
        const textMs = typeof rawTextMs === 'string' ? rawTextMs : '';
        notifyPush({
          userId: routeUserIdMs,
          msgId: msgIdMs,
          channelId: data.channel_id && data.channel_id !== 0 ? String(data.channel_id) : null,
          conversationId: data.conversation_id && data.conversation_id !== 0 ? String(data.conversation_id) : null,
          channelName: channelNameMs,
          senderName,
          preview: textMs.slice(0, 200),
        });
      } catch (err) {
        serverLog('[Realtime] message_sync notifyPush failed:', errorMessage(err));
      }
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

      // Fan out to FCM for registered mobile devices.
      try {
        const p = payload as Record<string, unknown>;
        const senderRaw = p.sender as Record<string, unknown> | undefined;
        const senderName = senderRaw
          ? `${(senderRaw.first_name as string | undefined) ?? ''} ${(senderRaw.last_name as string | undefined) ?? ''}`.trim() || undefined
          : undefined;
        // Best-effort channelName-Extraktion aus dem Stashcat-Payload.
        // Stashcat embed-Format variiert; wir probieren die üblichen Pfade
        // und nehmen den ersten Treffer. Wenn keiner liefert, fällt Flutter
        // auf seine Default-Anzeige zurück.
        const channelRaw = (p.channel ?? p.target) as Record<string, unknown> | undefined;
        const channelName = (typeof channelRaw?.name === 'string' ? channelRaw.name : undefined)
          ?? (typeof p.channel_name === 'string' ? p.channel_name : undefined)
          ?? undefined;
        const rawText = p.text;
        const text = typeof rawText === 'string' ? rawText : '';
        const rawId = p.id;
        const msgIdN = rawId != null ? String(rawId) : undefined;
        // Token-Routing geht über die Stashcat-User-ID, nicht über den
        // per-Session clientKey. Damit findet ein notification-Event an
        // Session A (z.B. Web) trotzdem die FCM-Tokens, die unter Session B
        // (z.B. Mobile-App) registriert wurden.
        const pushUserId = activeSSE.get(clientKey)?.stashcatUserId
          || stashcatUserIdByClientKey.get(clientKey)
          || clientKey;
        // Dedup: falls dasselbe msgId schon über den message_sync-Pfad
        // gepush wurde, hier nicht ein zweites Mal feuern.
        if (!shouldPushOnce(pushUserId, msgIdN)) {
          serverLog(`[Realtime] notification push deduped (msgId=${msgIdN})`);
          return;
        }
        notifyPush({
          userId: pushUserId,
          msgId: msgIdN,
          channelId: msg.channel_id && msg.channel_id !== 0 ? String(msg.channel_id) : null,
          conversationId: msg.conversation_id && msg.conversation_id !== 0 ? String(msg.conversation_id) : null,
          channelName,
          senderName,
          preview: text.slice(0, 200),
        });
      } catch (err) {
        serverLog('[Realtime] notifyPush failed:', errorMessage(err));
      }
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

// ── Mobile (Flutter shell) login ─────────────────────────────────────────────

/**
 * Single-shot login for the Flutter shell. Returns a long-lived `mobileToken`
 * that the shell stores in secure storage and exchanges for a session token on
 * every cold start via `/api/auth/mobile-session`.
 */
app.post('/api/auth/mobile-login', async (req, res) => {
  try {
    const { email, password, securityPassword } = req.body || {};
    if (!email || !password || !securityPassword) {
      return res.status(400).json({ error: 'email, password, securityPassword required' });
    }
    const baseUrl = process.env.STASHCAT_BASE_URL || 'https://api.stashcat.com/';
    const client = new StashcatClient({ baseUrl });
    await client.login({ email, password, securityPassword });

    const serialized = client.serialize();
    const sessionToken = encryptSession({
      deviceId: serialized.deviceId,
      clientKey: serialized.clientKey,
      securityPassword,
      loginPassword: password,
      baseUrl,
    });
    cacheClient(serialized.clientKey, client);

    const me = await client.getMe();
    // We key everything (push tokens, dispatcher fan-out, mobile sessions) by
    // the Stashcat `clientKey` so the lookup paths stay consistent. The
    // Stashcat user id is not exposed here intentionally.
    const userId = serialized.clientKey;

    const mobileToken = generateMobileToken();
    await saveMobileToken(mobileToken, {
      sessionToken,
      userId,
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
      pushPreviewMode: 'full',
    });

    res.json({ mobileToken, token: sessionToken, user: me });
  } catch (err) {
    res.status(401).json({ error: errorMessage(err, 'Mobile login failed') });
  }
});

/**
 * Exchange a mobileToken for a fresh session token. Called by the Flutter
 * shell on every cold start. Refreshes `lastSeenAt` (sliding TTL).
 */
app.post('/api/auth/mobile-session', async (req, res) => {
  try {
    const mobileToken = extractMobileToken(req as unknown as { headers: Record<string, string | string[] | undefined> });
    if (!mobileToken) return res.status(401).json({ error: 'Missing mobile token' });

    const record = await touchMobileToken(mobileToken);
    if (!record) return res.status(401).json({ error: 'Invalid or expired mobile token' });

    // Best-effort: validate the session token still decrypts. We don't reload
    // the user object here — the client will call /api/me right after.
    let user: unknown = null;
    try {
      const payload = decryptSession(record.sessionToken);
      // Re-warm the client cache by faking a request so subsequent calls hit cache.
      const fakeReq = { headers: { authorization: `Bearer ${record.sessionToken}` }, query: {} } as unknown as ExpressRequest;
      const client = await getClient(fakeReq);
      user = await client.getMe();
      // Touch cache TTL
      touchCachedClient(payload.clientKey);
    } catch {
      // Session might have expired upstream — return a fresh token anyway and
      // let the client re-login if /api/me fails.
    }

    res.json({ token: record.sessionToken, user });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err, 'Failed to restore mobile session') });
  }
});

app.post('/api/auth/mobile-logout', async (req, res) => {
  try {
    const mobileToken = extractMobileToken(req as unknown as { headers: Record<string, string | string[] | undefined> });
    if (mobileToken) {
      const record = await loadMobileToken(mobileToken);
      await deleteMobileToken(mobileToken);
      // Tear down the associated session as well, if we can.
      if (record?.sessionToken) {
        try {
          const payload = decryptSession(record.sessionToken);
          invalidateClient(payload.clientKey);
          const sse = activeSSE.get(payload.clientKey);
          if (sse) {
            void Promise.resolve(sse.realtime?.disconnect?.()).catch(() => {});
            activeSSE.delete(payload.clientKey);
          }
        } catch { /* token may already be invalid */ }
      }
    }
  } catch { /* ignore */ }
  res.json({ ok: true });
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
    if (!c) return;
    c.sseClients.delete(res);
    serverLog(`[SSE] Client removed. Remaining clients: ${c.sseClients.size}`);
    if (c.sseClients.size > 0) return;

    // Keine SSE-Clients mehr — aber Push-User dürfen die App schließen, ohne
    // dass wir ihre Realtime-Connection killen. Wir prüfen async, ob diese
    // Session FCM-Tokens hat: ja → Realtime weiter laufen lassen; nein →
    // Realtime trennen und Eintrag verwerfen.
    listPushTokensForUser(clientKey)
      .then((tokens) => {
        const stillNoSseClients = (activeSSE.get(clientKey)?.sseClients.size ?? 0) === 0;
        if (!stillNoSseClients) {
          serverLog(`[SSE] Re-checked clientKey ${clientKey.slice(0, 8)}: SSE-Client kam zurück, behalte Realtime.`);
          return;
        }
        if (tokens.length > 0) {
          serverLog(`[SSE] Keeping realtime alive for clientKey ${clientKey.slice(0, 8)} (push delivery, ${tokens.length} token(s))`);
          return;
        }
        serverLog(`[SSE] No SSE clients + no push tokens for clientKey: ${clientKey.slice(0, 8)} → disconnecting realtime`);
        c.realtime?.disconnect();
        activeSSE.delete(clientKey);
      })
      .catch((err) => {
        // Konservativ: Bei einem transienten Token-Store-I/O-Fehler die
        // Realtime-Connection NICHT killen — sonst verlieren Push-User
        // ihre Pipeline wegen eines kurzen Disk-Glitches. Lieber eine
        // Verbindung 10 Minuten "leaken", als 30 Minuten lang keine Pushes.
        serverLog(
          `[SSE] Push-Token-Lookup für ${clientKey.slice(0, 8)} fehlgeschlagen — halte Realtime vorsorglich am Leben:`,
          errorMessage(err),
        );
      });
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
