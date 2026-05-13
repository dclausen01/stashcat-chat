/**
 * AES-256-GCM encrypted persistence for FCM push tokens.
 *
 * One row per (userId, fcm-token) tuple. We index by token so device
 * re-registrations cleanly upsert; the userId lives inside the encrypted blob.
 *
 * File: `.push-tokens.json` in the project root, mode 0o600.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const ROOT = process.cwd();
const STORE_PATH = path.join(ROOT, '.push-tokens.json');
const KEY_PATH = path.join(ROOT, '.session-secret');

export type Platform = 'android' | 'ios';

export interface PushTokenRecord {
  token: string;
  userId: string;
  platform: Platform;
  appVersion?: string;
  locale?: string;
  createdAt: number;
  lastSeenAt: number;
}

interface StoredEntry { iv: string; ciphertext: string; authTag: string }
type StoreFile = Record<string, StoredEntry>;

let fileLock: Promise<void> = Promise.resolve();
function withFileLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = fileLock;
  let resolve: () => void;
  fileLock = new Promise<void>((r) => { resolve = r; });
  return prev.then(fn).finally(() => resolve!());
}

async function getKey(): Promise<Buffer> {
  if (existsSync(KEY_PATH)) {
    return Buffer.from((await readFile(KEY_PATH, 'utf8')).trim(), 'hex');
  }
  const key = randomBytes(32);
  await writeFile(KEY_PATH, key.toString('hex'), { mode: 0o600 });
  return key;
}

function encrypt(plaintext: string, key: Buffer): StoredEntry {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return { iv: iv.toString('hex'), ciphertext: ct.toString('hex'), authTag: cipher.getAuthTag().toString('hex') };
}

function decrypt(entry: StoredEntry, key: Buffer): string {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(entry.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(entry.authTag, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(entry.ciphertext, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}

async function loadFile(): Promise<StoreFile> {
  try {
    return JSON.parse(await readFile(STORE_PATH, 'utf8')) as StoreFile;
  } catch {
    return {};
  }
}

async function saveFile(data: StoreFile): Promise<void> {
  await writeFile(STORE_PATH, JSON.stringify(data, null, 2), { mode: 0o600 });
}

export async function upsertToken(record: PushTokenRecord): Promise<void> {
  return withFileLock(async () => {
    try {
      const key = await getKey();
      const store = await loadFile();
      store[record.token] = encrypt(JSON.stringify({ ...record, lastSeenAt: Date.now() }), key);
      await saveFile(store);
    } catch (err) {
      console.warn('[PushStore] upsert failed:', (err as Error).message);
    }
  });
}

export async function removeToken(token: string): Promise<void> {
  return withFileLock(async () => {
    try {
      const store = await loadFile();
      if (token in store) {
        delete store[token];
        await saveFile(store);
      }
    } catch { /* noop */ }
  });
}

export async function listForUser(userId: string): Promise<PushTokenRecord[]> {
  return withFileLock(async () => {
    try {
      const key = await getKey();
      const store = await loadFile();
      const results: PushTokenRecord[] = [];
      for (const entry of Object.values(store)) {
        try {
          const rec = JSON.parse(decrypt(entry, key)) as PushTokenRecord;
          if (rec.userId === userId) results.push(rec);
        } catch { /* skip */ }
      }
      return results;
    } catch {
      return [];
    }
  });
}

/** Prune entries older than `ttlMs` (best-effort cleanup). */
export async function pruneOlderThan(ttlMs: number): Promise<number> {
  return withFileLock(async () => {
    try {
      const key = await getKey();
      const store = await loadFile();
      let removed = 0;
      const now = Date.now();
      for (const [token, entry] of Object.entries(store)) {
        try {
          const rec = JSON.parse(decrypt(entry, key)) as PushTokenRecord;
          if (now - rec.lastSeenAt > ttlMs) {
            delete store[token];
            removed += 1;
          }
        } catch {
          delete store[token];
          removed += 1;
        }
      }
      if (removed > 0) await saveFile(store);
      return removed;
    } catch {
      return 0;
    }
  });
}
