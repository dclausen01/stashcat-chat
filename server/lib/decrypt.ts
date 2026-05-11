import { StashcatClient, CryptoManager } from 'stashcat-api';

/**
 * Shape of a message-like object that may carry an E2E-encrypted text body.
 * Both raw `MessageSyncPayload` clones and generic message records satisfy this.
 */
export type DecryptableMessage = Record<string, unknown> & {
  encrypted?: unknown;
  text?: unknown;
  iv?: unknown;
  channel_id?: unknown;
  conversation_id?: unknown;
};

export interface DecryptOptions {
  /** If decryption fails, replace `msg.text` with this string. Omit to leave `text` untouched. */
  fallback?: string;
  /** Called on any error during AES-key lookup or decryption. */
  onError?: (err: unknown) => void;
}

/**
 * Decrypts `msg.text` in place when the message is E2E-encrypted.
 *
 * Picks the AES key from the conversation (preferred) or channel based on the message's IDs,
 * decrypts the ciphertext with the message's IV, and writes the plaintext back to `msg.text`.
 *
 * Mutates `msg` rather than returning a new object so callers can apply it to either a
 * realtime payload clone or an existing message record without restructuring their code.
 */
export async function decryptMessageInPlace(
  client: StashcatClient,
  msg: DecryptableMessage,
  options: DecryptOptions = {},
): Promise<void> {
  if (!msg.encrypted || !msg.text || !msg.iv) return;

  try {
    const channelId = msg.channel_id && msg.channel_id !== 0 ? String(msg.channel_id) : null;
    const convId = msg.conversation_id && msg.conversation_id !== 0 ? String(msg.conversation_id) : null;

    let aesKey: Buffer | undefined;
    if (convId) aesKey = await client.getConversationAesKey(convId);
    else if (channelId) aesKey = await client.getChannelAesKey(channelId);
    if (!aesKey) return;

    const iv = CryptoManager.hexToBuffer(String(msg.iv));
    msg.text = CryptoManager.decrypt(String(msg.text), aesKey, iv);
  } catch (err) {
    options.onError?.(err);
    if (options.fallback !== undefined) msg.text = options.fallback;
  }
}
