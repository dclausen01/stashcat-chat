# Unread-Signale Fix: Badge, Titel & Favicon

**Datum:** 22.04.2026
**Betroffene Dateien:** `src/components/Sidebar.tsx`, `src/hooks/useRealtimeEvents.ts`

## Problem

Obwohl neue Nachrichten korrekt erkannt wurden (Channel sortierte nach oben, NEU-Separator war sichtbar), erschienen keine Unread-Signale:
- Kein Badge in der Sidebar
- Kein `(N)` im document.title
- Kein roter Punkt im Favicon

## Ursachenanalyse

### Ursache 1: `loadData()` überschrieb SSE-Inkremente

`loadData()` lief alle 60s und holte `unread_count` von der Stashcat-API. Diese meldete oft stale `0` für Chats mit ungelesenen Nachrichten. Der Wert wurde **bedingungslos** übernommen und überschrieb damit die korrekten SSE-Inkremente.

### Ursache 2: SSE-Verbindung starb dauerhaft

Der Watchdog in `useRealtimeEvents.ts` hatte einen Bug: Wenn die EventSource auf `CLOSED` ging, rief `onerror` `destroyEventSource()` auf (setzt `sharedEs = null`). Der Watchdog prüfte als erstes `if (!sharedEs) return` — und brach ab, ohne einen Reconnect zu versuchen.

**Folge:** Sobald die SSE-Verbindung einmal abbrach (Netzwerkfehler, Standby, Server-Restart), blieb sie tot — bis zum nächsten Tab-Wechsel oder Page-Reload.

### Ursache 3: `verifyUnreadCounts()` war nutzlos

Die Funktion lud die ersten 20 Nachrichten pro Chat und zählte `msg.unread === true`. Debug-Logs zeigten: Stashcats `/message/content`-API **setzt das `unread`-Feld niemals auf `true`** — es ist immer `false` oder `undefined`. Die Funktion korrigierte daher nie etwas.

## Lösung

### Fix 1: Badge-Logik an `lastActivity` koppeln

Dasselbe Signal, das die Sortierung antreibt (`lastActivity`), wird jetzt auch für Badges genutzt. In `loadData()`:

```typescript
for (const ch of allChannels) {
  const prev = channelsRef.current.find((c) => c.id === ch.id);
  const apiUnread = ch.unread_count ?? 0;
  const sseUnread = prev?.unread_count ?? 0;
  const hasNewActivity = prev ? (ch.lastActivity ?? 0) > (prev.lastActivity ?? 0) : false;
  if (hasNewActivity && apiUnread === 0) {
    // Neue Nachricht via lastActivity erkannt, aber API sagt 0 → stale
    ch.unread_count = Math.max(sseUnread, 1);
  } else {
    ch.unread_count = Math.max(apiUnread, sseUnread);
  }
}
```

**Regel:** `unread_count` kann nur steigen (durch SSE oder `lastActivity`), nie durch `loadData()` sinken. Nur `markAsRead()` und `handleSelect()` setzen auf 0 zurück.

### Fix 2: Watchdog reconnectet bei `sharedEs === null`

```typescript
watchdogInterval = setInterval(() => {
  if (!sharedEs) {
    // Kein EventSource → Verbindung herstellen
    ensureSharedEventSource();
    return;
  }
  // ... Heartbeat-Prüfung
}, WATCHDOG_INTERVAL);
```

SSE-Verbindung wird jetzt innerhalb von max. 15s (Watchdog-Intervall) nach jedem Abbruch wiederhergestellt.

### Fix 3: Entfernte Komplexität

| Entfernt | Warum |
|----------|-------|
| `verifyUnreadCounts()` | API liefert `msg.unread` nie als `true` → Funktion korrigierte nie |
| `localStorage` lastRead-Tracking | Workaround, der nicht geholfen hat |
| Serverseitige `lastReadTimestamps` | RAM-basiert, bei Server-Restart verloren |
| `verifyInFlightRef` | Nur für `verifyUnreadCounts` benötigt |

## Architektur nach dem Fix

### Unread-Signal-Quellen

| Quelle | Wann aktiv | Zuverlässigkeit |
|--------|-----------|-----------------|
| SSE `handleMessageSync` | Wenn SSE-Verbindung steht | Hoch (Echtzeit) |
| `loadData()` lastActivity-Vergleich | Alle 60s (Fallback) | Hoch (nutzt dasselbe Signal wie Sortierung) |
| API `unread_count` | Alle 60s | Niedrig (oft stale) |

### Unread-Signal-Senken

| Signal | Quelle | Trigger |
|--------|--------|---------|
| Sidebar-Badge | `chat.unread_count` | SSE + loadData |
| Header-Badge | `totalUnread` | Summe aller unread_count |
| document.title | `totalUnread` | useEffect bei Änderung |
| Favicon-Badge | `useFaviconBadge(totalUnread)` | Canvas-Overlay |
| OS-Notification | `notify()` | SSE + loadData Polling |

### Datenfluss

```
Neue Nachricht eingetroffen
  │
  ├─ SSE steht? ─── Ja ──→ handleMessageSync inkrementiert unread_count
  │                            │
  │                            ▼
  │                     Badge + Titel + Favicon aktualisieren
  │
  └─ SSE tot? ───── Ja ──→ Watchdog reconnectet (max. 15s)
                            │
                            └─ Inzwischen: loadData() erkennt lastActivity-Anstieg
                               → setzt unread_count auf mindestens 1
                                    │
                                    ▼
                             Badge + Titel + Favicon aktualisieren
```

### Reset-Mechanismus

`unread_count` wird **nur** durch folgende Aktionen auf 0 gesetzt:

| Aktion | Auslöser |
|--------|----------|
| `handleSelect` | Nutzer klickt auf Chat in Sidebar |
| `handleMarkRead` | ChatView IntersectionObserver (3s Sichtbarkeit) |
| `chat-mark-read` CustomEvent | Von ChatView nach Mark-as-Read gesendet |

## Verifikation

- ✅ TypeScript-Type-Check ohne Fehler
- ✅ Keine neuen Dependencies
- ✅ SSE-Reconnect innerhalb von 15s nach Abbruch
- ✅ Badges erscheinen auch wenn SSE tot (via lastActivity-Fallback)
- ✅ Badges verschwinden nach dem Lesen (markAsRead)
