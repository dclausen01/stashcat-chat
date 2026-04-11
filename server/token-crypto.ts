/**
 * Stateless session token encryption using AES-256-GCM.
 *
 * The encrypted token IS the session — no server-side session store needed.
 * The browser holds the token; the server decrypts it on each request.
 *
 * Key source: SESSION_SECRET env var (hex-encoded 32 bytes) or random key
 * generated at startup (sessions won't survive restart — that's OK and more secure).
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import type { RsaPrivateKeyJwk } from 'stashcat-api';

const SESSION_KEY = process.env.SESSION_SECRET
  ? Buffer.from(process.env.SESSION_SECRET, 'hex')
  : randomBytes(32);

if (!process.env.SESSION_SECRET) {
  console.log('[TokenCrypto] No SESSION_SECRET env var — using ephemeral key (sessions won\'t survive restart)');
}

export interface SessionPayload {
  deviceId: string;
  clientKey: string;
  baseUrl: string;
  securityPassword?: string;     // Legacy-Flow (Passwort-Login)
  privateKeyJwk?: RsaPrivateKeyJwk;    // Device-Flow (Geräte-Login)
}

export function encryptSession(payload: SessionPayload): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', SESSION_KEY, iv);
  const ct = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // Format: iv:ciphertext:authTag (all hex)
  return `${iv.toString('hex')}:${ct.toString('hex')}:${tag.toString('hex')}`;
}

export function decryptSession(token: string): SessionPayload {
  const [ivHex, ctHex, tagHex] = token.split(':');
  if (!ivHex || !ctHex || !tagHex) throw new Error('Invalid token format');
  const decipher = createDecipheriv('aes-256-gcm', SESSION_KEY, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const plain = Buffer.concat([decipher.update(Buffer.from(ctHex, 'hex')), decipher.final()]);
  return JSON.parse(plain.toString('utf8'));
}
