"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.describeFcmConfig = describeFcmConfig;
exports.isFcmConfigured = isFcmConfigured;
exports.sendFcm = sendFcm;
/**
 * Minimal FCM HTTP v1 client.
 *
 * Reads a Google service-account JSON file (path in env `FCM_SERVICE_ACCOUNT`),
 * mints a short-lived OAuth access token via the standard signed-JWT bearer
 * flow, and posts FCM messages to
 *   https://fcm.googleapis.com/v1/projects/<id>/messages:send
 *
 * We deliberately avoid `firebase-admin` — it pulls a huge dep tree for the
 * trivial subset we need.
 */
const fs_1 = require("fs");
const jsonwebtoken_1 = require("jsonwebtoken");
const path_1 = __importDefault(require("path"));
const SERVICE_ACCOUNT_PATH = process.env.FCM_SERVICE_ACCOUNT || '';
const PUSH_ERROR_LOG = path_1.default.join(process.cwd(), '.push-errors.log');
let serviceAccount = null;
let accessToken = null;
function loadServiceAccount() {
    if (serviceAccount)
        return serviceAccount;
    if (!SERVICE_ACCOUNT_PATH || !(0, fs_1.existsSync)(SERVICE_ACCOUNT_PATH))
        return null;
    try {
        serviceAccount = JSON.parse((0, fs_1.readFileSync)(SERVICE_ACCOUNT_PATH, 'utf8'));
        return serviceAccount;
    }
    catch (err) {
        console.warn('[FCM] Failed to read service account:', err.message);
        return null;
    }
}
function describeFcmConfig() {
    if (process.env.PUSH_ENABLED === 'false')
        return { ok: false, reason: 'disabled' };
    if (!SERVICE_ACCOUNT_PATH)
        return { ok: false, reason: 'env-missing' };
    if (!(0, fs_1.existsSync)(SERVICE_ACCOUNT_PATH)) {
        return { ok: false, reason: 'file-missing', path: SERVICE_ACCOUNT_PATH };
    }
    try {
        JSON.parse((0, fs_1.readFileSync)(SERVICE_ACCOUNT_PATH, 'utf8'));
        return { ok: true };
    }
    catch (err) {
        return {
            ok: false,
            reason: 'file-unreadable',
            path: SERVICE_ACCOUNT_PATH,
            error: err.message,
        };
    }
}
function isFcmConfigured() {
    return loadServiceAccount() !== null && process.env.PUSH_ENABLED !== 'false';
}
function logError(msg) {
    try {
        (0, fs_1.appendFileSync)(PUSH_ERROR_LOG, `[${new Date().toISOString()}] ${msg}\n`);
    }
    catch { /* noop */ }
    console.warn('[FCM]', msg);
}
async function getAccessToken() {
    if (accessToken && accessToken.expiresAt > Date.now() + 60_000) {
        return accessToken.value;
    }
    const sa = loadServiceAccount();
    if (!sa)
        return null;
    const now = Math.floor(Date.now() / 1000);
    const jwt = (0, jsonwebtoken_1.sign)({
        iss: sa.client_email,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: sa.token_uri || 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
    }, sa.private_key, { algorithm: 'RS256' });
    try {
        const res = await fetch(sa.token_uri || 'https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
                assertion: jwt,
            }).toString(),
        });
        if (!res.ok) {
            logError(`OAuth token request failed: ${res.status} ${await res.text().catch(() => '')}`);
            return null;
        }
        const json = (await res.json());
        if (!json.access_token)
            return null;
        accessToken = {
            value: json.access_token,
            expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000,
        };
        return accessToken.value;
    }
    catch (err) {
        logError(`OAuth fetch failed: ${err.message}`);
        return null;
    }
}
// 24 Stunden TTL — FCM hält die Nachricht für offline Devices länger vor.
// Default ist 4 Wochen, aber wir wollen alte Backlogs nicht durchspielen
// (User loggt sich nach 1 Woche Urlaub ein → keine 100 alten Banner).
const TTL_SECONDS = 24 * 60 * 60;
function buildPayload(input) {
    const data = { ...(input.data ?? {}) };
    // Always include title/body in data so Android can render the banner from
    // data-only messages (high priority, works when app is killed).
    // Defensive defaults — FCM weigert sich, JSON mit `undefined`-Werten zu
    // akzeptieren, und Flutter würde sonst leeren Banner-Title sehen.
    data.title = input.title || 'Neue Nachricht';
    data.body = input.silent ? '' : (input.body || '');
    // Marker, damit Flutter im Background-Handler entscheiden kann, ob es
    // selbst eine Local-Notification anzeigen muss oder die System-Notification
    // (notification-Block) schon angezeigt wurde.
    data.hasNotification = 'true';
    const title = input.title || 'Neue Nachricht';
    const body = input.silent ? '' : (input.body || '');
    // Per-Chat collapseKey, damit aufeinanderfolgende Nachrichten im selben
    // Chat/Channel den vorherigen Banner-Eintrag ersetzen (statt zu stapeln),
    // verschiedene Chats aber jeweils eine eigene Notification haben.
    // Fallback `'bbz-chat-msg'` falls aus irgendeinem Grund kein Key kommt.
    const collapseKey = input.collapseKey || 'bbz-chat-msg';
    if (input.platform === 'ios') {
        // iOS: notification-Block sorgt für Lockscreen-Rendering. APNs hält das
        // bei Offline-Devices länger vor als reine data-only-Pushes.
        const expirationSeconds = Math.floor(Date.now() / 1000) + TTL_SECONDS;
        return {
            token: input.token,
            notification: { title, body },
            apns: {
                headers: {
                    'apns-priority': '10',
                    'apns-expiration': String(expirationSeconds),
                    // Ersetzt eine vorhandene Notification mit derselben collapse-id im
                    // Notification-Center, statt sie zu stapeln.
                    'apns-collapse-id': collapseKey,
                },
                payload: {
                    aps: {
                        'mutable-content': 1,
                        sound: 'default',
                        // thread-id gruppiert Notifications visuell pro Chat (iOS 12+):
                        // im Notification-Center werden alle Nachrichten desselben Chats
                        // aufgeklappt in eine Gruppe gepackt.
                        'thread-id': collapseKey,
                        ...(typeof input.badge === 'number' ? { badge: input.badge } : {}),
                    },
                },
            },
            data,
        };
    }
    // Android: hybrid notification + data.
    // - System rendert das Banner aus dem notification-Block (zuverlässig auch
    //   nach längerer Offline-Zeit, weil FCM notification-Payloads länger hält
    //   als data-only).
    // - data enthält die strukturierten Felder (deeplink, channelName, …) und
    //   einen `hasNotification`-Marker, damit Flutter weiß: System rendert das
    //   schon — nicht zusätzlich eine Local-Notification rendern, sonst Doppel-
    //   Banner.
    // - android.ttl: 24h, damit Pushs nach Flugmodus / längerer Offline-Phase
    //   noch zugestellt werden, statt von FCM verworfen zu werden.
    return {
        token: input.token,
        notification: { title, body },
        android: {
            priority: 'HIGH',
            ttl: `${TTL_SECONDS}s`,
            // collapse_key reduziert die Anzahl der zugestellten Pushs im selben
            // Chat, falls das Device länger offline war (Doc: "android.collapse_key").
            collapse_key: collapseKey,
            notification: {
                // tag: aufeinanderfolgende Pushs im selben Chat ersetzen einander
                // im Notification-Drawer. Verschiedene Chats → verschiedene Tags
                // → eigene Notifications.
                tag: collapseKey,
            },
        },
        data,
    };
}
async function sendFcm(input) {
    if (!isFcmConfigured())
        return false;
    const sa = loadServiceAccount();
    const token = await getAccessToken();
    if (!sa || !token)
        return false;
    const url = `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`;
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ message: buildPayload(input) }),
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            logError(`FCM send failed (${res.status}) for token ${input.token.slice(0, 12)}…: ${text.slice(0, 400)}`);
            return false;
        }
        console.log(`[FCM] sent ${input.platform} → token ${input.token.slice(0, 12)}… ("${input.title}")`);
        return true;
    }
    catch (err) {
        logError(`FCM send threw: ${err.message}`);
        return false;
    }
}
