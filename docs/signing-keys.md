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

## Der aktuelle Fehler

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

Zusätzlich wird beim Anlegen verschlüsselter Channels gar nicht signiert
(`server/routes/channels.ts`: `skipping signature (server accepts without)`).

## Was der Original-Client tut

### Signierte Zeichenkette

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

`encrypted` ist der mit dem **Empfänger-Verschlüsselungsschlüssel** RSA-OAEP
verschlüsselte AES-Schlüssel, base64.

### Signatur

`RSASSA-PKCS1-v1_5` über die UTF-8-Bytes von `msg`, Ausgabe **hex**. Der Schlüssel
ist `RS256`, also SHA-256. Node-Äquivalent:

```ts
crypto.sign('sha256', Buffer.from(msg, 'utf8'), signingPrivateKey).toString('hex')
```

Das Verfahren stimmt mit `signData()` überein — falsch ist allein der Schlüssel
und die signierte Zeichenkette.

### Übergabe an den Server

`/security/set_missing_key` nimmt **einen Nutzer pro Aufruf**:

| Feld | Bedeutung |
|---|---|
| `user_id` | Empfänger |
| `type` | `channel` oder `conversation` |
| `type_id` | ID des Chats |
| `key` | verschlüsselter AES-Schlüssel (base64) |
| `signature` | hex-Signatur über `msg` |
| `expiry` | Ablaufzeitpunkt (Unix-Sekunden) oder leer |

`stashcat-api.setMissingKey()` schickt stattdessen `id`, `keys[]` mit
`key_signature` und **kein** `expiry`. Die Feldnamen weichen also ab.

Der Client behandelt explizit die Serverfehler `MissingAccessKeySignature` und
`InvalidAccessKeySignature` — der Server **prüft** die Signatur.

## Der offene Punkt: Woher kommt der private Signierschlüssel?

Der Webclient hält ihn als JWK im `localStorage` (`privateSigningKeyInLS`) und
importiert ihn per `RSA_SSA_PrivateKeyFromJWK`. Gesetzt wird er in
`handlePrivateKeyReceived`:

```js
setPrivateEncKey(encKey)
if (payload.signKey) {
  setPrivateSigningKey(RSA_SSA_PrivateKeyFromJWK(payload.signKey))
} else {
  console.error("…didn't receive a signing key from the logged in device")
}
```

Der **Geräte-zu-Geräte-Transfer überträgt also beide Schlüssel** — unsere
Implementierung entnimmt dem Payload nur einen.

`/security/get_private_key` mit `type=signing` verlangt `format=jwk`
(Clientmeldung: „Signing Key is only stored as JWK"). Ob und wie sich der
zurückgegebene Schlüssel mit dem Verschlüsselungspasswort entpacken lässt, ist
**noch nicht geklärt** — vermutlich über den Master Encryption Key
(`/security/get_master_encryption_key`, in `stashcat-api` bereits vorhanden).

Der Client kennt außerdem den Fall „Nutzer hat gar keinen Signierschlüssel":

> chatsecret not signed because user has no signing key.
> This might happen if the migration was skipped by the user.

## Umsetzungsplan

1. **Signierschlüssel beschaffen.** Zwei Wege prüfen: (a) `signKey` aus dem
   Geräte-Transfer-Payload zusätzlich entnehmen und in der Session ablegen;
   (b) `/security/get_private_key type=signing format=jwk` mit MEK-Entpackung
   für den Passwort-Login. Weg (b) ist der offene Punkt.
2. **`SecurityManager` um einen zweiten Schlüssel erweitern** —
   `rsaSigningKey` neben `rsaPrivateKey`, plus `signWithSigningKey()`.
3. **`getChatKeySignedContent()` nachbauen** und in `setMissingKey` sowie bei
   der Channel-Erstellung verwenden.
4. **`setMissingKey` auf die echten Feldnamen umstellen** (`type_id`,
   `signature`, `expiry`, ein Nutzer pro Aufruf).
5. **Sauber degradieren:** Fehlt der Signierschlüssel, ungesigniert senden statt
   mit dem falschen Schlüssel zu signieren — so macht es der Original-Client.

Ohne Schritt 1 bringen die übrigen nichts.
