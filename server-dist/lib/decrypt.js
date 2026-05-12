"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.decryptMessageInPlace = decryptMessageInPlace;
const stashcat_api_1 = require("stashcat-api");
/**
 * Decrypts `msg.text` in place when the message is E2E-encrypted.
 *
 * Picks the AES key from the conversation (preferred) or channel based on the message's IDs,
 * decrypts the ciphertext with the message's IV, and writes the plaintext back to `msg.text`.
 *
 * Mutates `msg` rather than returning a new object so callers can apply it to either a
 * realtime payload clone or an existing message record without restructuring their code.
 */
async function decryptMessageInPlace(client, msg, options = {}) {
    if (!msg.encrypted || !msg.text || !msg.iv)
        return;
    try {
        const channelId = msg.channel_id && msg.channel_id !== 0 ? String(msg.channel_id) : null;
        const convId = msg.conversation_id && msg.conversation_id !== 0 ? String(msg.conversation_id) : null;
        let aesKey;
        if (convId)
            aesKey = await client.getConversationAesKey(convId);
        else if (channelId)
            aesKey = await client.getChannelAesKey(channelId);
        if (!aesKey)
            return;
        const iv = stashcat_api_1.CryptoManager.hexToBuffer(String(msg.iv));
        msg.text = stashcat_api_1.CryptoManager.decrypt(String(msg.text), aesKey, iv);
    }
    catch (err) {
        options.onError?.(err);
        if (options.fallback !== undefined)
            msg.text = options.fallback;
    }
}
