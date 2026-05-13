# Datenschutz — Mobile-Bridge & Push-Benachrichtigungen

Dieses Dokument beschreibt, welche personenbezogenen Daten der Server
`stashcat-chat` verarbeitet, wenn die App als WebView in der nativen
Flutter-App `bbzcloud-mobil` läuft (Mobile-Bridge-Modus, `?bridge=mobile`).

Es ergänzt die allgemeine DSGVO-Dokumentation des BBZ
Rendsburg-Eckernförde und ist als interne Auftragsverarbeitungs-Doku
gedacht.

## Verarbeitete Daten

### Mobile-Login-Token (`.mobile-tokens.json`)

Beim Login über `POST /api/auth/mobile-login` wird ein 256-Bit-Zufallstoken
ausgestellt und in `.mobile-tokens.json` AES-256-GCM-verschlüsselt persistiert.

Felder pro Eintrag:

- `sessionToken` (verschlüsseltes Stashcat-Session-Token)
- `userId` (Stashcat-`clientKey`, intern stabile User-ID)
- `createdAt`, `lastSeenAt` (Zeitstempel)
- `pushPreviewMode` (`full` | `silent`)

**Speicherdauer:** Sliding TTL von 30 Tagen. Wenn der Token 30 Tage lang nicht
mehr benutzt wird (= kein `mobile-session`-Aufruf), wird er beim nächsten
Lese-Zugriff verworfen. Explizites Löschen via
`POST /api/auth/mobile-logout` (wird von der Flutter-App beim Logout
zwingend aufgerufen).

### FCM-Push-Tokens (`.push-tokens.json`)

Pro registriertem Endgerät:

- `token` (FCM-Token, vom Endgerät generiert)
- `userId` (siehe oben)
- `platform` (`android` | `ios`)
- `appVersion`, `locale` (optional)
- `createdAt`, `lastSeenAt`

**Speicherdauer:** 90 Tage ohne `lastSeenAt`-Aktualisierung; danach
periodische automatische Löschung (`pruneOlderThan`). Manuelle Löschung via
`DELETE /api/push-tokens/:token` (z.B. beim Logout oder beim Geräte-Reset).

### Push-Inhalte

Beim Versand einer Notification an FCM werden folgende Daten an Google
übermittelt:

- Empfänger-FCM-Token
- Titel + Body (max. 200 Zeichen Vorschau)
- Deeplink (z.B. `/c/<channelId>`)
- Optional: Badge-Zahl, Stashcat-Message-ID

**Privacy-Toggle "Nur Hinweis ohne Inhalt":** Setzt der Nutzer in den
App-Einstellungen `pushPreviewMode = silent`, sendet der Dispatcher
ausschließlich den Titel `"Neue Nachricht"` und einen leeren Body — kein
Absender, kein Inhalt. Die Einstellung wird pro Mobile-Token gespeichert
und greift sofort.

## Verantwortlichkeit

- Server-Betreiber: BBZ Rendsburg-Eckernförde (Auftragsverarbeiter).
- Datenempfänger: Google LLC (FCM-Zustellung). Übermittlung erfolgt
  TLS-verschlüsselt; siehe Google-Cloud-DSGVO-Vereinbarung.
- Endgeräte-Hersteller (Apple/Google) sehen Push-Bodies nur im Klartext, wenn
  `pushPreviewMode = full` gewählt wurde. Im `silent`-Modus enthält die
  Notification keinen Klartext.

## Rechte der Betroffenen

- **Auskunft:** `GET /api/push-tokens` listet alle eigenen registrierten
  Tokens (gekürzt) auf.
- **Löschung:** `DELETE /api/push-tokens/:token` und
  `POST /api/auth/mobile-logout`.
- **Einschränkung:** Privacy-Toggle in den App-Einstellungen.

## Technisches

- Alle persistenten Dateien (`.sessions.json`, `.mobile-tokens.json`,
  `.push-tokens.json`) sind AES-256-GCM-verschlüsselt mit demselben Master-Key
  (`.session-secret`, Mode 0o600).
- Master-Key ist ephemer (zufällig bei Server-Start), wenn `SESSION_SECRET`
  nicht gesetzt ist — Sessions/Token überleben dann keinen Server-Neustart.
- Push-Versand-Fehler werden in `.push-errors.log` (Plaintext, ohne
  Push-Body) protokolliert.
