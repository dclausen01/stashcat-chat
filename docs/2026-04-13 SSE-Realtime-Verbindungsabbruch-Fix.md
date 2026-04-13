# SSE/Realtime-Verbindungsabbruch-Fix

**Datum:** 13.04.2026  
**Betroffene Dateien:** `src/hooks/useRealtimeEvents.ts`, `server/index.ts`, `src/components/ChatView.tsx`

## Problem

Nach kurzer Laufzeit (weniger als 10 Minuten) in einem Webbrowser oder in einer Electron-App ging die SSE/Realtime-Verbindung stillschweigend verloren. Neue Nachrichten wurden nicht mehr signalisiert:

- Keine Badge-Updates in der Sidebar
- Keine Aktualisierung des Dokumenttitels (z.B. `(3) BBZ Chat`)
- Kein Favicon-Badge mit rotem Punkt
- Keine OS-Browser-Notifications

Beim manuellen Wechseln des Chats waren die Nachrichten jedoch sichtbar. Nach einem Neuladen der Webapp funktionierten die Notifications sofort wieder, fielen aber nach kurzer Zeit erneut aus.

## Ursachenanalyse

### 🔴 1. `ensureSharedEventSource()` prüft nur auf `null`, nicht auf `readyState` — **SEHR HOHE Wahrscheinlichkeit**

**Datei:** `src/hooks/useRealtimeEvents.ts`, Zeile 34 (vorher)

```js
function ensureSharedEventSource() {
  if (sharedEs) return; // Already connected ← PROBLEM
  ...
}
```

Wenn das EventSource-Objekt in den Zustand `CLOSED` (readyState=2) wechselt, existiert das Objekt weiterhin (`sharedEs` ist truthy), aber die Verbindung ist tot. Die Funktion kehrt sofort zurück und denkt, alles sei in Ordnung. **Keine Events kommen jemals wieder an**, bis die Seite neu geladen wird.

EventSource geht in den CLOSED-Zustand, wenn:
- Der Server einen non-200 Status Code bei einem Reconnect-Versuch liefert
- Die TCP-Verbindung dauerhaft abbricht (z.B. nach Standby/Wakeup)
- Ein Proxy/Load-Balancer die Verbindung terminiert

**Fix:** Prüfung auf `sharedEs.readyState === EventSource.OPEN` statt nur `if (sharedEs)`.

### 🟠 2. Kein Heartbeat-Monitoring auf Client-Seite — **HOHE Wahrscheinlichkeit**

Der Server sendet alle 25 Sekunden Heartbeats (`: heartbeat\n\n`), aber der Client **überwacht nicht**, ob er diese erhält. Bei einem stillen TCP-Verbindungsabbruch (Tab im Hintergrund, Laptop schläft ein, Netzwerkwechsel) feuert der Browser oft **kein `onerror`-Event**. Das EventSource-Objekt bleibt scheinbar `OPEN`, aber keine Daten kommen mehr durch.

**Fix:** Client-seitigen Heartbeat-Watchdog implementieren — wenn 45+ Sekunden kein Event empfangen wurde, Verbindung erzwingen schließen und neu aufbauen.

### 🟠 3. Keine Reconnect-Logik bei Tab-Wakeup (`visibilitychange`) — **HOHE Wahrscheinlichkeit**

Wenn ein Tab in den Hintergrund wechselt, drosseln Browser:
- `setTimeout`/`setInterval` auf 1-Minuten-Intervalle
- SSE-Verbindungen können stillschweigend gekappt werden
- Nach Tab-Wakeup ist die SSE-Verbindung oft tot, aber es gab **keinen `visibilitychange`-Handler**, der das erkennt und behebt.

Besonders in Electron: OS-Level Power Management kann die App in den Schlaf schicken, ohne dass JavaScript etwas merkt.

**Fix:** `document.addEventListener('visibilitychange', ...)` — beim Wechsel in den Vordergrund die SSE-Verbindung prüfen und ggf. neu aufbauen.

### 🟡 4. `onerror`-Handler hat keine Wiederherstellungslogik — **MITTLERE Wahrscheinlichkeit**

```js
sharedEs.onerror = (err) => {
  console.error('[useRealtimeEvents] SSE error:', err);
  sharedWasDisconnected = true;
  // EventSource auto-reconnects on error ← Nur teilweise wahr!
};
```

EventSource versucht zwar auto-reconnect, gibt aber **permanent auf** wenn:
- Der Server einen non-200 Status liefert
- Mehrere Reconnect-Versuche fehlschlagen
- Die Verbindung während des Reconnects wieder bricht

**Fix:** Im `onerror`-Handler `readyState` prüfen. Wenn `CLOSED`, EventSource explizit schließen und dem Watchdog die Wiederherstellung überlassen.

### 🟡 5. Server-Side Client-Cache Eviction (10 Min TTL) — **MITTLERE Wahrscheinlichkeit**

**Datei:** `server/index.ts`

Nach 10 Minuten wird der `StashcatClient` aus dem Cache evictiert. Die `activeSSE`-Map hält zwar noch eine Referenz, aber der Socket.io-Client zum Stashcat-Push-Server könnte inaktiv werden, wenn der Client evictiert wurde.

**Fix:** Die TTL für Clients mit aktiven SSE-Verbindungen bei jedem Heartbeat-Intervall verlängern.

### 🟢 6. SSE-Kommentare statt named Events für Heartbeat — **NIEDRIGE Wahrscheinlichkeit**

Der Server sendete Heartbeats als SSE-Kommentare (`: heartbeat\n\n`). Diese sind für `EventSource.addEventListener` unsichtbar und können nicht für die Liveness-Überwachung genutzt werden.

**Fix:** Named Event (`event: heartbeat\ndata: {}\n\n`) statt SSE-Kommentar verwenden.

## Durchgeführte Änderungen

### `src/hooks/useRealtimeEvents.ts` — Komplett überarbeitet

| Feature | Beschreibung |
|---------|--------------|
| **readyState-Prüfung** | `ensureSharedEventSource()` erkennt CLOSED-Verbindungen und baut sie neu auf |
| **Heartbeat-Watchdog** | Überwacht alle 15s, ob innerhalb von 45s ein SSE-Event empfangen wurde; bei Timeout → reconnect |
| **`visibilitychange`-Handler** | Beim Aufwachen aus dem Hintergrund: SSE-Gesundheitsprüfung + ggf. Reconnect |
| **Robuster `onerror`-Handler** | Erkennt `CLOSED`-Zustand und leitet Wiederherstellung ein |
| **`onmessage`-Fallback** | Fängt alle unbenannten SSE-Events für die Watchdog-Zeitstempel-Aktualisierung |

### `server/index.ts` — Heartbeat + Cache-TTL

| Feature | Beschreibung |
|---------|--------------|
| **Named heartbeat-Event** | `event: heartbeat\ndata: {}\n\n` statt SSE-Kommentar — für Client-Watchdog sichtbar |
| **Cache-TTL-Refresh** | Bei jedem Heartbeat wird `clientCache.expiresAt` aktualisiert — verhindert Eviction aktiver Verbindungen |

### `src/components/ChatView.tsx` — Fallback-Timer (bereits zuvor fixiert)

| Feature | Beschreibung |
|---------|--------------|
| **Timer-Start nach API-Call** | Fallback-Timer startet erst nach erfolgreichem `sendMessage()`, nicht davor |
| **Timeout 15s statt 5s** | Mehr Zeit für SSE-Zustellung, verhindert unnötiges `loadMessages()` |

## Architektur der Wiederherstellung

```
                    ┌─────────────────────┐
                    │  EventSource erstellt │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │   Watchdog gestartet  │
                    │  (15s Intervall)      │
                    └──────────┬──────────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
    ┌─────────▼──────┐  ┌─────▼──────┐  ┌──────▼─────────┐
    │  Event empfangen │  │  onerror   │  │ visibilitychange│
    │  → Timestamp     │  │  fired     │  │ (Tab aufwachen) │
    │    aktualisiert  │  │            │  │                 │
    └────────────────┘  └─────┬──────┘  └──────┬──────────┘
                              │                │
                    ┌─────────▼────────▼─────────┐
                    │  readyState === CLOSED?     │
                    │  ODER 45s kein Event?       │
                    └─────────┬──────────────────┘
                              │ Ja
                    ┌─────────▼──────────────────┐
                    │  EventSource schließen      │
                    │  + neu erstellen            │
                    │  + reconnect-Handler feuern │
                    └────────────────────────────┘
```

### `src/components/Sidebar.tsx` — Periodischer Sync als Safety-Net

| Feature | Beschreibung |
|---------|--------------|
| **3-Minuten-Sync** | Alle 3 Minuten (nur wenn Tab sichtbar) werden Unread-Counts frisch vom Server geladen |
| **Fängt verpasste Events ab** | Selbst wenn SSE + RealtimeManager beide sterben, werden Unread-Counts nach spätestens 3 Minuten aktualisiert |

### `server/index.ts` — RealtimeManager Auto-Reconnect

| Feature | Beschreibung |
|---------|--------------|
| **Socket.io disconnect → reconnect** | Wenn der RealtimeManager die Verbindung zum Stashcat-Push-Server verliert, wird nach 3s automatisch ein neuer aufgebaut — solange noch SSE-Clients vorhanden sind |
| **Verhindert verwaiste Verbindungen** | Ohne aktive SSE-Clients wird kein Reconnect versucht |

## Test-Empfehlungen

1. **Tab-Hintergrund-Test:** App öffnen, Tab für 5+ Minuten in den Hintergrund wechseln, dann zurückkehren → Notifications sollten sofort wieder funktionieren
2. **Standby-Test:** Laptop zuklappen, nach 10+ Minuten aufwecken → SSE sollte sich automatisch reconnecten
3. **Netzwerk-Wechsel-Test:** WLAN → LAN wechseln (oder umgekehrt) → Watchdog sollte stillen Abbruch erkennen
4. **Langer Laufzeit-Test:** App 30+ Minuten offen lassen, Nachrichten von anderen empfangen → Badges/Titel/Favicon sollten aktualisiert werden
5. **Browser-Konsole beobachten:** `[useRealtmeEvents]`-Logs zeigen Watchdog- und Reconnect-Aktivität