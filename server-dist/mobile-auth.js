"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateMobileToken = generateMobileToken;
exports.saveMobileToken = saveMobileToken;
exports.loadMobileToken = loadMobileToken;
exports.touchMobileToken = touchMobileToken;
exports.deleteMobileToken = deleteMobileToken;
exports.updatePushPreview = updatePushPreview;
exports.listMobileTokensForUser = listMobileTokensForUser;
exports.extractMobileToken = extractMobileToken;
/**
 * Mobile-token store + helpers.
 *
 * The Flutter shell logs in once via `/api/auth/mobile-login` (full credentials
 * including the E2E security password). The server returns a long-lived
 * `mobileToken` plus the regular session token. On every cold start the Flutter
 * shell calls `/api/auth/mobile-session` with the `mobileToken` to get a fresh
 * session token without re-prompting the user.
 *
 * Storage: AES-256-GCM encrypted `.mobile-tokens.json`, identical pattern to
 * `session-store.ts`. The mobile token itself is the lookup key; the encrypted
 * blob holds `sessionToken`, `userId`, timestamps, and per-device push prefs.
 */
const crypto_1 = require("crypto");
const promises_1 = require("fs/promises");
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const ROOT = process.cwd();
const STORE_PATH = path_1.default.join(ROOT, '.mobile-tokens.json');
const KEY_PATH = path_1.default.join(ROOT, '.session-secret'); // reuse the same key file as session-store
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days sliding window
let fileLock = Promise.resolve();
function withFileLock(fn) {
    const prev = fileLock;
    let resolve;
    fileLock = new Promise((r) => { resolve = r; });
    return prev.then(fn).finally(() => resolve());
}
async function getKey() {
    if ((0, fs_1.existsSync)(KEY_PATH)) {
        const hex = (await (0, promises_1.readFile)(KEY_PATH, 'utf8')).trim();
        return Buffer.from(hex, 'hex');
    }
    const key = (0, crypto_1.randomBytes)(32);
    await (0, promises_1.writeFile)(KEY_PATH, key.toString('hex'), { mode: 0o600 });
    return key;
}
function encrypt(plaintext, key) {
    const iv = (0, crypto_1.randomBytes)(12);
    const cipher = (0, crypto_1.createCipheriv)('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return {
        iv: iv.toString('hex'),
        ciphertext: ct.toString('hex'),
        authTag: cipher.getAuthTag().toString('hex'),
    };
}
function decrypt(entry, key) {
    const decipher = (0, crypto_1.createDecipheriv)('aes-256-gcm', key, Buffer.from(entry.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(entry.authTag, 'hex'));
    const plain = Buffer.concat([
        decipher.update(Buffer.from(entry.ciphertext, 'hex')),
        decipher.final(),
    ]);
    return plain.toString('utf8');
}
async function loadFile() {
    try {
        return JSON.parse(await (0, promises_1.readFile)(STORE_PATH, 'utf8'));
    }
    catch {
        return {};
    }
}
async function saveFile(data) {
    await (0, promises_1.writeFile)(STORE_PATH, JSON.stringify(data, null, 2), { mode: 0o600 });
}
function generateMobileToken() {
    return (0, crypto_1.randomBytes)(32).toString('hex');
}
async function saveMobileToken(token, record) {
    return withFileLock(async () => {
        try {
            const key = await getKey();
            const store = await loadFile();
            store[token] = encrypt(JSON.stringify(record), key);
            await saveFile(store);
        }
        catch (err) {
            console.warn('[MobileAuth] saveMobileToken failed:', err.message);
        }
    });
}
async function loadMobileToken(token) {
    return withFileLock(async () => {
        try {
            const key = await getKey();
            const store = await loadFile();
            const entry = store[token];
            if (!entry)
                return null;
            const record = JSON.parse(decrypt(entry, key));
            // TTL check
            if (Date.now() - record.lastSeenAt > TTL_MS) {
                delete store[token];
                await saveFile(store);
                return null;
            }
            return record;
        }
        catch (err) {
            console.warn('[MobileAuth] loadMobileToken failed:', err.message);
            return null;
        }
    });
}
async function touchMobileToken(token) {
    return withFileLock(async () => {
        try {
            const key = await getKey();
            const store = await loadFile();
            const entry = store[token];
            if (!entry)
                return null;
            const record = JSON.parse(decrypt(entry, key));
            if (Date.now() - record.lastSeenAt > TTL_MS) {
                delete store[token];
                await saveFile(store);
                return null;
            }
            record.lastSeenAt = Date.now();
            store[token] = encrypt(JSON.stringify(record), key);
            await saveFile(store);
            return record;
        }
        catch {
            return null;
        }
    });
}
async function deleteMobileToken(token) {
    return withFileLock(async () => {
        try {
            const store = await loadFile();
            if (token in store) {
                delete store[token];
                await saveFile(store);
            }
        }
        catch { /* noop */ }
    });
}
async function updatePushPreview(token, mode) {
    return withFileLock(async () => {
        try {
            const key = await getKey();
            const store = await loadFile();
            const entry = store[token];
            if (!entry)
                return;
            const record = JSON.parse(decrypt(entry, key));
            record.pushPreviewMode = mode;
            record.lastSeenAt = Date.now();
            store[token] = encrypt(JSON.stringify(record), key);
            await saveFile(store);
        }
        catch { /* noop */ }
    });
}
/** List all mobile tokens for a given userId (for fan-out push). */
async function listMobileTokensForUser(userId) {
    return withFileLock(async () => {
        try {
            const key = await getKey();
            const store = await loadFile();
            const results = [];
            for (const entry of Object.values(store)) {
                try {
                    const rec = JSON.parse(decrypt(entry, key));
                    if (rec.userId === userId)
                        results.push(rec);
                }
                catch { /* skip */ }
            }
            return results;
        }
        catch {
            return [];
        }
    });
}
/** Helper: extract mobile token from Authorization header. */
function extractMobileToken(req) {
    const auth = req.headers['authorization'];
    if (typeof auth === 'string' && auth.startsWith('Bearer '))
        return auth.slice('Bearer '.length);
    return null;
}
