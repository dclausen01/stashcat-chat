# Signierung verschlüsselter Chats — Analyse

Statisch aus dem offiziellen schul.cloud-Webclient extrahiert. Erklärt, warum
Signaturen aus `stashcat-chat` derzeit ungültig sind, und was zur Behebung fehlt.

## Zwei Schlüsselpaare pro Nutzer

Stashcat hält je Nutzer **zwei getrennte RSA-4096-Schlüsselpaare**:

| Zweck | JWK `alg` | `key_ops` | Feld am Nutzer |
|---|---|---|---|
| Verschlüsselung | `RSA-OAEP` | `["encrypt"]` | `public_key` |
| Signierung | `RS256` | `["verify"]` | `public_signing_key` |

An einem realen Konto verifiziert: unterschiedliche Moduli, unterschiedliche
Fingerprints. Der Verschlüsselungsschlüssel trägt `key_ops: ["encrypt"]` — eine
WebCrypto-Implementierung **verweigert** damit jede Signaturprüfung.

Dazu kommen zwei Signaturen, die die Schlüssel aneinander binden:

- `public_key_signature` — der Verschlüsselungsschlüssel, signiert mit dem
  Signierschlüssel des Nutzers
- `public_key_ca_signature` — der Signierschlüssel, signiert vom Server

`/security/get_public_keys` mit `"all"` liefert beide Typen je Nutzer.

## Der Fehler (behoben)

`SecurityManager` (stashcat-api) hält genau **einen** Schlüssel:

```ts
private rsaPrivateKey?: crypto.KeyObject;   // aus /security/get_private_key (Verschlüsselung)

signData(data: Buffer): Buffer {
  return crypto.sign('sha256', data, this.rsaPrivateKey);   // ← falscher Schlüssel
}
```

Signaturen entstehen also mit dem Verschlüsselungsschlüssel und können gegen
`public_signing_key` nicht verifizieren. Symptom: Verschlüsselung funktioniert,
Signierung nicht.

Zusätzlich wurde beim Anlegen verschlüsselter Channels gar nicht signiert.

Beides ist behoben — siehe „Umsetzung in stashcat-chat" am Ende.

## Woher der private Signierschlüssel kommt

Das war der offene Punkt — er ist geklärt. Der Schlüssel liegt auf dem Server,
**doppelt verpackt**, und lässt sich allein mit dem privaten
Verschlüsselungsschlüssel entpacken. Ein Passwort wird dafür nicht gebraucht.

### Ablage

`POST /security/store_key_pair` speichert die beiden Typen unterschiedlich:

```js
// type=encryption, format=jwk — mit dem Verschlüsselungspasswort abgeleitet
{ ciphertext, iv, encryption_func, key_derivation_properties: { iterations, prf, salt } }

// type=signing, format=jwk — an den eigenen Public Key gebunden
{ ciphertext, iv, encryption_func, encryptedKEK }
```

`encryptRSAPrivateKeyAsJWKWithPublicKey(signPriv, encPub)` im Webclient:

```js
kek          = generateAES_Key()                    // zufällig, 256 bit
encryptedKEK = encryptRSA_OAEP(encPub, exportRaw(kek))
ciphertext   = encryptTextAES_CBC(JSON.stringify(jwk(signPriv)), kek, iv)
→ { ciphertext, encryptedKEK, iv, encryption_func: "aes-256-cbc" }
```

Beide Aufrufstellen (`generateKeys`, `createSigningKeyForExistingUser`) übergeben
als `publicKey` den **Verschlüsselungs**-Public-Key des Nutzers selbst.

### Entpackung

`EncryptionService.importPrivateSigningKey` → `RSA_SSA_privateKeyFromEncryptedJWK(stored, privEncKey)`:

```js
kek = decryptRSA_OAEP(privEncKey, stored.encryptedKEK)   // base64 → raw AES-Key
jwk = decryptTextAES_CBC(kek, stored.ciphertext, stored.iv)
→ importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, ["sign"])
```

Der private Verschlüsselungsschlüssel liegt uns nach dem E2E-Unlock vor
(`client.exportPrivateKey()`), also ist die Kette serverseitig nachvollziehbar.

### Zwei Fallstricke

- **RSA-OAEP nutzt SHA-1.** `RSA_OAEP_PrivateKeyFromJWK` importiert mit
  `hash: "SHA-1"`. In Node also `oaepHash: 'sha1'` (Nodes Default, aber besser
  explizit). Mit SHA-256 schlägt die Entschlüsselung fehl.
- **`payload.keys.private_key` ist ein JSON-String**, kein Objekt — er muss vor
  der Verwendung geparst werden. Die Antwort enthält daneben `public_key`,
  `type`, `format` und `time`.

Verifiziert per Round-Trip: WebCrypto verpackt, Node entpackt, Node signiert,
WebCrypto verifiziert — KEK, JWK und Signatur stimmen überein.

## Was signiert wird

`getChatKeySignedContent(encrypted, chatId, memberIds, ttl, expiryTs)`:

```
msg = encrypted + "$" + (chatId ?? "")
wenn ttl oder expiryTs gesetzt:
    expiryTs = expiryTs ?? floor(now/1000) + ttl
    msg += "$" + expiryTs
wenn memberIds nicht leer:
    memberIds = eindeutig, numerisch aufsteigend sortiert
    msg += "$" + memberIds.join("$")
```

**`chatId` ist der `unique_identifier` des Chats, nicht die numerische ID.**
Belegt durch `KeyHandlerService.sendKeys`:

```js
securityService.setMissingKey(
  e.foreign_user_id, type,
  e.id,                  // → type_id im Request
  e.unique_identifier,   // → chatId in der signierten Zeichenkette
  e.foreign_public_key, secret,
  type === Conversation ? chat.members.map(m => m.id) : null)
```

Wer wann was mitschickt:

| Fall | `chatId` | `memberIds` | `ttl` |
|---|---|---|---|
| Channel anlegen | `unique_identifier` | — | — (kein `expiry`) |
| Fehlenden Schlüssel senden, Channel | `unique_identifier` | — | 2 592 000 (30 Tage) |
| Fehlenden Schlüssel senden, Konversation | `unique_identifier` | Mitglieder **inkl. eigener ID** | 2 592 000 |

Signiert wird mit `RSASSA-PKCS1-v1_5` / SHA-256 über die UTF-8-Bytes, Ausgabe
**hex** — in Node `crypto.sign('sha256', Buffer.from(msg, 'utf8'), signingKey)`.

## Übergabe an den Server

`POST /security/set_missing_key` nimmt **einen Nutzer pro Aufruf**:

| Feld | Bedeutung |
|---|---|
| `user_id` | Empfänger |
| `type` | `channel` oder `conversation` |
| `type_id` | numerische ID des Chats |
| `key` | verschlüsselter AES-Schlüssel (base64) |
| `signature` | hex-Signatur über `msg` |
| `expiry` | Ablaufzeitpunkt (Unix-Sekunden) oder leer |

`POST /channels/create` nimmt `encryption_key` und `encryption_key_signature`.

Der Client behandelt die Serverfehler `MissingAccessKeySignature` und
`InvalidAccessKeySignature` — der Server **prüft** die Signatur.

## Umsetzung in stashcat-chat

| Datei | Inhalt |
|---|---|
| `server/lib/signing.ts` | Entpackt und cached den Signierschlüssel (`getSigningKey`), baut die signierte Zeichenkette (`chatKeySignedContent`), signiert (`encryptAndSignChatKey`) |
| `server/routes/key-sync.ts` | Verteilt fehlende Schlüssel mit korrekter Signatur; Konversationen mit Mitgliederliste, Channels ohne |
| `server/routes/channels.ts` | `encryption_key_signature` beim Anlegen; `POST /api/channels/:id/keys` verteilt Schlüssel serverseitig an Nachzügler |
| `server/routes/security.ts` | `GET /api/security/signing-status` — Diagnose: Schlüssel vorhanden? passt er zum hinterlegten Public Key? |

Der Cache ist eine `WeakMap` über die Client-Instanz, damit das Schlüsselmaterial
mit der Session verschwindet.

**Sauberes Degradieren:** Fehlt der Signierschlüssel, wird unsigniert gesendet
statt mit dem falschen Schlüssel zu signieren. Der Originalclient macht es
genauso:

> chatsecret not signed because user has no signing key.
> This might happen if the migration was skipped by the user.

`client.signData()` aus `stashcat-api` wird für Chat-Schlüssel **nicht mehr
verwendet** — es signiert mit dem Verschlüsselungsschlüssel.

## Offen

- `stashcat-api` selbst signiert an anderen Stellen weiterhin mit
  `signData()` (Verschlüsselungsschlüssel). Dort ist es bisher nicht
  aufgefallen, weil der Server diese Signaturen nicht prüft.
- Beim Geräte-zu-Geräte-Login überträgt der Originalclient zusätzlich einen
  `signKey` im Payload. Wir entnehmen ihn nicht — nötig ist das nicht mehr,
  weil der Schlüssel jetzt über `/security/get_private_key` beschafft wird.
- Eingehende Signaturen **prüfen** wir nicht. Der Originalclient tut das
  (`checkAccessKeySignatureForChat`) und warnt bei ungültiger Signatur.
