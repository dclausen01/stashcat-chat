# E2E Encryption Bug - Debugging

## Was wir gemacht haben

### Debug-Logging eingebaut

1. **stashcat-api/src/security/security.ts**
   - Cache-Hit/Miss Logging in `decryptConversationKey()`
   - Loggt: `cacheId`, `cacheHit`, `cacheSize`

2. **stashcat-api/src/client/StashcatClient.ts**
   - Channel-Key Logging in `getMessages()`
   - Loggt: `id`, `encrypted`, `hasKey`, `keyLength`

3. **server/index.ts**
   - `[getClient]` loggt `clientKey` und `cached` Status
   - `[getMessages:route]` loggt `type`, `targetId`, `E2E_unlocked`
   - Fehler-Response enthält jetzt `E2E_unlocked` und `stack`

4. **src/api.ts**
   - Error-Response wird mit `debug` Property erweitert durchgereicht

5. **src/components/ChatView.tsx**
   - Error-Handler loggt `debug` Info in Browser-Konsole

### Commits

- `stashcat-api`: `debug: add cache logging to decryptConversationKey`
- `stashcat-chat`: `debug: add E2E decryption logging for channel messages`
- `stashcat-chat`: `fix: move client outside try block for error handler`

## Was zu tun ist

### Auf dem Server

```bash
cd ~/stashcat-api && git pull && npm run build
cd ~/stashcat-chat && git pull && npm run build
```

Dann Node.js-App neustarten über Plesk.

### Testen

1. Browser DevTools öffnen (F12) → Console Tab
2. Neu anmelden
3. Neuen **verschlüsselten** Channel erstellen
4. Channel betreten
5. **Konsolen-Output analysieren:**

Erfolgreich:
```
[getMessages:route] type=channel targetId=123 E2E_unlocked=true
[getMessages:channel] id=123 encrypted=true hasKey=true keyLength=344
[decryptConversationKey] cacheId=channel_123 cacheHit=false cacheSize=2
```

Fehler (erwartet):
```
Failed to load messages: Error: Failed to decrypt conversation AES key: error:02000079:rsa routines::oaep decoding error
Debug info: {
  error: "Failed to decrypt conversation AES key: error:02000079:rsa routines::oaep decoding error",
  E2E_unlocked: true/false
}
```

## Was die Logs zeigen werden

| Variable | Bedeutung |
|----------|-----------|
| `E2E_unlocked=true` | E2E ist entsperrt - Problem ist beim RSA-OAEP Decrypt |
| `E2E_unlocked=false` | E2E ist NICHT entsperrt - Session-Problem |
| `cacheHit=true` | Cache wurde verwendet - sollte OHNE Decrypt returnieren |
| `cacheHit=false` | Cache leer/neu - OAEP Decryption wird durchgeführt |
| `keyLength=xxx` | Länge des verschlüsselten Keys (sollte gleich bleiben) |

## Hypothesen

- **`E2E_unlocked=false`** → Problem bei Session-Wiederherstellung
- **`cacheHit=false` trotz erster Ladung** → Cache wird geleert
- **`keyLength` unterschiedlich** → Server gibt verschiedenen Key zurück
