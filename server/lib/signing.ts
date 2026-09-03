import crypto from 'node:crypto';
import type { StashcatClient } from 'stashcat-api';
import { serverLog } from './logging';

/**
 * Signierung von Chat-Schluesseln.
 *
 * Stashcat haelt pro Nutzer **zwei** RSA-4096-Schluesselpaare: eines zum
 * Verschluesseln (RSA-OAEP) und eines zum Signieren (RSASSA-PKCS1-v1_5 /
 * RS256). `stashcat-api` kennt nur das erste — `client.signData()` signiert
 * also mit dem Verschluesselungsschluessel, und die Signatur laesst sich gegen
 * `public_signing_key` nicht pruefen.
 *
 * Dieses Modul beschafft den privaten Signierschluessel und baut die
 * Zeichenkette nach, die der offizielle Webclient signiert. Details und
 * Herleitung: `docs/signing-keys.md`.
 */

/** Wie `/security/get_private_key` den Signierschluessel ablegt. */
interface EncryptedSigningKey {
  ciphertext: string;      // base64, AES-256-CBC
  iv: string;              // base64
  encryptedKEK: string;    // base64, RSA-OAEP an den eigenen Verschluesselungsschluessel
  encryption_func: string; // immer "aes-256-cbc"
}

interface GetPrivateKeyPayload {
  keys?: {
    type?: string;
    format?: string;
    public_key?: string;
    private_key?: string; // JSON-String
  } | null;
}

/**
 * Signierschluessel je Client-Instanz. WeakMap, damit das Schluesselmaterial
 * mit der Session verschwindet und nicht in einer prozessweiten Map haengen
 * bleibt. `null` = bereits geprueft, Nutzer hat keinen Signierschluessel.
 */
const signingKeyCache = new WeakMap<object, crypto.KeyObject | null>();

/** JWK fuer `crypto.createPrivateKey` aufbereiten (WebCrypto-Felder stoeren). */
function toNodeJwk(jwk: Record<string, unknown>): crypto.JsonWebKey {
  const rest = { ...jwk };
  delete rest.alg;
  delete rest.key_ops;
  delete rest.ext;
  return rest as crypto.JsonWebKey;
}

/**
 * Entpackt den privaten Signierschluessel.
 *
 * Der Webclient legt ihn doppelt verpackt ab (`encryptRSAPrivateKeyAsJWKWithPublicKey`):
 * ein zufaelliger AES-256-Schluessel (KEK) verschluesselt das JWK per AES-256-CBC,
 * und der KEK selbst ist per RSA-OAEP an den **eigenen Verschluesselungs-Public-Key**
 * verschluesselt. Der private Verschluesselungsschluessel liegt uns nach dem
 * E2E-Unlock vor — damit ist die Kette serverseitig nachvollziehbar.
 *
 * Wichtig: WebCrypto importiert den Verschluesselungsschluessel mit
 * `hash: "SHA-1"`, das OAEP-Padding nutzt also SHA-1 (Nodes Default).
 */
function unwrapSigningKey(encrypted: EncryptedSigningKey, encPrivateKey: crypto.KeyObject): crypto.KeyObject {
  if (encrypted.encryption_func !== 'aes-256-cbc') {
    throw new Error(`Unbekannte Verschluesselungsfunktion "${encrypted.encryption_func}"`);
  }

  const kek = crypto.privateDecrypt(
    { key: encPrivateKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' },
    Buffer.from(encrypted.encryptedKEK, 'base64'),
  );

  const decipher = crypto.createDecipheriv('aes-256-cbc', kek, Buffer.from(encrypted.iv, 'base64'));
  const jwkJson = Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8');

  return crypto.createPrivateKey({ key: toNodeJwk(JSON.parse(jwkJson)), format: 'jwk' });
}

/**
 * Laedt den privaten Signierschluessel der Session (gecached).
 *
 * Gibt `null` zurueck, wenn der Nutzer keinen Signierschluessel hat — das ist
 * ein regulaerer Zustand ("migration was skipped by the user") und kein Fehler.
 */
export async function getSigningKey(client: StashcatClient): Promise<crypto.KeyObject | null> {
  const cached = signingKeyCache.get(client);
  if (cached !== undefined) return cached;

  let key: crypto.KeyObject | null = null;
  try {
    const encJwk = client.exportPrivateKey();
    if (!encJwk) throw new Error('E2E nicht entsperrt — kein Verschluesselungsschluessel vorhanden');
    const encPrivateKey = crypto.createPrivateKey({
      key: toNodeJwk(encJwk as unknown as Record<string, unknown>),
      format: 'jwk',
    });

    const data = client.api.createAuthenticatedRequestData({ type: 'signing', format: 'jwk' });
    const payload = await client.api.post<GetPrivateKeyPayload>('/security/get_private_key', data);
    const raw = payload?.keys?.private_key;
    if (!raw) {
      serverLog('[Signing] Kein Signierschluessel hinterlegt — Chat-Schluessel werden unsigniert verteilt');
      signingKeyCache.set(client, null);
      return null;
    }

    key = unwrapSigningKey(JSON.parse(raw) as EncryptedSigningKey, encPrivateKey);
    serverLog('[Signing] Privater Signierschluessel entpackt');
  } catch (err) {
    serverLog('[Signing] Signierschluessel nicht verfuegbar:', err instanceof Error ? err.message : String(err));
    key = null;
  }

  signingKeyCache.set(client, key);
  return key;
}

export interface SignedChatKey {
  /** base64, mit dem Public Key des Empfaengers verschluesselter AES-Schluessel */
  encrypted: string;
  /** hex-Signatur, oder `null` wenn kein Signierschluessel vorhanden ist */
  signature: string | null;
  /** Unix-Sekunden, oder `null` */
  expiryTimestamp: number | null;
}

/** Voreinstellung des offiziellen Clients: 30 Tage. */
export const DEFAULT_KEY_TTL = 2_592_000;

export interface SignedContentOptions {
  /** `unique_identifier` des Chats — **nicht** die numerische ID. */
  chatId?: string | null;
  /** Nur fuer Konversationen; bei Channels laesst der Originalclient das weg. */
  memberIds?: Array<string | number> | null;
  ttl?: number | null;
  expiryTimestamp?: number | null;
}

/**
 * Baut die Zeichenkette, die signiert wird — 1:1 wie
 * `EncryptionService.getChatKeySignedContent` im Webclient:
 *
 * ```
 * <encrypted>$<chatId>[$<expiry>][$<memberId>…]
 * ```
 *
 * Die Mitglieder-IDs sind dedupliziert und numerisch aufsteigend sortiert.
 */
export function chatKeySignedContent(
  encrypted: string,
  opts: SignedContentOptions = {},
): { msg: string; expiryTimestamp: number | null } {
  let msg = `${encrypted}$${opts.chatId ?? ''}`;

  let expiryTimestamp = opts.expiryTimestamp ?? null;
  if (expiryTimestamp != null || opts.ttl != null) {
    expiryTimestamp = expiryTimestamp ?? Math.floor(Date.now() / 1000) + (opts.ttl as number);
    msg += `$${expiryTimestamp}`;
  }

  if (opts.memberIds?.length) {
    const ids = [...new Set(opts.memberIds.map((id) => Number(id)))].sort((a, b) => a - b);
    msg += `$${ids.join('$')}`;
  }

  return { msg, expiryTimestamp };
}

/**
 * Verschluesselt einen Chat-AES-Schluessel fuer einen Empfaenger und signiert
 * ihn mit dem privaten Signierschluessel.
 *
 * Fehlt der Signierschluessel, wird **unsigniert** zurueckgegeben statt mit dem
 * falschen Schluessel zu signieren — genau so verhaelt sich der Originalclient.
 */
export async function encryptAndSignChatKey(
  client: StashcatClient,
  encryptedKeyBase64: string,
  opts: SignedContentOptions,
): Promise<SignedChatKey> {
  const signingKey = await getSigningKey(client);
  if (!signingKey) {
    return { encrypted: encryptedKeyBase64, signature: null, expiryTimestamp: null };
  }

  const { msg, expiryTimestamp } = chatKeySignedContent(encryptedKeyBase64, opts);
  const signature = crypto.sign('sha256', Buffer.from(msg, 'utf8'), signingKey).toString('hex');
  return { encrypted: encryptedKeyBase64, signature, expiryTimestamp };
}
