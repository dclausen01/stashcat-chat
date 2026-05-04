# BBZ Chat
![[https://www.bbz-rd-eck.de/wp-content/uploads/2018/09/BBZ-Logo-Master.png]]

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
```

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
