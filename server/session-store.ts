/**
 * Persistent session store with AES-256-GCM encryption.
 *
 * Stores serialized StashcatClient sessions + encrypted security passwords
 * in a local JSON file so sessions survive server restarts.
 *
 * Two files are created in the project root (excluded from git):
 *   .session-secret  — 32-byte random encryption key (hex)
 *   .sessions.json   — encrypted session data
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import type { SerializedSession } from 'stashcat-api';

const ROOT = process.cwd();
const STORE_PATH = path.join(ROOT, '.sessions.json');
const KEY_PATH = path.join(ROOT, '.session-secret');

interface StoredEntry {
  serialized: SerializedSession;
  iv: string;
  encryptedSecurityPassword: string;
  authTag: string;
  savedAt: number;
}

type StoreFile = Record<string, StoredEntry>;

// ── Encryption key ─────────────────────────────────────────────────────────

async function getOrCreateKey(): Promise<Buffer> {
  if (existsSync(KEY_PATH)) {
    const hex = (await readFile(KEY_PATH, 'utf8')).trim();
    return Buffer.from(hex, 'hex');
  }
  const key = randomBytes(32);
  // mode 0o600 = owner read/write only (best-effort on Windows)
  await writeFile(KEY_PATH, key.toString('hex'), { mode: 0o600 });
  console.log('[SessionStore] Created new encryption key at', KEY_PATH);
  return key;
}

// ── AES-256-GCM helpers ────────────────────────────────────────────────────

function encrypt(plaintext: string, key: Buffer): { iv: string; ciphertext: string; authTag: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('hex'),
    ciphertext: ciphertext.toString('hex'),
    authTag: cipher.getAuthTag().toString('hex'),
  };
}

function decrypt(iv: string, ciphertext: string, authTag: string, key: Buffer): string {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'hex'));
  decipher.setAuthTag(Buffer.from(authTag, 'hex'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'hex')),
    decipher.final(),
  ]).toString('utf8');
}

// ── File I/O ───────────────────────────────────────────────────────────────

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

// ── Public API ─────────────────────────────────────────────────────────────

/** Save a session to disk (overwrites existing entry for this token). */
export async function saveSession(
  token: string,
  serialized: SerializedSession,
  securityPassword: string,
): Promise<void> {
  try {
    const key = await getOrCreateKey();
    const enc = encrypt(securityPassword, key);
    const store = await loadFile();
    store[token] = {
      serialized,
      iv: enc.iv,
      encryptedSecurityPassword: enc.ciphertext,
      authTag: enc.authTag,
      savedAt: Date.now(),
    };
    await saveFile(store);
  } catch (err) {
    console.warn('[SessionStore] Failed to save session:', (err as Error).message);
  }
}

/** Load and decrypt all stored sessions. */
export async function loadSessions(): Promise<
  Array<{ token: string; serialized: SerializedSession; securityPassword: string }>
> {
  try {
    const key = await getOrCreateKey();
    const store = await loadFile();
    const results: Array<{ token: string; serialized: SerializedSession; securityPassword: string }> = [];

    for (const [token, entry] of Object.entries(store)) {
      try {
        const securityPassword = decrypt(entry.iv, entry.encryptedSecurityPassword, entry.authTag, key);
        results.push({ token, serialized: entry.serialized, securityPassword });
      } catch {
        console.warn(`[SessionStore] Could not decrypt session ${token.slice(0, 8)}… — skipping`);
      }
    }
    return results;
  } catch (err) {
    console.warn('[SessionStore] Failed to load sessions:', (err as Error).message);
    return [];
  }
}

/** Remove a session from disk. */
export async function deleteSession(token: string): Promise<void> {
  try {
    const store = await loadFile();
    if (token in store) {
      delete store[token];
      await saveFile(store);
    }
  } catch (err) {
    console.warn('[SessionStore] Failed to delete session:', (err as Error).message);
  }
}
