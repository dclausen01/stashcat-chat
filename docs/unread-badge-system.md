# Unread-Badge-System

**Stand:** 2026-04-23 (aktualisiert nach Unread-Signale-Fix vom 22.04.)

Ausführliche Dokumentation: `docs/2026-04-22 Unread-Signale-Fix.md`

## Architektur

Unread-Counts kommen aus zwei Quellen:

| Quelle | Wann | Zuverlässigkeit |
|--------|------|----------------|
| SSE `message_sync` → `handleMessageSync` in Sidebar | Echtzeit | Hoch |
| `loadData()` alle 60 s → API-Feld `unread` | Fallback | Hoch |

Stashcat-API: Unread-Count steht im Feld **`unread`** (top-level), nicht in `unread_count` (immer 0). Gilt für Channels **und** Conversations.

## Reset-Mechanismus

`unread_count` wird **nur** durch diese Aktionen auf 0 gesetzt:

| Aktion | Auslöser |
|--------|----------|
| `handleSelect` | Klick auf Chat in der Sidebar |
| `handleMarkRead` | ChatView `chat-mark-read`-Event (IntersectionObserver, 3 s Sichtbarkeit) |

## Entfernte Mechanismen (nicht mehr vorhanden)

| Mechanismus | Entfernt weil |
|------------|---------------|
| `verifyUnreadCounts()` | `msg.unread` ist im `/message/content`-API immer `false` |
| `localStorage` lastRead-Tracking | Workaround, der nicht geholfen hat |
| serverseitige `lastReadTimestamps` | Bei Server-Restart verloren, unnötig |
| `hasNewActivity`-Logik in `loadData()` | Fälschlich eigene Nachrichten als ungelesen gezählt |

## Signals

| Signal | Quelle |
|--------|--------|
| Sidebar-Badge | `chat.unread_count` |
| `(N)` im document.title | `totalUnread` (Summe aller) |
| Roter Punkt im Favicon | `useFaviconBadge(totalUnread)` |
| OS-Notification | `notify()` aus SSE + `loadData()` |
