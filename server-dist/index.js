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
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
const path_1 = __importDefault(require("path"));
const crypto_1 = require("crypto");
const stashcat_api_1 = require("stashcat-api");
const token_crypto_1 = require("./token-crypto");
const decrypt_1 = require("./lib/decrypt");
const get_client_1 = require("./lib/get-client");
const auth_1 = require("./middleware/auth");
const logging_1 = require("./lib/logging");
const state_1 = require("./lib/state");
const notifications_1 = __importDefault(require("./routes/notifications"));
const calendar_1 = __importDefault(require("./routes/calendar"));
const calls_1 = __importDefault(require("./routes/calls"));
const polls_1 = __importDefault(require("./routes/polls"));
const broadcasts_1 = __importDefault(require("./routes/broadcasts"));
const link_preview_1 = __importDefault(require("./routes/link-preview"));
const conversations_1 = __importDefault(require("./routes/conversations"));
const messages_1 = __importDefault(require("./routes/messages"));
const video_1 = __importDefault(require("./routes/video"));
const channels_1 = __importDefault(require("./routes/channels"));
const files_1 = __importDefault(require("./routes/files"));
const account_1 = __importDefault(require("./routes/account"));
const key_sync_1 = __importDefault(require("./routes/key-sync"));
const onlyoffice_1 = __importDefault(require("./routes/onlyoffice"));
const nextcloud_1 = __importDefault(require("./routes/nextcloud"));
const config_1 = __importDefault(require("./routes/config"));
const bot_1 = require("./lib/bot");
const mobile_auth_1 = require("./mobile-auth");
const push_1 = __importStar(require("./push"));
const token_store_1 = require("./push/token-store");
const app = (0, express_1.default)();
app.set('trust proxy', 1); // Trust first proxy (e.g. nginx) to get correct client IP for rate limiting
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: '10mb' }));
// Rate limiting — exempt SSE endpoint and file/image endpoints
const apiLimiter = (0, express_rate_limit_1.default)({
    windowMs: 60_000,
    max: 1000, // Increased to 1000 to allow fast channel switching and background requests
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path === '/api/events' || req.path.startsWith('/api/file'),
});
app.use('/api/', apiLimiter);
// Resolve req.client for all /api routes except login, SSE and OnlyOffice downloads.
app.use(auth_1.authenticate);
// ── Domain routers ───────────────────────────────────────────────────────────
app.use('/api', notifications_1.default);
app.use('/api', calendar_1.default);
app.use('/api', calls_1.default);
app.use('/api', polls_1.default);
app.use('/api', broadcasts_1.default);
app.use('/api', link_preview_1.default);
app.use('/api', conversations_1.default);
app.use('/api', messages_1.default);
app.use('/api', video_1.default);
app.use('/api', channels_1.default);
app.use('/api', files_1.default);
app.use('/api', account_1.default);
app.use('/api', key_sync_1.default);
app.use('/api', onlyoffice_1.default);
app.use('/api', nextcloud_1.default);
app.use('/api', config_1.default);
app.use('/api', push_1.default);
// Bootstrap the push dispatcher once the realtime listeners are wired below.
(0, push_1.initPushDispatcher)();
// ── Liveness-Konstanten ──────────────────────────────────────────────────────
// Wenn `lastEventAt` aelter ist als STALE_AFTER_MS, gilt die Realtime als tot
// und wird (durch eigene disconnect) zwangs-recovered. Wir probieren erst,
// per REST-Call den Verdacht zu bestaetigen — Idle-Connections bei stillen
// Usern sind echt; tote Sockets reagieren auf den Probe nicht.
const REALTIME_STALE_AFTER_MS = 5 * 60_000; // 5 Min ohne irgendeinen Event
const REALTIME_PROBE_TIMEOUT_MS = 10_000; // getMe-Probe Timeout
const REALTIME_PROBE_MIN_INTERVAL_MS = 4 * 60_000; // Pro Conn max alle 4 Min probieren
async function probeRealtime(clientKey, conn) {
    const now = Date.now();
    if (conn.lastProbeAt && now - conn.lastProbeAt < REALTIME_PROBE_MIN_INTERVAL_MS)
        return;
    conn.lastProbeAt = now;
    try {
        const result = await Promise.race([
            conn.client.getMe(),
            new Promise((_, rej) => setTimeout(() => rej(new Error('probe timeout')), REALTIME_PROBE_TIMEOUT_MS)),
        ]);
        if (result) {
            // Erfolg = Session lebt. lastEventAt updaten, damit der Health-Loop
            // diese Conn nicht als stale markiert wenn der User wirklich nichts
            // schreibt.
            conn.lastEventAt = Date.now();
        }
    }
    catch (err) {
        (0, logging_1.serverLog)(`[Health] Probe failed for clientKey ${clientKey.slice(0, 8)} — forcing realtime reconnect:`, (0, logging_1.errorMessage)(err));
        // Disconnect → unser disconnect-Handler entscheidet, ob ein Reconnect
        // sinnvoll ist (SSE-Clients oder Push-Tokens vorhanden).
        try {
            conn.realtime?.disconnect();
        }
        catch { /* noop */ }
    }
}
// Periodisches Health-Log + aktive Liveness-Probes (alle 60 s).
setInterval(() => {
    const now = Date.now();
    let total = 0;
    let withSse = 0;
    let pushOnly = 0;
    let realtimeAlive = 0;
    for (const [clientKey, conn] of state_1.activeSSE) {
        total += 1;
        if (conn.sseClients.size > 0)
            withSse += 1;
        else
            pushOnly += 1;
        if (conn.realtime)
            realtimeAlive += 1;
        // Stale-Detection: wenn lange kein Event reinkam, einen aktiven Probe
        // anstossen. Der Probe selbst aktualisiert lastEventAt bei Erfolg, oder
        // forciert einen Reconnect bei Fehler.
        if (conn.realtime && conn.lastEventAt && now - conn.lastEventAt > REALTIME_STALE_AFTER_MS) {
            void probeRealtime(clientKey, conn);
        }
    }
    if (total > 0) {
        (0, logging_1.serverLog)(`[Health] activeSSE=${total} (sse=${withSse}, push-only=${pushOnly}, realtime-alive=${realtimeAlive})`);
    }
}, 60_000).unref?.();
// Shared state and helpers moved to ./lib/state.ts
// ── Push-Dedup-Cache ─────────────────────────────────────────────────────────
// Stashcat schickt eine eingehende Nachricht je nach Online-Status mal als
// 'notification', mal als 'message_sync'. Wir wollen aus beiden Handlern
// notifyPush() rufen (damit Push auch im Background-mit-aktiver-SSE-Fall
// rauskommt), aber jede Message nur EINMAL pushen. Dedup-Key = "<userId>:<msgId>".
const recentPushKeys = new Map(); // key → timestamp
const PUSH_DEDUP_WINDOW_MS = 60_000;
function shouldPushOnce(userId, msgId) {
    if (!msgId)
        return true; // ohne ID gar nicht erst deduplizieren
    const key = `${userId}:${msgId}`;
    const now = Date.now();
    // Periodisches Cleanup (lazy — beim nächsten Aufruf)
    if (recentPushKeys.size > 500) {
        for (const [k, ts] of recentPushKeys) {
            if (now - ts > PUSH_DEDUP_WINDOW_MS)
                recentPushKeys.delete(k);
        }
    }
    if (recentPushKeys.has(key))
        return false;
    recentPushKeys.set(key, now);
    return true;
}
// ── Realtime setup ───────────────────────────────────────────────────────────
async function connectRealtime(client, clientKey) {
    (0, logging_1.serverLog)(`[Realtime] Connecting for clientKey ${clientKey.slice(0, 8)}…`);
    // `reconnect: false` — wir verwalten Reconnects ausschliesslich in unserem
    // disconnect-Handler. Socket.io-internes Auto-Reconnect plus unser eigenes
    // wuerden bei jedem Drop parallel zwei RealtimeManager am Leben halten und
    // pro Message zwei SSE-/Push-Events feuern.
    let rt;
    try {
        rt = await client.createRealtimeManager({ reconnect: false, debug: true });
    }
    catch (err) {
        (0, logging_1.serverLog)(`[Realtime] createRealtimeManager failed for ${clientKey.slice(0, 8)}:`, (0, logging_1.errorMessage)(err));
        return;
    }
    const conn = state_1.activeSSE.get(clientKey);
    if (!conn) {
        (0, logging_1.serverLog)(`[Realtime] No SSE connection found, disconnecting RealtimeManager`);
        try {
            rt.disconnect();
        }
        catch { /* noop */ }
        return;
    }
    conn.realtime = rt;
    // Gibt den Realtime-Slot frei, aber nur wenn wir noch der Besitzer sind.
    // Verhindert, dass eine spaete Cleanup-Aktion die *neue* Realtime-Verbindung
    // eines parallelen connectRealtime-Aufrufs aushaengt.
    const releaseRtSlot = () => {
        const c = state_1.activeSSE.get(clientKey);
        if (c && c.realtime === rt)
            c.realtime = undefined;
    };
    // Trennt unsere rt-Instanz sauber. WICHTIG: erst den Slot freigeben, dann
    // disconnect() rufen — sonst sieht der disconnect-Handler beim Owner-Check
    // immer noch sich selbst als „aktiv" und stoesst einen Reconnect an.
    const teardownRt = () => {
        releaseRtSlot();
        try {
            rt.disconnect();
        }
        catch { /* noop */ }
    };
    // ── Handler VOR connect() registrieren ───────────────────────────────────
    // Stashcat schickt zwischen Socket-Connect und new_device_connected bereits
    // Events. Wenn die Handler erst nach `await new Promise(...)` haengen, gehen
    // diese Messages verloren — was sich nach Standby/Reconnect wie „eine
    // Nachricht ist verschwunden" anfuehlt.
    rt.on('message_sync', async (data) => {
        (0, logging_1.serverLog)(`[Realtime] Received message_sync:`, {
            channel_id: data.channel_id,
            conversation_id: data.conversation_id,
            id: data.id,
            hasText: !!data.text,
        });
        // Suppress Chat Bot conversation messages from reaching the frontend
        const convId = data.conversation_id && data.conversation_id !== 0 ? String(data.conversation_id) : null;
        if (convId && (0, bot_1.isBotConversation)(convId, clientKey)) {
            (0, logging_1.serverLog)(`[Realtime] Dropping bot message`);
            return;
        }
        const payload = { ...data };
        await (0, decrypt_1.decryptMessageInPlace)(client, payload, {
            fallback: '[Nachricht konnte nicht entschlüsselt werden]',
            onError: (err) => (0, logging_1.serverLog)('[Realtime] Failed to decrypt message_sync:', (0, logging_1.errorMessage)(err)),
        });
        (0, logging_1.serverLog)(`[Realtime] Pushing message_sync to SSE for clientKey ${clientKey.slice(0, 8)}`);
        (0, state_1.pushSSE)(clientKey, 'message_sync', payload);
        // Fan out to FCM auch bei message_sync, falls Stashcat das Event statt
        // 'notification' geliefert hat (typisch wenn der User noch "online" gilt
        // — also App im Hintergrund, aber WebView/SSE noch nicht pausiert).
        // Self-Echo (eigene Nachrichten) wird per Sender-Check übersprungen.
        try {
            const p = payload;
            const senderRaw = p.sender;
            const senderIdRaw = senderRaw?.id;
            const senderId = senderIdRaw != null ? String(senderIdRaw) : '';
            const ownId = (0, state_1.getRoutingUserId)(clientKey);
            // Wenn die User-ID noch nicht gecached ist (ownId === clientKey),
            // fehlt der Self-Echo-Vergleich — sicherheitshalber nichts pushen,
            // um eigene Nachrichten nicht als Push an sich selbst zu schicken.
            if (ownId === clientKey || !senderId || senderId === ownId)
                return;
            const rawIdMs = p.id;
            const msgIdMs = rawIdMs != null ? String(rawIdMs) : undefined;
            if (!shouldPushOnce(ownId, msgIdMs)) {
                (0, logging_1.serverLog)(`[Realtime] message_sync push deduped (msgId=${msgIdMs})`);
                return;
            }
            const senderName = senderRaw
                ? `${senderRaw.first_name ?? ''} ${senderRaw.last_name ?? ''}`.trim() || undefined
                : undefined;
            const channelRawMs = (p.channel ?? p.target);
            const channelNameMs = (typeof channelRawMs?.name === 'string' ? channelRawMs.name : undefined)
                ?? (typeof p.channel_name === 'string' ? p.channel_name : undefined)
                ?? undefined;
            const rawTextMs = p.text;
            const textMs = typeof rawTextMs === 'string' ? rawTextMs : '';
            (0, push_1.notifyPush)({
                userId: ownId,
                msgId: msgIdMs,
                channelId: data.channel_id && data.channel_id !== 0 ? String(data.channel_id) : null,
                conversationId: data.conversation_id && data.conversation_id !== 0 ? String(data.conversation_id) : null,
                channelName: channelNameMs,
                senderName,
                preview: textMs.slice(0, 200),
            });
        }
        catch (err) {
            (0, logging_1.serverLog)('[Realtime] message_sync notifyPush failed:', (0, logging_1.errorMessage)(err));
        }
    });
    // Incoming messages from others arrive as 'notification', not 'message_sync'.
    // 'message_sync' is only the sender's echo. Payload: { message: MessageSyncPayload }
    rt.on('notification', async (data) => {
        const raw = data;
        const msg = raw.message;
        if (!msg) {
            (0, logging_1.serverLog)(`[Realtime] Non-message notification received (keys: ${Object.keys(raw).join(', ')}):`, JSON.stringify(raw).slice(0, 500));
            return;
        }
        (0, logging_1.serverLog)(`[Realtime] Received notification (new message):`, {
            channel_id: msg.channel_id,
            conversation_id: msg.conversation_id,
            id: msg.id,
        });
        const convId = msg.conversation_id && msg.conversation_id !== 0 ? String(msg.conversation_id) : null;
        if (convId && (0, bot_1.isBotConversation)(convId, clientKey))
            return;
        const payload = { ...msg };
        await (0, decrypt_1.decryptMessageInPlace)(client, payload, {
            fallback: '[Nachricht konnte nicht entschlüsselt werden]',
            onError: (err) => (0, logging_1.serverLog)('[Realtime] Failed to decrypt notification:', (0, logging_1.errorMessage)(err)),
        });
        (0, logging_1.serverLog)(`[Realtime] Pushing notification as message_sync to SSE`);
        (0, state_1.pushSSE)(clientKey, 'message_sync', payload);
        try {
            const p = payload;
            const senderRaw = p.sender;
            const senderName = senderRaw
                ? `${senderRaw.first_name ?? ''} ${senderRaw.last_name ?? ''}`.trim() || undefined
                : undefined;
            const channelRaw = (p.channel ?? p.target);
            const channelName = (typeof channelRaw?.name === 'string' ? channelRaw.name : undefined)
                ?? (typeof p.channel_name === 'string' ? p.channel_name : undefined)
                ?? undefined;
            const rawText = p.text;
            const text = typeof rawText === 'string' ? rawText : '';
            const rawId = p.id;
            const msgIdN = rawId != null ? String(rawId) : undefined;
            const pushUserId = (0, state_1.getRoutingUserId)(clientKey);
            if (!shouldPushOnce(pushUserId, msgIdN)) {
                (0, logging_1.serverLog)(`[Realtime] notification push deduped (msgId=${msgIdN})`);
                return;
            }
            (0, push_1.notifyPush)({
                userId: pushUserId,
                msgId: msgIdN,
                channelId: msg.channel_id && msg.channel_id !== 0 ? String(msg.channel_id) : null,
                conversationId: msg.conversation_id && msg.conversation_id !== 0 ? String(msg.conversation_id) : null,
                channelName,
                senderName,
                preview: text.slice(0, 200),
            });
        }
        catch (err) {
            (0, logging_1.serverLog)('[Realtime] notifyPush failed:', (0, logging_1.errorMessage)(err));
        }
    });
    rt.on('user-started-typing', (chatType, chatId, userId) => {
        (0, logging_1.serverLog)(`[Realtime] Received typing event:`, { chatType, chatId, userId });
        (0, state_1.pushSSE)(clientKey, 'typing', { chatType, chatId, userId });
    });
    rt.on('key_sync_request', (data) => {
        (0, logging_1.serverLog)(`[Realtime] Received key_sync_request:`, JSON.stringify(data).slice(0, 300));
        (0, state_1.pushSSE)(clientKey, 'key_sync_request', data);
    });
    rt.on('online_status_change', (data) => {
        (0, logging_1.serverLog)(`[Realtime] Received online_status_change:`, JSON.stringify(data).slice(0, 300));
        (0, state_1.pushSSE)(clientKey, 'online_status_change', data);
    });
    rt.on('call_created', (data) => {
        (0, logging_1.serverLog)(`[Realtime] call_created for clientKey ${clientKey.slice(0, 8)}`);
        (0, state_1.pushSSE)(clientKey, 'call_created', data);
    });
    rt.on('signal', (data) => {
        const sig = data;
        (0, logging_1.serverLog)(`[Realtime] signal (${sig?.signalType}) for clientKey ${clientKey.slice(0, 8)}`);
        (0, state_1.pushSSE)(clientKey, 'call_signal', data);
    });
    rt.on('object_change', (data) => {
        const change = data;
        if (change?.type === 'call') {
            (0, logging_1.serverLog)(`[Realtime] object_change (call) for clientKey ${clientKey.slice(0, 8)}`);
            (0, state_1.pushSSE)(clientKey, 'call_change', data);
        }
    });
    // ── Lifecycle-Handler ────────────────────────────────────────────────────
    rt.on('error', (err) => {
        (0, logging_1.serverLog)(`[Realtime] Error for clientKey ${clientKey.slice(0, 8)}:`, err.message);
    });
    rt.on('connect_error', (err) => {
        (0, logging_1.serverLog)(`[Realtime] Connect error for clientKey ${clientKey.slice(0, 8)}:`, err.message);
    });
    // disconnect: entscheidet, ob wir manuell reconnecten — basiert auf
    // SSE-Clients ODER registrierten Push-Tokens. Ownership-Check verhindert,
    // dass ein verspaeteter disconnect-Event von einem alten rt eine zweite
    // Realtime-Connection neben einer schon laufenden anstoesst.
    rt.on('disconnect', () => {
        (0, logging_1.serverLog)(`[Realtime] Disconnected for clientKey ${clientKey.slice(0, 8)}`);
        setTimeout(async () => {
            const c = state_1.activeSSE.get(clientKey);
            if (!c) {
                (0, logging_1.serverLog)(`[Realtime] Skipping reconnect for ${clientKey.slice(0, 8)} (SSE entry gone)`);
                return;
            }
            // Ownership: nur wenn wir noch der aktive rt sind, sind wir fuer
            // Reconnects zustaendig. Sonst hat eine parallele Logik schon einen
            // neuen rt installiert.
            if (c.realtime !== rt && c.realtime !== undefined) {
                (0, logging_1.serverLog)(`[Realtime] Stale disconnect for ${clientKey.slice(0, 8)} — owned by newer rt, ignoring`);
                return;
            }
            if (c.sseClients.size > 0) {
                (0, logging_1.serverLog)(`[Realtime] Reconnecting for clientKey ${clientKey.slice(0, 8)} (still has ${c.sseClients.size} SSE clients)`);
                c.realtime = undefined;
                connectRealtime(c.client, clientKey).catch((err) => {
                    (0, logging_1.serverLog)(`[Realtime] Reconnect failed for ${clientKey.slice(0, 8)}:`, (0, logging_1.errorMessage)(err));
                });
                return;
            }
            // Push-Tokens unter stashcatUserId pruefen (NICHT clientKey).
            const routingUserId = (0, state_1.getRoutingUserId)(clientKey);
            let pushTokens = null;
            try {
                pushTokens = await (0, token_store_1.listForUser)(routingUserId);
            }
            catch (err) {
                (0, logging_1.serverLog)(`[Realtime] Push-Token-Lookup für ${clientKey.slice(0, 8)} fehlgeschlagen — reconnecte vorsorglich:`, (0, logging_1.errorMessage)(err));
            }
            if (pushTokens === null || pushTokens.length > 0) {
                const reason = pushTokens === null
                    ? '(no SSE, push-lookup failed → conservative reconnect)'
                    : `(no SSE but ${pushTokens.length} push token(s))`;
                (0, logging_1.serverLog)(`[Realtime] Reconnecting for clientKey ${clientKey.slice(0, 8)} ${reason}`);
                c.realtime = undefined;
                connectRealtime(c.client, clientKey).catch((err) => {
                    (0, logging_1.serverLog)(`[Realtime] Reconnect failed for ${clientKey.slice(0, 8)}:`, (0, logging_1.errorMessage)(err));
                });
            }
            else {
                (0, logging_1.serverLog)(`[Realtime] Skipping reconnect for ${clientKey.slice(0, 8)} (no SSE clients, no push tokens)`);
                c.realtime = undefined;
            }
        }, 3000);
    });
    // ── Diagnostik-Logger fuer alle eingehenden Events ───────────────────────
    //
    // Doppelfunktion: ausser dem Log-Output aktualisieren wir hier `lastEventAt`
    // pro Connection. Das ist der Anker fuer die Liveness-Detection — wenn
    // dieser Timestamp lange nicht mehr aktualisiert wurde, gilt die Realtime
    // als stale und wird vom Health-Loop neu aufgebaut.
    const sockAny = rt.socket;
    if (sockAny && typeof sockAny.onAny === 'function') {
        sockAny.onAny((event, ...args) => {
            // Jeder Event (auch ping/pong) zaehlt als Lebenszeichen — Socket.io
            // hebt das nicht raus, also nehmen wir alles ausser unseren eigenen
            // synthetischen Markern.
            const c = state_1.activeSSE.get(clientKey);
            if (c)
                c.lastEventAt = Date.now();
            if (event === 'connect' || event === 'disconnect' || event === 'ping' || event === 'pong')
                return;
            const preview = JSON.stringify(args).slice(0, 400);
            (0, logging_1.serverLog)(`[Realtime] 📡 ${clientKey.slice(0, 8)} "${event}" ${preview}`);
        });
    }
    // ── Connect + Auth-Bestaetigung ──────────────────────────────────────────
    // Alle Handler stehen jetzt. Erst JETZT die Verbindung anstossen und auf
    // `new_device_connected` warten. Bei Timeout: rt sauber teardown, sonst
    // bleibt eine halb-konfigurierte Verbindung in conn.realtime haengen und
    // blockiert spaetere SSE-Connects (isNewConnection = false).
    try {
        await new Promise((resolve, reject) => {
            let resolved = false;
            rt.once('new_device_connected', () => {
                if (!resolved) {
                    resolved = true;
                    (0, logging_1.serverLog)(`[Realtime] Auth confirmed (new_device_connected) for clientKey ${clientKey.slice(0, 8)}`);
                    resolve();
                }
            });
            rt.once('connect', () => {
                (0, logging_1.serverLog)(`[Realtime] Socket connected for clientKey ${clientKey.slice(0, 8)}`);
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
    }
    catch (err) {
        (0, logging_1.serverLog)(`[Realtime] Connection failed for ${clientKey.slice(0, 8)}:`, (0, logging_1.errorMessage)(err));
        teardownRt();
        return;
    }
    (0, logging_1.serverLog)(`[Realtime] RealtimeManager fully connected for clientKey ${clientKey.slice(0, 8)}`);
    conn.lastEventAt = Date.now();
    // ── Post-Connect: stashcatUserId cachen + Bot-Cache vorwaermen ───────────
    // stashcatUserId ist die Achse fuer Push-Token-Routing. Bot-Cache muss
    // gewaermt sein, bevor erste message_sync/notification reinkommt — sonst
    // schluepft die erste Bot-Message durch den Filter und triggert einen
    // unerwuenschten Push.
    try {
        const meRaw = await client.getMe();
        const stashcatUserId = String(meRaw.id ?? '');
        if (stashcatUserId) {
            conn.stashcatUserId = stashcatUserId;
            state_1.stashcatUserIdByClientKey.set(clientKey, stashcatUserId);
            (0, logging_1.serverLog)(`[Realtime] stashcatUserId für ${clientKey.slice(0, 8)} = ${stashcatUserId}`);
        }
    }
    catch (err) {
        (0, logging_1.serverLog)(`[Realtime] getMe für ${clientKey.slice(0, 8)} fehlgeschlagen:`, (0, logging_1.errorMessage)(err));
    }
    (0, bot_1.findChatBot)(client, clientKey).catch(() => { });
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
            loginPassword: password,
            baseUrl,
        });
        // Cache the client
        (0, get_client_1.cacheClient)(serialized.clientKey, client);
        const me = await client.getMe();
        res.json({ token, user: me });
    }
    catch (err) {
        res.status(401).json({ error: (0, logging_1.errorMessage)(err, 'Login failed') });
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
        const client = new stashcat_api_1.StashcatClient({ baseUrl });
        await client.login({ email, password, securityPassword });
        const serialized = client.serialize();
        const sessionToken = (0, token_crypto_1.encryptSession)({
            deviceId: serialized.deviceId,
            clientKey: serialized.clientKey,
            securityPassword,
            loginPassword: password,
            baseUrl,
        });
        (0, get_client_1.cacheClient)(serialized.clientKey, client);
        const me = await client.getMe();
        // Mobile-Tokens werden — wie Push-Tokens — unter der Stashcat-User-ID
        // indiziert, damit dispatcher.silentForUser() die per-Geraet gesetzte
        // Push-Preview-Praeferenz tatsaechlich findet. Fallback auf clientKey
        // wenn die User-ID aus dem getMe()-Payload nicht extrahierbar war.
        const stashcatUserId = String(me.id ?? '');
        const userId = stashcatUserId || serialized.clientKey;
        if (stashcatUserId) {
            state_1.stashcatUserIdByClientKey.set(serialized.clientKey, stashcatUserId);
        }
        const mobileToken = (0, mobile_auth_1.generateMobileToken)();
        await (0, mobile_auth_1.saveMobileToken)(mobileToken, {
            sessionToken,
            userId,
            createdAt: Date.now(),
            lastSeenAt: Date.now(),
            pushPreviewMode: 'full',
        });
        res.json({ mobileToken, token: sessionToken, user: me });
    }
    catch (err) {
        res.status(401).json({ error: (0, logging_1.errorMessage)(err, 'Mobile login failed') });
    }
});
/**
 * Exchange a mobileToken for a fresh session token. Called by the Flutter
 * shell on every cold start. Refreshes `lastSeenAt` (sliding TTL).
 */
app.post('/api/auth/mobile-session', async (req, res) => {
    try {
        const mobileToken = (0, mobile_auth_1.extractMobileToken)(req);
        if (!mobileToken)
            return res.status(401).json({ error: 'Missing mobile token' });
        const record = await (0, mobile_auth_1.touchMobileToken)(mobileToken);
        if (!record)
            return res.status(401).json({ error: 'Invalid or expired mobile token' });
        // Best-effort: validate the session token still decrypts. We don't reload
        // the user object here — the client will call /api/me right after.
        let user = null;
        try {
            const payload = (0, token_crypto_1.decryptSession)(record.sessionToken);
            // Re-warm the client cache by faking a request so subsequent calls hit cache.
            const fakeReq = { headers: { authorization: `Bearer ${record.sessionToken}` }, query: {} };
            const client = await (0, get_client_1.getClient)(fakeReq);
            user = await client.getMe();
            // Touch cache TTL
            (0, get_client_1.touchCachedClient)(payload.clientKey);
        }
        catch {
            // Session might have expired upstream — return a fresh token anyway and
            // let the client re-login if /api/me fails.
        }
        res.json({ token: record.sessionToken, user });
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err, 'Failed to restore mobile session') });
    }
});
app.post('/api/auth/mobile-logout', async (req, res) => {
    try {
        const mobileToken = (0, mobile_auth_1.extractMobileToken)(req);
        if (mobileToken) {
            const record = await (0, mobile_auth_1.loadMobileToken)(mobileToken);
            await (0, mobile_auth_1.deleteMobileToken)(mobileToken);
            // Tear down the associated session as well, if we can.
            if (record?.sessionToken) {
                try {
                    const payload = (0, token_crypto_1.decryptSession)(record.sessionToken);
                    (0, get_client_1.invalidateClient)(payload.clientKey);
                    const sse = state_1.activeSSE.get(payload.clientKey);
                    if (sse) {
                        void Promise.resolve(sse.realtime?.disconnect?.()).catch(() => { });
                        state_1.activeSSE.delete(payload.clientKey);
                    }
                }
                catch { /* token may already be invalid */ }
            }
        }
    }
    catch { /* ignore */ }
    res.json({ ok: true });
});
// ── Phased Login (multi-step wizard) ─────────────────────────────────────────
/**
 * Helper: connect to push.stashcat.com, emit key_sync_request,
 * and listen for key_sync_payload in the background.
 * Does NOT wait for payload — returns immediately.
 * The payload is stored in the preAuth entry when it arrives.
 */
async function triggerDeviceNotification(client, entry) {
    (0, logging_1.serverLog)('[DeviceNotify] Creating RealtimeManager...');
    const allDevices = await client.listActiveDevices();
    const ownDeviceId = client.serialize().deviceId;
    (0, logging_1.serverLog)('[DeviceNotify] Found', allDevices.length, 'total device(s), connecting to push...');
    const rt = await client.createRealtimeManager({ reconnect: false, debug: true });
    const socket = rt.socket;
    // When key_sync_payload arrives, store it in the preAuth entry
    rt.on('key_sync_payload', (data) => {
        try {
            const parsed = data;
            if (parsed && typeof parsed.payload === 'object' && parsed.payload !== null) {
                const payload = parsed.payload;
                const jwkData = payload.encrypted_private_key_jwk;
                if (jwkData && typeof jwkData === 'object') {
                    entry.encryptedKeyData = JSON.stringify(jwkData);
                    (0, logging_1.serverLog)('[DeviceNotify] Stored encrypted key data:', JSON.stringify(jwkData).length, 'chars');
                }
                else if (typeof payload.encrypted_private_key_jwk === 'string') {
                    entry.encryptedKeyData = payload.encrypted_private_key_jwk;
                    (0, logging_1.serverLog)('[DeviceNotify] Stored encrypted key data (string)');
                }
            }
        }
        catch (e) {
            (0, logging_1.serverLog)('[DeviceNotify] Error processing key_sync_payload:', e instanceof Error ? e.message : String(e));
        }
        setTimeout(() => { try {
            rt.disconnect();
        }
        catch { } }, 1000);
    });
    rt.on('error', (err) => {
        (0, logging_1.serverLog)('[DeviceNotify] Error:', err.message);
    });
    rt.on('disconnect', () => {
        (0, logging_1.serverLog)('[DeviceNotify] Disconnect event');
    });
    // Wait for new_device_connected, then emit key_sync_request
    rt.once('new_device_connected', () => {
        (0, logging_1.serverLog)('[DeviceNotify] new_device_connected received (auth confirmed)');
        const sock = rt.socket;
        if (sock) {
            const clientKey = client.serialize().clientKey;
            sock.emit('key_sync_request', ownDeviceId, clientKey);
            (0, logging_1.serverLog)('[DeviceNotify] key_sync_request emitted:', ownDeviceId.slice(0, 8) + '...', 'client_key:', clientKey.slice(0, 8) + '...');
        }
        else {
            (0, logging_1.serverLog)('[DeviceNotify] ERROR: socket is null!');
        }
    });
    rt.connect().then(() => {
        (0, logging_1.serverLog)('[DeviceNotify] Socket.io connect OK, waiting for new_device_connected...');
        const sock = rt.socket;
        if (sock && typeof sock.onAny === 'function') {
            sock.onAny((event, ...args) => {
                (0, logging_1.serverLog)(`[DeviceNotify] 📡 "${event}"`, JSON.stringify(args).slice(0, 500));
            });
        }
    }).catch((err) => {
        (0, logging_1.serverLog)('[DeviceNotify] connect() rejected:', err.message);
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
        (0, logging_1.serverLog)('[LoginCredentials] Attempting loginWithoutE2E for', email);
        const client = new stashcat_api_1.StashcatClient({ baseUrl });
        await client.loginWithoutE2E({ email, password });
        (0, logging_1.serverLog)('[LoginCredentials] loginWithoutE2E successful');
        // Generate short-lived preAuthToken
        const preAuthToken = (0, crypto_1.randomBytes)(32).toString('hex');
        const createdAt = Date.now();
        // LRU eviction: drop oldest entry if at capacity
        if (state_1.preAuthCache.size >= state_1.PREAUTH_MAX_ENTRIES) {
            const oldestKey = [...state_1.preAuthCache.keys()][0];
            state_1.preAuthCache.delete(oldestKey);
        }
        state_1.preAuthCache.set(preAuthToken, {
            client,
            createdAt,
            expiresAt: createdAt + state_1.PREAUTH_TTL,
            loginPassword: password,
        });
        res.json({ preAuthToken });
    }
    catch (err) {
        res.status(401).json({ error: (0, logging_1.errorMessage)(err, 'Login failed') });
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
        const preAuth = (0, state_1.consumePreAuthToken)(preAuthToken);
        if (!preAuth) {
            return res.status(400).json({ error: 'Invalid or expired preAuthToken' });
        }
        const { client, loginPassword } = preAuth;
        await client.unlockE2E(securityPassword);
        const serialized = client.serialize();
        const token = (0, token_crypto_1.encryptSession)({
            deviceId: serialized.deviceId,
            clientKey: serialized.clientKey,
            securityPassword,
            loginPassword,
            baseUrl: process.env.STASHCAT_BASE_URL || 'https://api.stashcat.com/',
        });
        (0, get_client_1.cacheClient)(serialized.clientKey, client);
        const me = await client.getMe();
        res.json({ token, user: me });
    }
    catch (err) {
        res.status(401).json({ error: (0, logging_1.errorMessage)(err, 'Failed to unlock E2E') });
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
        const entry = state_1.preAuthCache.get(preAuthToken);
        if (!entry || Date.now() > entry.expiresAt) {
            state_1.preAuthCache.delete(preAuthToken);
            return res.status(400).json({ error: 'Invalid or expired preAuthToken' });
        }
        // Fire-and-forget: trigger notification, payload will be stored in entry
        triggerDeviceNotification(entry.client, entry).catch((err) => {
            (0, logging_1.serverLog)('[DeviceInitiate] Background error:', (0, logging_1.errorMessage)(err));
        });
        res.json({ ok: true });
    }
    catch (err) {
        (0, logging_1.serverLog)('[DeviceInitiate] Error:', (0, logging_1.errorMessage)(err));
        res.status(500).json({ error: (0, logging_1.errorMessage)(err, 'Failed to initiate key transfer') });
    }
});
/**
 * Decrypt the encrypted private key JWK using the 6-digit code.
 * The key_derivation_properties contains PBKDF2 params (salt, iterations).
 * KEK = PBKDF2(code, salt, iterations, 32, sha256)
 * Then decrypt ciphertext with AES-256-CBC using the KEK.
 */
function decryptJwkWithCode(encryptedJwkJson, code) {
    const encryptedKey = JSON.parse(encryptedJwkJson);
    if (!encryptedKey.ciphertext || !encryptedKey.iv) {
        throw new Error('Invalid encrypted key structure');
    }
    const salt = Buffer.from(encryptedKey.key_derivation_properties?.salt || '', 'base64');
    const iterations = encryptedKey.key_derivation_properties?.iterations || 650000;
    // Derive KEK using PBKDF2
    const kek = (0, crypto_1.pbkdf2Sync)(code, salt, iterations, 32, 'sha256');
    // Decrypt ciphertext
    const ciphertextBuffer = Buffer.from(encryptedKey.ciphertext, 'base64');
    const ivBuffer = Buffer.from(encryptedKey.iv, 'base64');
    const decipher = (0, crypto_1.createDecipheriv)('aes-256-cbc', kek, ivBuffer);
    let decrypted = decipher.update(ciphertextBuffer);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return JSON.parse(decrypted.toString('utf8'));
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
        const entry = state_1.preAuthCache.get(preAuthToken);
        if (!entry || Date.now() > entry.expiresAt) {
            state_1.preAuthCache.delete(preAuthToken);
            return res.status(400).json({ error: 'Invalid or expired preAuthToken' });
        }
        const client = entry.client;
        const loginPassword = entry.loginPassword;
        // Wait up to 30s for the encrypted key data to arrive (it's stored asynchronously)
        let encryptedKeyData;
        for (let attempt = 0; attempt < 30; attempt++) {
            encryptedKeyData = entry.encryptedKeyData;
            if (encryptedKeyData)
                break;
            await new Promise(r => setTimeout(r, 1000));
        }
        if (!encryptedKeyData) {
            return res.status(400).json({
                error: 'Kein Gerät zur Authentifizierung verfügbar. Bitte schul.cloud auf einem eingeloggten Gerät öffnen!',
            });
        }
        (0, logging_1.serverLog)('[DeviceComplete] Decrypting key with code...');
        const jwk = decryptJwkWithCode(encryptedKeyData, code);
        client.unlockE2EWithPrivateKey(jwk);
        (0, logging_1.serverLog)('[DeviceComplete] E2E unlocked with decrypted JWK');
        const serialized = client.serialize();
        const token = (0, token_crypto_1.encryptSession)({
            deviceId: serialized.deviceId,
            clientKey: serialized.clientKey,
            privateKeyJwk: jwk,
            loginPassword,
            baseUrl: process.env.STASHCAT_BASE_URL || 'https://api.stashcat.com/',
        });
        (0, get_client_1.cacheClient)(serialized.clientKey, client);
        const me = await client.getMe();
        res.json({ token, user: me });
    }
    catch (err) {
        (0, logging_1.serverLog)('[DeviceComplete] Error:', (0, logging_1.errorMessage)(err));
        res.status(401).json({ error: (0, logging_1.errorMessage)(err, 'Failed to complete key transfer') });
    }
});
app.post('/api/logout', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (token) {
            const payload = (0, token_crypto_1.decryptSession)(token);
            // Clean up cache and SSE
            (0, get_client_1.invalidateClient)(payload.clientKey);
            const sse = state_1.activeSSE.get(payload.clientKey);
            if (sse) {
                void Promise.resolve(sse.realtime?.disconnect?.()).catch(() => { });
                state_1.activeSSE.delete(payload.clientKey);
            }
        }
    }
    catch { /* token may be invalid, that's fine */ }
    res.json({ ok: true });
});
// ── Server-Sent Events ────────────────────────────────────────────────────────
app.get('/api/events', async (req, res) => {
    (0, logging_1.serverLog)('[SSE] New connection request');
    let client;
    let clientKey;
    try {
        const token = (0, get_client_1.extractToken)(req);
        const payload = (0, token_crypto_1.decryptSession)(token);
        clientKey = payload.clientKey;
        (0, logging_1.serverLog)(`[SSE] Token valid, clientKey: ${clientKey.slice(0, 8)}...`);
        client = await (0, get_client_1.getClient)(req);
    }
    catch (err) {
        (0, logging_1.serverLog)('[SSE] Authentication failed:', (0, logging_1.errorMessage)(err));
        res.status(401).end();
        return;
    }
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx response buffering for SSE
    res.flushHeaders();
    (0, logging_1.serverLog)(`[SSE] Headers sent for clientKey: ${clientKey.slice(0, 8)}...`);
    // Heartbeat every 25 s to keep the connection alive.
    // Use a named event (not a comment) so the client can detect it
    // for its watchdog timer. SSE comments (`: ...`) are invisible to
    // EventSource.addEventListener and cannot be used for liveness tracking.
    const hb = setInterval(() => {
        try {
            res.write('event: heartbeat\ndata: {}\n\n');
            if (typeof res.flush === 'function') {
                res.flush();
            }
            // Refresh client cache TTL while SSE connection is active
            (0, get_client_1.touchCachedClient)(clientKey);
        }
        catch {
            clearInterval(hb);
            try {
                res.end();
            }
            catch { }
        }
    }, 25_000);
    // Get or create SSE connection for this clientKey
    let conn = state_1.activeSSE.get(clientKey);
    const isNewConnection = !conn;
    if (!conn) {
        (0, logging_1.serverLog)(`[SSE] Creating new SSE connection for clientKey: ${clientKey.slice(0, 8)}...`);
        conn = { client, sseClients: new Set() };
        state_1.activeSSE.set(clientKey, conn);
    }
    conn.sseClients.add(res);
    (0, logging_1.serverLog)(`[SSE] Client added. Total SSE clients for this clientKey: ${conn.sseClients.size}`);
    // Send initial connected event so client knows stream is ready
    try {
        res.write(`event: connected\ndata: {}\n\n`);
        if (typeof res.flush === 'function') {
            res.flush();
        }
    }
    catch { /* ignore */ }
    // Connect realtime AFTER client is added so no events are missed
    if (isNewConnection) {
        connectRealtime(client, clientKey).catch((err) => {
            (0, logging_1.serverLog)(`[SSE] Failed to connect realtime for ${clientKey.slice(0, 8)}: ${(0, logging_1.errorMessage)(err)}`);
        });
    }
    req.on('close', () => {
        (0, logging_1.serverLog)(`[SSE] Client disconnected for clientKey: ${clientKey.slice(0, 8)}...`);
        clearInterval(hb);
        const c = state_1.activeSSE.get(clientKey);
        if (!c)
            return;
        c.sseClients.delete(res);
        (0, logging_1.serverLog)(`[SSE] Client removed. Remaining clients: ${c.sseClients.size}`);
        if (c.sseClients.size > 0)
            return;
        // Keine SSE-Clients mehr — aber Push-User dürfen die App schließen, ohne
        // dass wir ihre Realtime-Connection killen. Wir prüfen async, ob diese
        // Session FCM-Tokens hat: ja → Realtime weiter laufen lassen; nein →
        // Realtime trennen und Eintrag verwerfen.
        // Push-Tokens sind unter stashcatUserId indiziert, nicht unter clientKey.
        (0, token_store_1.listForUser)((0, state_1.getRoutingUserId)(clientKey))
            .then((tokens) => {
            const stillNoSseClients = (state_1.activeSSE.get(clientKey)?.sseClients.size ?? 0) === 0;
            if (!stillNoSseClients) {
                (0, logging_1.serverLog)(`[SSE] Re-checked clientKey ${clientKey.slice(0, 8)}: SSE-Client kam zurück, behalte Realtime.`);
                return;
            }
            if (tokens.length > 0) {
                (0, logging_1.serverLog)(`[SSE] Keeping realtime alive for clientKey ${clientKey.slice(0, 8)} (push delivery, ${tokens.length} token(s))`);
                return;
            }
            (0, logging_1.serverLog)(`[SSE] No SSE clients + no push tokens for clientKey: ${clientKey.slice(0, 8)} → disconnecting realtime`);
            c.realtime?.disconnect();
            state_1.activeSSE.delete(clientKey);
        })
            .catch((err) => {
            // Konservativ: Bei einem transienten Token-Store-I/O-Fehler die
            // Realtime-Connection NICHT killen — sonst verlieren Push-User
            // ihre Pipeline wegen eines kurzen Disk-Glitches. Lieber eine
            // Verbindung 10 Minuten "leaken", als 30 Minuten lang keine Pushes.
            (0, logging_1.serverLog)(`[SSE] Push-Token-Lookup für ${clientKey.slice(0, 8)} fehlgeschlagen — halte Realtime vorsorglich am Leben:`, (0, logging_1.errorMessage)(err));
        });
    });
});
// ── Typing ────────────────────────────────────────────────────────────────────
app.post('/api/typing', (req, res) => {
    try {
        const token = (0, get_client_1.extractToken)(req);
        const payload = (0, token_crypto_1.decryptSession)(token);
        const { type, targetId } = req.body;
        const conn = state_1.activeSSE.get(payload.clientKey);
        conn?.realtime?.sendTyping(type, targetId);
        res.json({ ok: true });
    }
    catch (err) {
        res.status(500).json({ error: (0, logging_1.errorMessage)(err) });
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
// Vorsicht beim Stashcat-Server hammern — wir restoren sequenziell mit
// 500 ms Pause zwischen den Sessions.
async function restoreRealtimeForBoot() {
    let records;
    try {
        records = await (0, mobile_auth_1.listAllMobileTokens)();
    }
    catch (err) {
        (0, logging_1.serverLog)('[Boot] listAllMobileTokens failed:', (0, logging_1.errorMessage)(err));
        return;
    }
    if (records.length === 0) {
        (0, logging_1.serverLog)('[Boot] No mobile tokens to restore — Realtime stays cold until first SSE connect.');
        return;
    }
    // Pro distinct sessionToken nur einmal restoren — ein User mit mehreren
    // Mobile-Geraeten teilt nicht zwingend denselben sessionToken (per Login
    // generiert), aber zwei Mobile-Tokens, die zum selben sessionToken zeigen,
    // sind moeglich wenn der User die App reinstalliert hat.
    const seenSessionTokens = new Set();
    (0, logging_1.serverLog)(`[Boot] Restoring Realtime for ${records.length} mobile session(s)…`);
    for (const record of records) {
        if (seenSessionTokens.has(record.sessionToken))
            continue;
        seenSessionTokens.add(record.sessionToken);
        let clientKey;
        try {
            const payload = (0, token_crypto_1.decryptSession)(record.sessionToken);
            clientKey = payload.clientKey;
        }
        catch (err) {
            (0, logging_1.serverLog)('[Boot] Skipping mobile token — session decrypt failed (SESSION_SECRET geaendert?):', (0, logging_1.errorMessage)(err));
            continue;
        }
        if (state_1.activeSSE.has(clientKey)) {
            // Schon restored (z.B. doppelter mobile-token auf selben sessionToken)
            continue;
        }
        try {
            const fakeReq = { headers: { authorization: `Bearer ${record.sessionToken}` }, query: {} };
            const client = await (0, get_client_1.getClient)(fakeReq);
            state_1.activeSSE.set(clientKey, { client, sseClients: new Set() });
            (0, logging_1.serverLog)(`[Boot] Starting Realtime for clientKey ${clientKey.slice(0, 8)}…`);
            // Fire-and-forget — wir warten nicht auf jeden einzelnen Connect, der
            // 15-s-Auth-Timeout wuerde sonst den Boot blockieren.
            connectRealtime(client, clientKey).catch((err) => {
                (0, logging_1.serverLog)(`[Boot] Realtime restore failed for ${clientKey.slice(0, 8)}:`, (0, logging_1.errorMessage)(err));
                state_1.activeSSE.delete(clientKey);
            });
            // Sanftes Pacing — Stashcat-Server nicht mit gleichzeitigen Connects
            // beballern, falls viele Mobile-Sessions persistiert sind.
            await new Promise((r) => setTimeout(r, 500));
        }
        catch (err) {
            (0, logging_1.serverLog)(`[Boot] getClient failed for clientKey ${clientKey.slice(0, 8)} — Session abgelaufen?`, (0, logging_1.errorMessage)(err));
        }
    }
    (0, logging_1.serverLog)(`[Boot] Realtime restore pass done (${seenSessionTokens.size} unique session(s)).`);
}
// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = Number(process.env.PORT) || 3001;
app.listen(PORT, () => {
    console.log(`BBZ Chat backend running on http://localhost:${PORT}`);
    // Asynchron — soll den Listener nicht blockieren.
    void restoreRealtimeForBoot();
});
