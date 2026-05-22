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
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';

const ROOT = process.cwd();
const STORE_PATH = path.join(ROOT, '.mobile-tokens.json');
const KEY_PATH = path.join(ROOT, '.session-secret'); // reuse the same key file as session-store

const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days sliding window

export type PushPreviewMode = 'full' | 'silent';

export interface MobileTokenRecord {
  sessionToken: string;
  userId: string;
  createdAt: number;
  lastSeenAt: number;
  pushPreviewMode: PushPreviewMode;
}

interface StoredEntry {
  iv: string;
  ciphertext: string;
  authTag: string;
}

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
    const hex = (await readFile(KEY_PATH, 'utf8')).trim();
    return Buffer.from(hex, 'hex');
  }
  const key = randomBytes(32);
  await writeFile(KEY_PATH, key.toString('hex'), { mode: 0o600 });
  return key;
}

function encrypt(plaintext: string, key: Buffer): StoredEntry {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('hex'),
    ciphertext: ct.toString('hex'),
    authTag: cipher.getAuthTag().toString('hex'),
  };
}

function decrypt(entry: StoredEntry, key: Buffer): string {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(entry.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(entry.authTag, 'hex'));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(entry.ciphertext, 'hex')),
    decipher.final(),
  ]);
  return plain.toString('utf8');
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

export function generateMobileToken(): string {
  return randomBytes(32).toString('hex');
}

export async function saveMobileToken(token: string, record: MobileTokenRecord): Promise<void> {
  return withFileLock(async () => {
    try {
      const key = await getKey();
      const store = await loadFile();
      store[token] = encrypt(JSON.stringify(record), key);
      await saveFile(store);
    } catch (err) {
      console.warn('[MobileAuth] saveMobileToken failed:', (err as Error).message);
    }
  });
}

export async function loadMobileToken(token: string): Promise<MobileTokenRecord | null> {
  return withFileLock(async () => {
    try {
      const key = await getKey();
      const store = await loadFile();
      const entry = store[token];
      if (!entry) return null;
      const record = JSON.parse(decrypt(entry, key)) as MobileTokenRecord;
      // TTL check
      if (Date.now() - record.lastSeenAt > TTL_MS) {
        delete store[token];
        await saveFile(store);
        return null;
      }
      return record;
    } catch (err) {
      console.warn('[MobileAuth] loadMobileToken failed:', (err as Error).message);
      return null;
    }
  });
}

export async function touchMobileToken(token: string): Promise<MobileTokenRecord | null> {
  return withFileLock(async () => {
    try {
      const key = await getKey();
      const store = await loadFile();
      const entry = store[token];
      if (!entry) return null;
      const record = JSON.parse(decrypt(entry, key)) as MobileTokenRecord;
      if (Date.now() - record.lastSeenAt > TTL_MS) {
        delete store[token];
        await saveFile(store);
        return null;
      }
      record.lastSeenAt = Date.now();
      store[token] = encrypt(JSON.stringify(record), key);
      await saveFile(store);
      return record;
    } catch {
      return null;
    }
  });
}

export async function deleteMobileToken(token: string): Promise<void> {
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

export async function updatePushPreview(token: string, mode: PushPreviewMode): Promise<void> {
  return withFileLock(async () => {
    try {
      const key = await getKey();
      const store = await loadFile();
      const entry = store[token];
      if (!entry) return;
      const record = JSON.parse(decrypt(entry, key)) as MobileTokenRecord;
      record.pushPreviewMode = mode;
      record.lastSeenAt = Date.now();
      store[token] = encrypt(JSON.stringify(record), key);
      await saveFile(store);
    } catch { /* noop */ }
  });
}

/** List all mobile tokens for a given userId (for fan-out push). */
export async function listMobileTokensForUser(userId: string): Promise<MobileTokenRecord[]> {
  return withFileLock(async () => {
    try {
      const key = await getKey();
      const store = await loadFile();
      const results: MobileTokenRecord[] = [];
      for (const entry of Object.values(store)) {
        try {
          const rec = JSON.parse(decrypt(entry, key)) as MobileTokenRecord;
          if (rec.userId === userId) results.push(rec);
        } catch { /* skip */ }
      }
      return results;
    } catch {
      return [];
    }
  });
}

/**
 * List ALL mobile tokens. Used on boot to reinstate Realtime connections for
 * every persisted mobile session — without this, pushes go silent after a
 * Passenger/Plesk restart until a desktop tab reconnects.
 *
 * Pro Eintrag erlaubt nicht abgelaufene Sessions; abgelaufene werden hier
 * implizit ausgesiebt (kein TTL-Refresh, nur Filter).
 */
export async function listAllMobileTokens(): Promise<MobileTokenRecord[]> {
  return withFileLock(async () => {
    try {
      const key = await getKey();
      const store = await loadFile();
      const now = Date.now();
      const results: MobileTokenRecord[] = [];
      for (const entry of Object.values(store)) {
        try {
          const rec = JSON.parse(decrypt(entry, key)) as MobileTokenRecord;
          if (now - rec.lastSeenAt > TTL_MS) continue;
          results.push(rec);
        } catch { /* skip */ }
      }
      return results;
    } catch {
      return [];
    }
  });
}

/** Helper: extract mobile token from Authorization header. */
export function extractMobileToken(req: { headers: Record<string, string | string[] | undefined> }): string | null {
  const auth = req.headers['authorization'];
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) return auth.slice('Bearer '.length);
  return null;
}
