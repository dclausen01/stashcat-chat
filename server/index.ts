import express from 'express';
import type { Request as ExpressRequest } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { existsSync as fsExistsSync, readFileSync as fsReadFileSync, writeFileSync as fsWriteFileSync } from 'fs';
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
  getRoutingUserId,
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
import { isBotConversation, findChatBot } from './lib/bot';
import {
  generateMobileToken,
  saveMobileToken,
  loadMobileToken,
  touchMobileToken,
  deleteMobileToken,
  extractMobileToken,
  listAllMobileTokens,
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

// ── Liveness-Konstanten ──────────────────────────────────────────────────────
//
// Fix A — globale Event-Stille-Erkennung:
// `lastRealtimeEventAt` wird von JEDEM echten Stashcat-Socket-Event
// aktualisiert (message_sync, notification, online_status_change, typing, …).
// online_status_change kommt bei aktiven Verbindungen quasi im Sekundentakt
// von Kontakten — wenn ueber ALLE Verbindungen hinweg minutenlang GAR kein
// Event kommt, obwohl Connections aktiv sind, ist das ein starkes Signal fuer
// ein systemisches Zustellungsproblem (Stashcat-Drosselung, IP-Ban, tote
// Sockets). Diesen Indikator hatten wir frueher nicht — er kostet nur einen
// Timestamp und skaliert auf beliebig viele Verbindungen.
let lastRealtimeEventAt = Date.now();
function markRealtimeEvent(): void { lastRealtimeEventAt = Date.now(); }
const EVENT_SILENCE_WARN_MS = 15 * 60_000;   // 15 Min globale Stille → WARN
let lastSilenceWarnAt = 0;

// Fix B — globale Obergrenze gleichzeitiger Realtime-Connections zum
// Stashcat-Push-Server. Schuetzt davor, Stashcat mit zu vielen parallelen
// Sockets zu provozieren (was am 22.05 das Event-Routing gestoppt hat).
// Per env konfigurierbar; konservativer Default. Achtung: bei wirklich
// vielen gleichzeitigen Push-Usern (Ziel: ~4000) ist das Ein-Prozess-haelt-
// alle-Connections-Modell ohnehin nicht tragfaehig — siehe Architektur-Notiz.
const MAX_REALTIME_CONNECTIONS = Number(process.env.MAX_REALTIME_CONNECTIONS || 800);
// Pacing zwischen Boot-Restore-Connects — bewusst langsam, um keinen
// Connection-Sturm gegen Stashcat zu fahren.
const BOOT_CONNECT_PACING_MS = Number(process.env.BOOT_CONNECT_PACING_MS || 750);

// Canary-Probe: bei globaler Stille EINE Verbindung per getMe testen, um
// "REST lebt, aber Socket bekommt nichts" (Ban/primary-device) von
// "Session tot" (→ reconnect) zu unterscheiden. NICHT pro Connection proben —
// das skaliert bei 4000 Usern nicht (4000 getMe alle paar Minuten wuerde
// selbst ein Rate-Limit triggern).
const CANARY_PROBE_TIMEOUT_MS = 10_000;
let lastCanaryProbeAt = 0;
const CANARY_PROBE_MIN_INTERVAL_MS = 5 * 60_000;

async function canaryProbe(): Promise<void> {
  const now = Date.now();
  if (now - lastCanaryProbeAt < CANARY_PROBE_MIN_INTERVAL_MS) return;
  lastCanaryProbeAt = now;
  // Erste Connection mit lebendem Client als Canary nehmen.
  const conn = [...activeSSE.values()].find((c) => c.realtime);
  if (!conn) return;
  try {
    await Promise.race([
      conn.client.getMe(),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error('probe timeout')), CANARY_PROBE_TIMEOUT_MS)),
    ]);
    // REST lebt, aber keine Socket-Events → Stashcat liefert nichts, obwohl
    // die Session gueltig ist. Das ist KEIN totes-Socket-Problem, sondern
    // hoechstwahrscheinlich Drosselung/primary-device. Reconnecten wuerde
    // nicht helfen und nur weitere Connection-Last erzeugen.
    serverLog('[Health] WARN: REST alive but no realtime events — likely Stashcat throttling/ban or another primary device. NOT reconnecting (would worsen connection pressure).');
  } catch (err) {
    serverLog('[Health] Canary probe failed (REST unreachable) — sessions likely dead:', errorMessage(err));
  }
}

// Periodisches Health-Log + globale Event-Stille-Erkennung (alle 60 s).
setInterval(() => {
  const now = Date.now();
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

  const silenceMs = now - lastRealtimeEventAt;
  if (total > 0) {
    const lastEvtAge = Math.round(silenceMs / 1000);
    serverLog(`[Health] activeSSE=${total} (sse=${withSse}, push-only=${pushOnly}, realtime-alive=${realtimeAlive}) lastEvent=${lastEvtAge}s ago`);
  }

  // Fix A — globale Event-Stille: aktive Connections, aber lange kein Event?
  // Das ist der Indikator, der uns die letzten Tage gefehlt hat. WARN +
  // Canary-Probe (max alle 5 Min), um Ban/Drosselung von toten Sessions zu
  // unterscheiden. Wir reconnecten NICHT automatisch — bei einer Drosselung
  // wuerde das die Connection-Last nur erhoehen und den Ban verlaengern.
  if (realtimeAlive > 0 && silenceMs > EVENT_SILENCE_WARN_MS) {
    if (now - lastSilenceWarnAt > EVENT_SILENCE_WARN_MS) {
      lastSilenceWarnAt = now;
      serverLog(`[Health] WARN: ${realtimeAlive} realtime connection(s) active but NO Stashcat event for ${Math.round(silenceMs/60000)} min. Investigating via canary probe…`);
    }
    void canaryProbe();
  }

  // Lock-Inheritance: wenn wir beim Boot den Restore-Pass uebersprungen
  // haben (Lock von einem anderen Prozess gehalten), pruefen wir hier
  // wiederholt nach. Stirbt der Lock-Owner (Plesk-Restart, OOM, …) waehrend
  // unser Prozess weiterlebt, holen wir den Restore nach — sonst stuenden
  // alle Mobile-Sessions des Vorgaengers ohne Realtime und damit ohne Push da.
  if (!bootRestoreDone) {
    serverLog('[Boot] Retry: boot-restore not yet done, checking lock ownership…');
    void restoreRealtimeForBoot();
  }

  // Worker-Generation: bin ich obsolet (neuerer Worker da)? Oder schreibe ich
  // mich falls die Datei verschwunden ist? Diese Checks sind so guenstig,
  // dass wir sie in den Health-Tick haengen.
  writeMyGenerationIfNewer();
  checkObsolete();
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

  const conn = activeSSE.get(clientKey);
  if (!conn) {
    serverLog(`[Realtime] No SSE entry for ${clientKey.slice(0, 8)} — skipping connect.`);
    return;
  }

  // Fix B — Connection-Budget: globale Obergrenze gleichzeitiger Realtime-
  // Verbindungen. Genau die Connection-Flut (30-50 parallele Sockets durch
  // Worker-Rotation) hat am 22.05 das Stashcat-Event-Routing gestoppt. Wenn
  // diese Session noch keine eigene Realtime hat und das Budget voll ist,
  // verbinden wir NICHT — die Session bleibt im activeSSE registriert und
  // kann beim naechsten freien Slot nachziehen.
  if (!conn.realtime) {
    let aliveCount = 0;
    for (const c of activeSSE.values()) if (c.realtime) aliveCount++;
    if (aliveCount >= MAX_REALTIME_CONNECTIONS) {
      serverLog(`[Realtime] Connection budget reached (${aliveCount}/${MAX_REALTIME_CONNECTIONS}) — deferring realtime for ${clientKey.slice(0, 8)}.`);
      return;
    }
  }

  // `reconnect: false` — wir verwalten Reconnects ausschliesslich in unserem
  // disconnect-Handler. Socket.io-internes Auto-Reconnect plus unser eigenes
  // wuerden bei jedem Drop parallel zwei RealtimeManager am Leben halten und
  // pro Message zwei SSE-/Push-Events feuern.
  let rt;
  try {
    rt = await client.createRealtimeManager({ reconnect: false, debug: true });
  } catch (err) {
    serverLog(`[Realtime] createRealtimeManager failed for ${clientKey.slice(0, 8)}:`, errorMessage(err));
    return;
  }

  // conn koennte zwischen await und jetzt verschwunden sein (logout/cleanup).
  if (activeSSE.get(clientKey) !== conn) {
    serverLog(`[Realtime] SSE entry for ${clientKey.slice(0, 8)} gone/replaced during connect — disconnecting RealtimeManager`);
    try { rt.disconnect(); } catch { /* noop */ }
    return;
  }
  conn.realtime = rt;

  // Gibt den Realtime-Slot frei, aber nur wenn wir noch der Besitzer sind.
  // Verhindert, dass eine spaete Cleanup-Aktion die *neue* Realtime-Verbindung
  // eines parallelen connectRealtime-Aufrufs aushaengt.
  const releaseRtSlot = () => {
    const c = activeSSE.get(clientKey);
    if (c && c.realtime === rt) c.realtime = undefined;
  };

  // Trennt unsere rt-Instanz sauber. WICHTIG: erst den Slot freigeben, dann
  // disconnect() rufen — sonst sieht der disconnect-Handler beim Owner-Check
  // immer noch sich selbst als „aktiv" und stoesst einen Reconnect an.
  const teardownRt = () => {
    releaseRtSlot();
    try { rt.disconnect(); } catch { /* noop */ }
  };

  // ── Handler VOR connect() registrieren ───────────────────────────────────
  // Stashcat schickt zwischen Socket-Connect und new_device_connected bereits
  // Events. Wenn die Handler erst nach `await new Promise(...)` haengen, gehen
  // diese Messages verloren — was sich nach Standby/Reconnect wie „eine
  // Nachricht ist verschwunden" anfuehlt.

  rt.on('message_sync', async (data: MessageSyncPayload) => {
    markRealtimeEvent();
    serverLog(`[Realtime] Received message_sync:`, {
      channel_id: data.channel_id,
      conversation_id: data.conversation_id,
      id: data.id,
      hasText: !!data.text,
    });

    // Suppress Chat Bot conversation messages from reaching the frontend
    const convId = data.conversation_id && data.conversation_id !== 0 ? String(data.conversation_id) : null;
    if (convId && isBotConversation(convId, clientKey)) {
      serverLog(`[Realtime] Dropping bot message`);
      return;
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
      const ownId = getRoutingUserId(clientKey);
      // Wenn die User-ID noch nicht gecached ist (ownId === clientKey),
      // fehlt der Self-Echo-Vergleich — sicherheitshalber nichts pushen,
      // um eigene Nachrichten nicht als Push an sich selbst zu schicken.
      if (ownId === clientKey || !senderId || senderId === ownId) return;
      const rawIdMs = p.id;
      const msgIdMs = rawIdMs != null ? String(rawIdMs) : undefined;
      if (!shouldPushOnce(ownId, msgIdMs)) {
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
        userId: ownId,
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
    markRealtimeEvent();
    const raw = data as Record<string, unknown>;
    const msg = raw.message as MessageSyncPayload | undefined;
    if (!msg) {
      serverLog(`[Realtime] Non-message notification received (keys: ${Object.keys(raw).join(', ')}):`, JSON.stringify(raw).slice(0, 500));
      return;
    }

    serverLog(`[Realtime] Received notification (new message):`, {
      channel_id: msg.channel_id,
      conversation_id: msg.conversation_id,
      id: msg.id,
    });

    const convId = msg.conversation_id && msg.conversation_id !== 0 ? String(msg.conversation_id) : null;
    if (convId && isBotConversation(convId, clientKey)) return;

    const payload: Record<string, unknown> = { ...msg };
    await decryptMessageInPlace(client, payload, {
      fallback: '[Nachricht konnte nicht entschlüsselt werden]',
      onError: (err) => serverLog('[Realtime] Failed to decrypt notification:', errorMessage(err)),
    });

    serverLog(`[Realtime] Pushing notification as message_sync to SSE`);
    pushSSE(clientKey, 'message_sync', payload);

    try {
      const p = payload as Record<string, unknown>;
      const senderRaw = p.sender as Record<string, unknown> | undefined;
      const senderName = senderRaw
        ? `${(senderRaw.first_name as string | undefined) ?? ''} ${(senderRaw.last_name as string | undefined) ?? ''}`.trim() || undefined
        : undefined;
      const channelRaw = (p.channel ?? p.target) as Record<string, unknown> | undefined;
      const channelName = (typeof channelRaw?.name === 'string' ? channelRaw.name : undefined)
        ?? (typeof p.channel_name === 'string' ? p.channel_name : undefined)
        ?? undefined;
      const rawText = p.text;
      const text = typeof rawText === 'string' ? rawText : '';
      const rawId = p.id;
      const msgIdN = rawId != null ? String(rawId) : undefined;
      const pushUserId = getRoutingUserId(clientKey);
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
    markRealtimeEvent();
    pushSSE(clientKey, 'typing', { chatType, chatId, userId });
  });

  rt.on('key_sync_request', (data: unknown) => {
    markRealtimeEvent();
    serverLog(`[Realtime] Received key_sync_request:`, JSON.stringify(data).slice(0, 300));
    pushSSE(clientKey, 'key_sync_request', data);
  });

  rt.on('online_status_change', (data: unknown) => {
    // Bewusst kein serverLog hier — Stashcat fan-outet diese Events an JEDE
    // aktive Connection mit dem User als Kontakt, das sind pro Status-Change
    // schnell 20+ Logzeilen. Aber markRealtimeEvent() rufen wir trotzdem:
    // online_status_change ist unser bester Liveness-Indikator (kommt bei
    // gesunden Verbindungen regelmaessig). Forwarding fuer die Verfuegbarkeits-
    // Dots im Browser laeuft ebenfalls weiter.
    markRealtimeEvent();
    pushSSE(clientKey, 'online_status_change', data);
  });

  rt.on('call_created', (data: unknown) => {
    markRealtimeEvent();
    serverLog(`[Realtime] call_created for clientKey ${clientKey.slice(0, 8)}`);
    pushSSE(clientKey, 'call_created', data);
  });

  rt.on('signal', (data: unknown) => {
    markRealtimeEvent();
    const sig = data as Record<string, unknown>;
    serverLog(`[Realtime] signal (${sig?.signalType}) for clientKey ${clientKey.slice(0, 8)}`);
    pushSSE(clientKey, 'call_signal', data);
  });

  rt.on('object_change', (data: unknown) => {
    markRealtimeEvent();
    const change = data as { type?: string };
    if (change?.type === 'call') {
      serverLog(`[Realtime] object_change (call) for clientKey ${clientKey.slice(0, 8)}`);
      pushSSE(clientKey, 'call_change', data);
    }
  });

  // ── Lifecycle-Handler ────────────────────────────────────────────────────

  rt.on('error', (err: Error) => {
    serverLog(`[Realtime] Error for clientKey ${clientKey.slice(0, 8)}:`, err.message);
  });

  rt.on('connect_error', (err: Error) => {
    serverLog(`[Realtime] Connect error for clientKey ${clientKey.slice(0, 8)}:`, err.message);
  });

  // disconnect: entscheidet, ob wir manuell reconnecten — basiert auf
  // SSE-Clients ODER registrierten Push-Tokens. Ownership-Check verhindert,
  // dass ein verspaeteter disconnect-Event von einem alten rt eine zweite
  // Realtime-Connection neben einer schon laufenden anstoesst.
  rt.on('disconnect', () => {
    serverLog(`[Realtime] Disconnected for clientKey ${clientKey.slice(0, 8)}`);
    setTimeout(async () => {
      const c = activeSSE.get(clientKey);
      if (!c) {
        serverLog(`[Realtime] Skipping reconnect for ${clientKey.slice(0, 8)} (SSE entry gone)`);
        return;
      }
      // Ownership: nur wenn wir noch der aktive rt sind, sind wir fuer
      // Reconnects zustaendig. Sonst hat eine parallele Logik schon einen
      // neuen rt installiert.
      if (c.realtime !== rt && c.realtime !== undefined) {
        serverLog(`[Realtime] Stale disconnect for ${clientKey.slice(0, 8)} — owned by newer rt, ignoring`);
        return;
      }
      if (c.sseClients.size > 0) {
        serverLog(`[Realtime] Reconnecting for clientKey ${clientKey.slice(0, 8)} (still has ${c.sseClients.size} SSE clients)`);
        c.realtime = undefined;
        connectRealtime(c.client, clientKey).catch((err) => {
          serverLog(`[Realtime] Reconnect failed for ${clientKey.slice(0, 8)}:`, errorMessage(err));
        });
        return;
      }
      // Push-Tokens unter stashcatUserId pruefen (NICHT clientKey).
      const routingUserId = getRoutingUserId(clientKey);
      let pushTokens: { token: string }[] | null = null;
      try {
        pushTokens = await listPushTokensForUser(routingUserId);
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
        c.realtime = undefined;
        connectRealtime(c.client, clientKey).catch((err) => {
          serverLog(`[Realtime] Reconnect failed for ${clientKey.slice(0, 8)}:`, errorMessage(err));
        });
      } else {
        serverLog(`[Realtime] Skipping reconnect for ${clientKey.slice(0, 8)} (no SSE clients, no push tokens)`);
        c.realtime = undefined;
      }
    }, 3000);
  });

  // ── Diagnostik-Logger fuer alle eingehenden Events ───────────────────────
  // onAny feuert in der aktuellen stashcat-api-Version praktisch nie (siehe
  // Logs), aber falls doch: jedes Event zaehlt als globales Lebenszeichen.
  const sockAny = (rt as unknown as { socket?: { onAny?: (cb: (event: string, ...args: unknown[]) => void) => void } }).socket;
  if (sockAny && typeof sockAny.onAny === 'function') {
    sockAny.onAny((event: string, ...args: unknown[]) => {
      if (event === 'connect' || event === 'disconnect' || event === 'ping' || event === 'pong') return;
      markRealtimeEvent();
      const preview = JSON.stringify(args).slice(0, 400);
      serverLog(`[Realtime] 📡 ${clientKey.slice(0, 8)} "${event}" ${preview}`);
    });
  }

  // ── Connect + Auth-Bestaetigung ──────────────────────────────────────────
  // Alle Handler stehen jetzt. Erst JETZT die Verbindung anstossen und auf
  // `new_device_connected` warten. Bei Timeout: rt sauber teardown, sonst
  // bleibt eine halb-konfigurierte Verbindung in conn.realtime haengen und
  // blockiert spaetere SSE-Connects (isNewConnection = false).
  try {
    await new Promise<void>((resolve, reject) => {
      let resolved = false;

      rt.once('new_device_connected', () => {
        if (!resolved) {
          resolved = true;
          serverLog(`[Realtime] Auth confirmed (new_device_connected) for clientKey ${clientKey.slice(0, 8)}`);
          resolve();
        }
      });

      rt.once('connect', () => {
        serverLog(`[Realtime] Socket connected for clientKey ${clientKey.slice(0, 8)}`);
      });

      rt.connect().catch((err) => {
        if (!resolved) {
          resolved = true;
          reject(err);
        }
      });

      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(new Error('Connection timeout: new_device_connected event not received'));
        }
      }, 15000);
    });
  } catch (err) {
    serverLog(`[Realtime] Connection failed for ${clientKey.slice(0, 8)}:`, errorMessage(err));
    teardownRt();
    return;
  }

  serverLog(`[Realtime] RealtimeManager fully connected for clientKey ${clientKey.slice(0, 8)}`);
  markRealtimeEvent(); // erfolgreicher Connect zaehlt als Lebenszeichen

  // ── Post-Connect: stashcatUserId cachen + Bot-Cache vorwaermen ───────────
  // stashcatUserId ist die Achse fuer Push-Token-Routing. Bot-Cache muss
  // gewaermt sein, bevor erste message_sync/notification reinkommt — sonst
  // schluepft die erste Bot-Message durch den Filter und triggert einen
  // unerwuenschten Push.
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

  findChatBot(client, clientKey).catch(() => { /* best-effort warm-up */ });
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
    // Mobile-Tokens werden — wie Push-Tokens — unter der Stashcat-User-ID
    // indiziert, damit dispatcher.silentForUser() die per-Geraet gesetzte
    // Push-Preview-Praeferenz tatsaechlich findet. Fallback auf clientKey
    // wenn die User-ID aus dem getMe()-Payload nicht extrahierbar war.
    const stashcatUserId = String((me as unknown as { id?: string | number }).id ?? '');
    const userId = stashcatUserId || serialized.clientKey;
    if (stashcatUserId) {
      stashcatUserIdByClientKey.set(serialized.clientKey, stashcatUserId);
    }

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
    // Push-Tokens sind unter stashcatUserId indiziert, nicht unter clientKey.
    listPushTokensForUser(getRoutingUserId(clientKey))
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

// ── Worker-Generation: Self-Shutdown wenn neuer Worker uebernimmt ───────────
//
// Plesk-Passenger kann unter Open-Source keinen per-App Worker-Cap und
// macht stattdessen graceful restarts — alte Worker bleiben am Leben, bis
// ihre offenen Connections geschlossen sind. Bei langlebigen SSE-Streams
// passiert das nie. Resultat: nach jedem Deploy wachsen die parallel
// laufenden Worker, jeder mit eigener Stashcat-Realtime-Connection, jeder
// pusht potentiell die gleichen Messages an FCM.
//
// Loesung: jeder Worker schreibt beim Boot seinen `bootTime` in
// `.worker-generation`. Jeder Worker prueft im Health-Tick: gibt es einen
// neueren Eintrag? Ja → beende dich selbst (graceful: SSE-Clients
// informieren, Realtime-Connections schliessen, dann process.exit).
//
// Grace Period: der alte Worker wartet 2 Min nach Boot des neuen, bevor
// er aufgibt. Das gibt dem Newer Zeit fuer seinen Boot-Restore-Pass.
// Sonst gaebe es eine kurze Luecke ohne aktive Realtime.
const GENERATION_PATH = '.worker-generation';
const MY_BOOT_TIME = Date.now();
const SUCCESSOR_GRACE_MS = 2 * 60_000;
let initiatingShutdown = false;

function writeMyGenerationIfNewer(): void {
  try {
    if (fsExistsSync(GENERATION_PATH)) {
      const raw = fsReadFileSync(GENERATION_PATH, 'utf8').trim();
      const [, tsRaw] = raw.split(':');
      const otherTs = Number(tsRaw);
      if (Number.isFinite(otherTs) && otherTs > MY_BOOT_TIME) return;
    }
    fsWriteFileSync(GENERATION_PATH, `${process.pid}:${MY_BOOT_TIME}`, 'utf8');
  } catch { /* noop */ }
}

function checkObsolete(): void {
  if (initiatingShutdown) return;
  try {
    if (!fsExistsSync(GENERATION_PATH)) return;
    const raw = fsReadFileSync(GENERATION_PATH, 'utf8').trim();
    const [pidRaw, tsRaw] = raw.split(':');
    const leaderPid = Number(pidRaw);
    const leaderTs = Number(tsRaw);
    if (!Number.isFinite(leaderTs) || !Number.isFinite(leaderPid)) return;
    if (leaderPid === process.pid) return; // ich bin der Leader
    if (leaderTs <= MY_BOOT_TIME) return;  // ich bin neuer/gleichalt

    // Grace Period: gib dem neueren Worker Zeit fuer Boot-Restore.
    const newerAgeMs = Date.now() - leaderTs;
    if (newerAgeMs < SUCCESSOR_GRACE_MS) {
      serverLog(`[Worker] Newer worker pid:${leaderPid} bootet vor ${Math.round(newerAgeMs/1000)}s — wartet noch in Grace-Period.`);
      return;
    }

    serverLog(`[Worker] Obsolete: newer worker pid:${leaderPid} hat uebernommen (age ${Math.round(newerAgeMs/1000)}s). Self-shutdown.`);
    initiatingShutdown = true;
    void shutdownGracefully();
  } catch { /* noop */ }
}

async function shutdownGracefully(): Promise<void> {
  // SSE-Clients schliessen, damit Frontend reconnected (auf den neuen Worker).
  // Wir senden noch einen synthetischen 'shutdown'-Event — der Client kann den
  // optional auswerten, aber wichtiger ist das `res.end()` selbst.
  for (const conn of activeSSE.values()) {
    for (const res of conn.sseClients) {
      try {
        res.write('event: shutdown\ndata: {"reason":"worker-rotation"}\n\n');
        res.end();
      } catch { /* noop */ }
    }
    try { conn.realtime?.disconnect(); } catch { /* noop */ }
  }
  // Kurze Wartezeit fuer Cleanup, dann exit. Passenger spawnt KEINEN Ersatz,
  // weil der neuere Worker bereits laeuft — der Pool ist somit nicht
  // unterbesetzt.
  setTimeout(() => {
    serverLog('[Worker] Exiting after graceful self-shutdown.');
    process.exit(0);
  }, 2000);
}

// Beim Boot meine Generation eintragen (falls ich der neueste bin).
writeMyGenerationIfNewer();

// ── Boot: Realtime fuer Mobile-Sessions wiederherstellen ─────────────────────
//
// Hintergrund: Realtime-Connections leben ausschliesslich im Speicher (Map
// `activeSSE`). Wenn Passenger/Plesk den Node-Prozess neu startet (Idle-Timeout,
// Memory-Limit, Deploy), sind ALLE Realtime-Connections weg — und werden erst
// neu aufgebaut, sobald ein Web-Client einen SSE-Connect macht. Fuer pure
// Mobile-User (die nie die Web-Tab oeffnen) heisst das: nach jedem Restart
// kommen Pushes erst wieder, wenn jemand mit Browser vorbeischaut.
//
// Diese Boot-Routine liest die persistierten Mobile-Tokens und stoesst pro
// gespeichertem Session-Token einen Realtime-Connect an. Damit ist die
// Push-Pipeline direkt nach Restart wieder live, ohne dass ein Mensch
// eingreifen muss. Voraussetzung: SESSION_SECRET ist als env-var gesetzt
// (sonst sind die persistierten Tokens nach Restart eh nicht mehr
// entschluesselbar).
//
// Cross-Process-Schutz via File-Lock: Passenger spawnt manchmal mehrere
// Worker (oder laesst beim Deploy einen alten Worker weiterlaufen). Ohne
// Lock wuerde JEDER Prozess einen Restore-Pass starten, was zu N parallelen
// Stashcat-Realtime-Connections pro Session fuehrt. Der Lock enthaelt PID
// und Timestamp; ein anderer Prozess macht den Restore nur, wenn der Lock
// alt (> 10 min) oder die im Lock stehende PID nicht mehr existiert.
const BOOT_LOCK_PATH = '.realtime-boot.lock';
const BOOT_LOCK_STALE_MS = 10 * 60_000;

// Wird nach erfolgreichem (oder bewusst abgebrochenem) Boot-Restore-Pass auf
// true gesetzt. Der Health-Loop pollt diesen Flag — wenn er false bleibt und
// der Lock-Owner stirbt, holen wir den Restore nach. Sonst stuende ein
// frisch gestarteter Survivor-Prozess ohne Realtime-Connections fuer alle
// Mobile-Sessions da, die der gestorbene Vorgaenger gehalten hatte.
let bootRestoreDone = false;

function writeBootLock(): void {
  try {
    fsWriteFileSync(BOOT_LOCK_PATH, `${process.pid}:${Date.now()}`, 'utf8');
  } catch { /* fail-silent, naechster Heartbeat versucht's wieder */ }
}

function tryAcquireBootLock(): boolean {
  try {
    const existing = fsExistsSync(BOOT_LOCK_PATH) ? fsReadFileSync(BOOT_LOCK_PATH, 'utf8').trim() : '';
    if (existing) {
      const [otherPidRaw, otherTsRaw] = existing.split(':');
      const otherPid = Number(otherPidRaw);
      const otherTs = Number(otherTsRaw);
      const ageMs = Date.now() - (Number.isFinite(otherTs) ? otherTs : 0);

      let otherAlive = false;
      if (Number.isFinite(otherPid) && otherPid > 0 && otherPid !== process.pid) {
        try {
          process.kill(otherPid, 0); // signal 0 = nur pruefen ob Prozess lebt
          otherAlive = true;
        } catch {
          otherAlive = false;
        }
      }

      if (otherAlive && ageMs < BOOT_LOCK_STALE_MS) {
        serverLog(`[Boot] Lock held by pid ${otherPid} (age ${Math.round(ageMs/1000)}s) — skipping restore.`);
        return false;
      }
      serverLog(`[Boot] Stale/dead lock (pid ${otherPid}, age ${Math.round(ageMs/1000)}s) — taking over.`);
    }
    writeBootLock();
    return true;
  } catch (err) {
    serverLog('[Boot] Lock acquisition error — proceeding without lock:', errorMessage(err));
    return true; // fail-open, lieber doppelt restoren als gar nicht
  }
}

// Lock-Owner refreshet alle 2 Minuten den Timestamp, damit die 10-Min-Stale-
// Erkennung nicht ueber Lifetime des Prozesses zuschnappt.
setInterval(() => {
  try {
    if (!fsExistsSync(BOOT_LOCK_PATH)) return;
    const raw = fsReadFileSync(BOOT_LOCK_PATH, 'utf8').trim();
    const [pidRaw] = raw.split(':');
    if (Number(pidRaw) === process.pid) writeBootLock();
  } catch { /* noop */ }
}, 2 * 60_000).unref?.();

// Lock beim sauberen Shutdown loslassen, damit der Nachfolge-Prozess sofort
// restoren kann statt 10 Min auf Stale-Detection zu warten.
function releaseBootLockIfOwned(): void {
  try {
    if (!fsExistsSync(BOOT_LOCK_PATH)) return;
    const raw = fsReadFileSync(BOOT_LOCK_PATH, 'utf8').trim();
    const [pidRaw] = raw.split(':');
    if (Number(pidRaw) === process.pid) {
      // Best-effort delete — kein require('fs').unlinkSync hier, weil
      // synchroner unlink in SIGTERM-Handler manchmal failt. fs/promises
      // wuerde async sein und das Programm beendet sich schon.
      // Daher: PID auf 0 setzen → andere erkennen das als invalid.
      fsWriteFileSync(BOOT_LOCK_PATH, `0:${Date.now()}`, 'utf8');
    }
  } catch { /* noop */ }
}
process.on('SIGTERM', releaseBootLockIfOwned);
process.on('SIGINT', releaseBootLockIfOwned);

async function restoreRealtimeForBoot(): Promise<void> {
  if (bootRestoreDone) return;
  if (!tryAcquireBootLock()) return;
  // Lock erworben — wir sind committed. Auch bei Fehler setzen wir den Flag
  // am Ende, sonst wuerde der periodische Retry-Loop im Health-Tick endlos
  // den gleichen kaputten Pass triggern.
  let records;
  try {
    records = await listAllMobileTokens();
  } catch (err) {
    serverLog('[Boot] listAllMobileTokens failed:', errorMessage(err));
    bootRestoreDone = true;
    return;
  }
  if (records.length === 0) {
    serverLog('[Boot] No mobile tokens to restore — Realtime stays cold until first SSE connect.');
    bootRestoreDone = true;
    return;
  }

  // Pro distinct sessionToken nur einmal restoren — ein User mit mehreren
  // Mobile-Geraeten teilt nicht zwingend denselben sessionToken (per Login
  // generiert), aber zwei Mobile-Tokens, die zum selben sessionToken zeigen,
  // sind moeglich wenn der User die App reinstalliert hat.
  const seenSessionTokens = new Set<string>();
  // Per-User-Dedup: pro stashcatUserId bauen wir nur EINE Realtime-Connection
  // auf, auch wenn der User mehrere Mobile-Tokens hat. Sonst sieht Stashcat
  // 16 parallele "Devices" fuer denselben Account und drosselt das Event-
  // Routing — Symptom: notification-Events kommen gar nicht mehr an.
  const seenUserIds = new Set<string>();
  let restoredCount = 0;
  let skippedDuplicateUser = 0;

  serverLog(`[Boot] Restoring Realtime for ${records.length} mobile session(s)…`);
  for (const record of records) {
    if (seenSessionTokens.has(record.sessionToken)) continue;
    seenSessionTokens.add(record.sessionToken);

    let clientKey: string;
    try {
      const payload = decryptSession(record.sessionToken);
      clientKey = payload.clientKey;
    } catch (err) {
      serverLog('[Boot] Skipping mobile token — session decrypt failed (SESSION_SECRET geaendert?):', errorMessage(err));
      continue;
    }

    if (activeSSE.has(clientKey)) {
      // Schon restored (z.B. doppelter mobile-token auf selben sessionToken)
      continue;
    }

    // Wenn der Mobile-Token noch im alten Format gespeichert ist
    // (record.userId === clientKey, also nicht die stashcatUserId), koennen
    // wir die Dedup-Pruefung erst nach dem getMe-Call durchfuehren — fuer
    // alle neueren Tokens reicht aber der Record direkt.
    const recordedUserId = record.userId;
    const looksLikeStashcatUserId = /^\d+$/.test(recordedUserId);
    if (looksLikeStashcatUserId && seenUserIds.has(recordedUserId)) {
      serverLog(`[Boot] Skipping ${clientKey.slice(0, 8)} — Realtime fuer stashcatUserId ${recordedUserId} bereits geplant.`);
      skippedDuplicateUser++;
      continue;
    }

    try {
      const fakeReq = { headers: { authorization: `Bearer ${record.sessionToken}` }, query: {} } as unknown as ExpressRequest;
      const client = await getClient(fakeReq);

      // Fuer Tokens im alten Format: getMe() ausfuehren, um stashcatUserId
      // zu ermitteln. Wenn schon eine Realtime fuer diesen User in dieser
      // Boot-Phase geplant ist, abbrechen.
      let resolvedUserId = looksLikeStashcatUserId ? recordedUserId : '';
      if (!resolvedUserId) {
        try {
          const me = await client.getMe();
          resolvedUserId = String((me as unknown as { id?: string | number }).id ?? '');
        } catch { /* getMe failed — wir restoren trotzdem, ohne Dedup */ }
      }
      if (resolvedUserId && seenUserIds.has(resolvedUserId)) {
        serverLog(`[Boot] Skipping ${clientKey.slice(0, 8)} — Realtime fuer stashcatUserId ${resolvedUserId} bereits geplant (legacy-token).`);
        skippedDuplicateUser++;
        continue;
      }
      if (resolvedUserId) seenUserIds.add(resolvedUserId);

      activeSSE.set(clientKey, { client, sseClients: new Set() });
      serverLog(`[Boot] Starting Realtime for clientKey ${clientKey.slice(0, 8)} (user ${resolvedUserId || 'unknown'})…`);
      restoredCount++;
      // Fire-and-forget — wir warten nicht auf jeden einzelnen Connect, der
      // 15-s-Auth-Timeout wuerde sonst den Boot blockieren.
      connectRealtime(client, clientKey).catch((err) => {
        serverLog(`[Boot] Realtime restore failed for ${clientKey.slice(0, 8)}:`, errorMessage(err));
        activeSSE.delete(clientKey);
        if (resolvedUserId) seenUserIds.delete(resolvedUserId);
      });
      // Sanftes Pacing — Stashcat-Server nicht mit gleichzeitigen Connects
      // beballern, falls viele Mobile-Sessions persistiert sind.
      await new Promise((r) => setTimeout(r, BOOT_CONNECT_PACING_MS));
    } catch (err) {
      serverLog(`[Boot] getClient failed for clientKey ${clientKey.slice(0, 8)} — Session abgelaufen?`, errorMessage(err));
    }
  }
  serverLog(`[Boot] Realtime restore pass done — ${restoredCount} Connection(s) gestartet, ${skippedDuplicateUser} skippt (duplicate user).`);
  bootRestoreDone = true;
}

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = Number(process.env.PORT) || 3001;

app.listen(PORT, () => {
  console.log(`BBZ Chat backend running on http://localhost:${PORT}`);
  // Asynchron — soll den Listener nicht blockieren.
  void restoreRealtimeForBoot();
});
