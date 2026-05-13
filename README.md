# BBZ Chat
![BBZ Logo](https://www.bbz-rd-eck.de/wp-content/uploads/2018/09/BBZ-Logo-Master.png)

Ein moderner Browser-Client für Stashcat / schul.cloud, entwickelt für das BBZ Rendsburg-Eckernförde.

## Für Anwender

### Anmelden

Öffne die App und melde dich mit deinen Stashcat-Zugangsdaten an. Bei Stashcat-Konten mit separatem Sicherheitspasswort wirst du nach diesem gefragt.

### Nachrichten

- **Direktnachrichten** und **Channels**: Alle deine Unterhaltungen findest du in der linken Seitenleiste.
- **Favoriten**: Hefte wichtige Chats mit dem Stern-Symbol an – sie erscheinen oben.
- **Nachrichten senden**: Tippe unten in das Eingabefeld. Unterstützte Formate:
  - Markdown (Fett, Kursiv, Code, Links, Listen)
  - Emoji über den Emoji-Picker
  - Dateianhänge über die Büroklammer
- **Nachrichtenaktionen** (Hover):
  - 👍 Like / Unlike
  - 🗑 Löschen (eigene Nachrichten)
  - 📋 Text kopieren
- **Antworten**: Hover über eine Nachricht → "Antworten"-Button
- **Umfragen erstellen**: Büroklammer → „Umfrage erstellen"
- **Termine erstellen**: Büroklammer → „Termin erstellen" (vorausgewählte Teilnehmer aus dem aktuellen Chat)
- **Videokonferenz**: Video-Icon im Chat-Header startet einen Jitsi-Meeting-Link

### Channels

- Channels gruppiert nach Unternehmen in der Seitenleiste
- Channel erstellen: Neuer-Channel-Button → Name, Typ (öffentlich/verschlüsselt/mit Passwort), Sichtbarkeit, Berechtigungen
- Channel-Info: Dropdown-Menü im Chat-Header → Infomodal mit Typ, Verschlüsselung, Mitgliederzahl, Erstellungsdatum
- Beschreibung bearbeiten: Direkt unter dem Channel-Namen klickst du auf den Text
- **Schnellzugriff-Buttons**: Moodle, BigBlueButton und TaskCards-Links im Beschreibungstext werden automatisch als farbige Buttons im Header angezeigt
- Mitglieder verwalten: Personen-Symbol im Chat-Header → Mitgliederliste, einladen, entfernen, Moderatoren ernennen

### Dateien

- Datei-Browser über das Ordner-Symbol in der oberen Leiste
- Drei Bereiche: **Dateien** (des aktuellen Chats), **Meine Dateien** (persönlicher Speicher)
- Navigation: Breadcrumbs, Erstellen von Unterordnern, Hochladen (auch komplette Ordnerstrukturen mit Fortschrittsanzeige)
- Dateiaktionen: Umbenennen, Löschen, Herunterladen
- Vorschau: Einzelklick öffnet Bilder (Leuchtkasten), PDFs (Inline-Viewer), Text/Audio/Video (neuer Tab)

### Kalender

- Monats- und Wochenansicht, farbcodiert nach Ereignisquelle
- Termine erstellen, bearbeiten, löschen
- Einladungen: Annehmen/Ablehnen per RSVP
- Wiederkehrende Termine: täglich, wöchentlich, monatlich, jährlich

### Umfragen

- Drei Tabs: Meine Umfragen, Eingeladen, Archiviert
- Abstimmung mit Live-Ergebnissen
- Datenschutz: offen (alle sehen Namen), verborgen (nur Ersteller), anonym

### Einstellungen

- **Design**: Hell/Dunkel-Modus (Schalter in der Seitenleiste)
- **Ansicht**: Sprechblasen-Ansicht oder Text-Ansicht für Nachrichten
- **Bilder**: Inline-Bildanzeige an/aus
- **Benachrichtigungen**: Desktop-Benachrichtigungen aktivieren/deaktivieren
- **Favicon-Badge**: Ungelesen-Zähler als roter Punkt im Tab

---

## Für Entwickler

### Voraussetzungen

- **Node.js 20+**
- **pnpm** (Projekt nutzt pnpm als Paketmanager)
- **stashcat-api** als lokale Abhängigkeit: Klon das Repository neben dieses Projekt:

```bash
cd ..
git clone https://github.com/dclausen01/stashcat-api.git
cd stashcat-api
pnpm install && pnpm build
```

### Installation & Start

```bash
# Abhängigkeiten installieren
pnpm install

# Umgebung konfigurieren
cp .env.example .env
# .env mit deinen Zugangsdaten bearbeiten (s. u.)

# Entwicklung: Frontend + Backend parallel starten
pnpm start
```

- Backend läuft auf **Port 3001** (`tsx server/index.ts`)
- Vite Dev-Server auf **Port 5173** mit Proxy `/backend/api/*` → Port 3001
- Öffne [http://localhost:5173](http://localhost:5173)

### Verfügbare Scripts

| Befehl        | Beschreibung                        |
| ------------- | ------------------------------------ |
| `pnpm start`  | Frontend + Backend parallel           |
| `pnpm dev`    | Nur Vite Dev-Server (Frontend)       |
| `pnpm server` | Nur Express Backend                  |
| `pnpm build`  | TypeScript-Check + Produktions-Build |
| `pnpm lint`   | ESLint-Prüfung                       |

### Umgebungsvariablen

Erstelle eine `.env`-Datei:

```env
STASHCAT_BASE_URL=https://api.schul.cloud/
STASHCAT_EMAIL=deine-email@example.com
STASHCAT_PASSWORD=dein-passwort
STASHCAT_SECURITY_PASSWORD=   # Optional; default = STASHCAT_PASSWORD
STASHCAT_APP_NAME=bbz-chat
STASHCAT_DEVICE_ID=            # Optional; wird autogeneriert wenn leer

# Pflicht in Produktion — siehe Abschnitt "SESSION_SECRET" unten
SESSION_SECRET=
```

#### SESSION_SECRET (Pflicht in Produktion)

`SESSION_SECRET` ist der AES-256-GCM-Hauptschlüssel, mit dem das Backend die
Session-Tokens verschlüsselt, die im `localStorage` der Nutzer abgelegt werden.

Ohne diese Variable erzeugt der Server bei jedem Start einen zufälligen Schlüssel.
Dadurch werden bestehende Tokens nach jedem Backend-Restart ungültig — alle
Nutzer müssen sich neu anmelden, und Stashcat registriert dabei jeweils ein
**neues Gerät** (sichtbar als "neues Gerät angemeldet"-Mail).

**Einmaliges Setup im Produktivsystem:**

```bash
# 1. Sicheres 256-Bit-Secret erzeugen
openssl rand -hex 32
# Beispiel-Ausgabe:
# 4f8b2c... (64 Hex-Zeichen)

# 2. In die .env eintragen
echo "SESSION_SECRET=4f8b2c..." >> /pfad/zum/projekt/.env

# 3. Dateirechte einschränken (Schlüssel nur für den Service-User lesbar)
chmod 600 /pfad/zum/projekt/.env
chown <service-user>:<service-group> /pfad/zum/projekt/.env

# 4. Backend neu starten (systemd / pm2 / docker compose up -d / ...)
systemctl restart stashcat-chat   # oder analog
```

**Wichtig:**

- `.env` darf **nicht** ins Git-Repository (steht in `.gitignore`).
- Den Wert sicher backuppen (z. B. in einem Passwort-Manager). Geht er verloren,
  müssen sich alle Nutzer einmalig neu anmelden — kein Datenverlust, aber die
  "neues Gerät"-Mail-Welle tritt einmalig auf.
- **Nicht rotieren ohne Grund.** Jede Änderung invalidiert alle Tokens.
- Bei Verdacht auf Leak (Backup unverschlüsselt, Server-Kompromittierung):
  neuen Wert generieren und Backend restarten.

### Architektur

```
Browser (Port 5173)
  └── React App
        └── src/api.ts ──→ Express Backend (Port 3001)
                               └── StashcatClient (stashcat-api)
                                     └── api.stashcat.com / api.schul.cloud
```

- **Backend**: Authentifizierter Proxy, hält eine `StashcatClient`-Instanz pro Sitzung im Speicher.
- **Sitzungen**: AES-256-GCM verschlüsselt in `.sessions.json` – Anmeldung überlebt Server-Neustarts.
- **E2E-Entschlüsselung**: Serverseitig via Node.js `crypto`; der Browser empfängt immer Klartext.
- **Echtzeit**: Socket.io (von `stashcat-api`) → Express SSE → Browser `EventSource`.

### Wichtige Dateien

```
src/
├── api/              # Modulare API-Client-Schicht (HTTP-Helfer für Auth, Channels, Nachrichten, etc.)
├── components/       # React-Komponenten (ChatView, Sidebar, FileBrowser, Kalender, Umfragen, etc.)
├── context/          # React Context (Auth, Theme, Settings)
├── hooks/            # Benannte Hooks (useRealtimeEvents, useNotifications, useFaviconBadge)
├── pages/            # Seiten (LoginPage)
└── utils/            # Helfer (fileIcon)

server/
├── index.ts          # Express-Server: alle Routen, SSE, Socket.io-Bridge
└── session-store.ts # Verschüsselte Sitzungsspeicherung
```

### Tech Stack

| Schicht      | Technologie                                      |
| ------------ | ------------------------------------------------ |
| Frontend     | React 19, TypeScript 5.9, Vite 8                 |
| Styling      | Tailwind CSS v4, clsx                            |
| Icons        | lucide-react                                     |
| Markdown     | react-markdown + remark-gfm                      |
| Emoji        | emoji-picker-react                               |
| Backend      | Express 5, tsx (Dev-Runner)                      |
| Uploads      | multer (multipart/form-data)                     |
| Echtzeit     | SSE + Socket.io (via stashcat-api)               |
| Editor       | Tiptap (Markdown-Editor für Umfragen/Termine)    |
| API          | stashcat-api (lokale file-Abhängigkeit)          |

---

## Mobile-Bridge (Flutter WebView)

Der Chat-Client kann als WebView-Frontend der nativen Flutter-App
`bbzcloud-mobil` betrieben werden. Aktivierung über
`https://chat.bbz-rd-eck.com/?bridge=mobile` oder durch
`localStorage.bbz_bridge='mobile'` (von Flutter beim ersten Boot gesetzt).

**Im Mobile-Modus:**

- Service-Worker wird beim Boot deregistriert; Web-Push deaktiviert.
- `Notification.requestPermission()` und `new Notification(...)` werden
  unterdrückt — Pushs liefert FCM via Flutter.
- Tailwind-Variant `bridge:` aktiv (`<html data-bridge="mobile">`).
- Sticky Composer mit `padding-bottom: env(safe-area-inset-bottom)`.
- Video-Calls (Jitsi) werden via `bridge.jitsi(url)` an Flutter delegiert
  (native Jitsi-App bzw. externer Browser).

**JS-Bridge:**

- Outgoing: `window.flutter_inappwebview.callHandler(name, payload)`
  (siehe `src/lib/flutterBridge.ts`). Handler-Namen: `bridgeReady`,
  `unread`, `notify`, `openExternal`, `pickFiles`, `logout`, `jitsi`,
  `setBadge`.
- Incoming (Flutter → Chat): `window.bbzChat.setTheme(mode)`,
  `setToken(token)`, `navigate(path)`, `reload()`.

**Auth-Flow:**

1. `POST /api/auth/mobile-login` mit `{ email, password, securityPassword }`
   → Response `{ mobileToken, token, user }`. Die Flutter-App persistiert
   `mobileToken` in sicherem Storage.
2. Bei jedem Cold-Start: `POST /api/auth/mobile-session` mit
   `Authorization: Bearer <mobileToken>` → frisches Session-Token.
3. Logout: `POST /api/auth/mobile-logout` mit demselben Bearer.

**Push (FCM HTTP v1):**

- `POST /api/push-tokens` mit `{ token, platform: 'android'|'ios',
  appVersion?, locale? }` registriert das Endgerät.
- `DELETE /api/push-tokens/:token` entfernt es.
- `GET /api/push-tokens` listet eigene Geräte (token nur gekürzt).
- Privacy-Toggle "Nur Hinweis ohne Inhalt": `PATCH
  /api/account/push-preferences` mit `{ pushPreviewMode: 'silent' }`.

**Deployment:**

1. `yarn install` (zieht die neuen Server-Module mit).
2. `.env` ergänzen: `FCM_SERVICE_ACCOUNT=/etc/bbzchat/firebase-admin.json`,
   `PUSH_ENABLED=true`, `PUSH_BATCH_MS=2000`.
3. Firebase-Admin-Service-Account-JSON unter `/etc/bbzchat/` ablegen
   (Mode 0o600, Owner = Service-User).
4. `yarn build` + Service-Restart.

Datenschutz-Doku: siehe [docs/PRIVACY.md](docs/PRIVACY.md).
