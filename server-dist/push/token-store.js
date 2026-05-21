"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.upsertToken = upsertToken;
exports.removeToken = removeToken;
exports.listForUser = listForUser;
exports.pruneOlderThan = pruneOlderThan;
/**
 * AES-256-GCM encrypted persistence for FCM push tokens.
 *
 * One row per (userId, fcm-token) tuple. We index by token so device
 * re-registrations cleanly upsert; the userId lives inside the encrypted blob.
 *
 * File: `.push-tokens.json` in the project root, mode 0o600.
 */
const crypto_1 = require("crypto");
const promises_1 = require("fs/promises");
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const ROOT = process.cwd();
const STORE_PATH = path_1.default.join(ROOT, '.push-tokens.json');
const KEY_PATH = path_1.default.join(ROOT, '.session-secret');
let fileLock = Promise.resolve();
function withFileLock(fn) {
    const prev = fileLock;
    let resolve;
    fileLock = new Promise((r) => { resolve = r; });
    return prev.then(fn).finally(() => resolve());
}
async function getKey() {
    if ((0, fs_1.existsSync)(KEY_PATH)) {
        return Buffer.from((await (0, promises_1.readFile)(KEY_PATH, 'utf8')).trim(), 'hex');
    }
    const key = (0, crypto_1.randomBytes)(32);
    await (0, promises_1.writeFile)(KEY_PATH, key.toString('hex'), { mode: 0o600 });
    return key;
}
function encrypt(plaintext, key) {
    const iv = (0, crypto_1.randomBytes)(12);
    const cipher = (0, crypto_1.createCipheriv)('aes-256-gcm', key, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return { iv: iv.toString('hex'), ciphertext: ct.toString('hex'), authTag: cipher.getAuthTag().toString('hex') };
}
function decrypt(entry, key) {
    const decipher = (0, crypto_1.createDecipheriv)('aes-256-gcm', key, Buffer.from(entry.iv, 'hex'));
    decipher.setAuthTag(Buffer.from(entry.authTag, 'hex'));
    return Buffer.concat([
        decipher.update(Buffer.from(entry.ciphertext, 'hex')),
        decipher.final(),
    ]).toString('utf8');
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
async function upsertToken(record) {
    return withFileLock(async () => {
        try {
            const key = await getKey();
            const store = await loadFile();
            store[record.token] = encrypt(JSON.stringify({ ...record, lastSeenAt: Date.now() }), key);
            await saveFile(store);
        }
        catch (err) {
            console.warn('[PushStore] upsert failed:', err.message);
        }
    });
}
async function removeToken(token) {
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
async function listForUser(userId) {
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
/** Prune entries older than `ttlMs` (best-effort cleanup). */
async function pruneOlderThan(ttlMs) {
    return withFileLock(async () => {
        try {
            const key = await getKey();
            const store = await loadFile();
            let removed = 0;
            const now = Date.now();
            for (const [token, entry] of Object.entries(store)) {
                try {
                    const rec = JSON.parse(decrypt(entry, key));
                    if (now - rec.lastSeenAt > ttlMs) {
                        delete store[token];
                        removed += 1;
                    }
                }
                catch {
                    delete store[token];
                    removed += 1;
                }
            }
            if (removed > 0)
                await saveFile(store);
            return removed;
        }
        catch {
            return 0;
        }
    });
}
