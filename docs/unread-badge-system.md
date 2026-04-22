# Unread-Badge-System Dokumentation

## Überblick

Das Unread-Badge-System zeigt in der Sidebar an, wie viele ungelesene Nachrichten in einem Channel vorhanden sind. Diese Badges werden auch an die Electron-App weitergegeben, um das Dock-Icon zu aktualisieren.

## Architektur

### Datenquellen

| Quelle | Zuverlässigkeit | Verwendung |
|--------|----------------|------------|
| `unread_count` aus API-Liste (Channels/Conversations) | Manchmal stale/falsch | Primärer Badge-Wert |
| `msg.unread === true` in Nachrichten | Zuverlässig | "NEU"-Divider in ChatView, Verifikation |

### Bekannte Probleme

- **API-`unread_count` ist manchmal falsch**: Besonders nach Standby/Resume oder wenn Nachrichten im Hintergrund ankommen
- **"NEU"-Divider funktioniert zuverlässig**: Berechnet aus `msg.unread === true` in den geladenen Nachrichten

## Implementierung

### Sidebar.tsx

#### `verifyUnreadCounts()`

**Zweck**: Korrigiert stale `unread_count`-Werte durch Nachprüfung gegen tatsächliche Nachrichten.

**Logik**:
1. Filtere Channels mit `lastActivity < 48h`
2. Für jeden Channel: Lade die ersten 20 Nachrichten
3. Zähle `msg.unread === true`
4. Bei Abweichung zum API-Wert: Aktualisiere Badge

**Ausführung**:
- Alle 60 Sekunden zusammen mit `loadData()`
- Batch-Requests: 5 parallel (Performance-Optimierung)

#### `loadData()`

Lädt alle 60 Sekunden:
1. Channels und Conversations
2. Ruft `verifyUnreadCounts()` auf

### ChatView.tsx

#### "NEU"-Divider

- Berechnet aus `msg.unread === true` in geladenen Nachrichten
- Funktioniert zuverlässig, keine Änderungen nötig

#### Mark-as-Read

- **Nur via IntersectionObserver** (3s Sichtbarkeit)
- Kein automatisches Mark-as-Read beim Laden oder Refresh

## Performance

- **Channels**: ~90 Channels, max ~18 Requests alle 60s (90 / 5 Batch)
- **Conversations**: Keine Verifikation (1000+ Conversations, Problem bisher nicht beobachtet)

## Dateien

- `src/components/Sidebar.tsx` - Badge-Logik und Verifikation
- `src/components/ChatView.tsx` - "NEU"-Divider und Mark-as-Read
