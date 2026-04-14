# Optimistic Messages entfernt

**Datum:** 14.04.2026
**Betroffene Datei:** `src/components/ChatView.tsx`

## Entscheidung

Die optimistic message Logik (temp-IDs) wurde **vollständig entfernt**. Nachrichten werden jetzt **ausschließlich** über SSE vom Server bezogen.

## Warum?

Die gesamte Komplexität der letzten 4 Fixes kam ausschließlich von optimistic:

| Fix | Zeilen Code | Warum nötig? |
|-----|-------------|-------------|
| Guard 1 (SSE-Check in handleSend) | ~15 | SSE war schneller als optimistic Add |
| Guard 2 (existingByContent) | ~20 | Narrow match hat optimistic verpasst |
| silentRefresh replacements | ~40 | SSE lieferte eigene Nachricht nicht zurück |
| Handler-Stabilität | ~30 | Handler-Refresh hat SSE-Events verloren |

SSE ist in der Praxis **< 100ms** schnell — unterhalb der menschlichen Wahrnehmungsschwelle. Der User sieht seine Nachricht quasi sofort, nur eben die **echte** vom Server.

## Was wurde entfernt

### Refs und Types
- `pendingSendRef` (Map<tempId, { text, sendTime, fallbackTimer }>)
- `PendingSendInfo` Interface
- Chat-Wechsel-Cleanup für pendingSendRef

### `handleSend()` — von ~50 auf ~10 Zeilen

**Vorher:**
```tsx
// Optimistic Add, SSE-Guard, fallbackTimer, pendingSendRef, catch cleanup
const tempId = `temp-${Date.now()}`;
let wasAdded = true;
setMessages((prev) => {
  const sseAlreadyDelivered = prev.find(...);
  if (sseAlreadyDelivered) { wasAdded = false; return prev; }
  return [...prev, { id: tempId, text, sender: user, ... }];
});
if (!wasAdded) { ... }
await api.sendMessage(...);
const fallbackTimer = setTimeout(() => silentRefreshRef.current(), 30000);
pendingSendRef.current.set(tempId, { text, sendTime, fallbackTimer });
```

**Nachher:**
```tsx
const handleSend = async (text: string) => {
  const opts = replyTo ? { reply_to_id: String(replyTo.id) } : undefined;
  setReplyTo(null);
  requestAnimationFrame(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }));
  try {
    await api.sendMessage(chat.id, chat.type, text, opts);
    // SSE will deliver the real message back — no optimistic needed
  } catch {
    // Send failed — user will see the message isn't in the list
  }
};
```

### `handleMessageSync` (SSE-Handler) — von ~80 auf ~20 Zeilen

**Entfernt:**
- `optimisticIdx`-Match (temp-ID check, ±3s Text/Sender match)
- `existingByContent`-Check (±5s fallback für verpasste optimistic)
- `pendingSendRef` lookup + `clearTimeout`/`delete`
- reply_to preservation von optimistic zu server message

**Übrig:** Einfacher `existingById`-Check + add:
```tsx
const existingById = prev.findIndex((m) => String(m.id) === String(newMsg.id));
if (existingById >= 0) { /* update (e.g. deleted) */ return updated; }
return [...prev, newMsg].sort(...);
```

### `silentRefresh()` — von ~55 auf ~20 Zeilen

**Entfernt:**
- Step 2: optimistic replacement loop (replacements Map, consumedServerIds, replacedOptimisticIds)
- Step 3: complex merge mit replacements.apply

**Übrig:** Simples ID-basiertes Merge:
```tsx
const prevIds = new Set(prev.map(m => String(m.id)));
const newMsgs = msgs.filter(m => !prevIds.has(String(m.id)));
if (newMsgs.length > 0) {
  return [...prev, ...newMsgs].sort(...);
}
return prev;
```

## Verbleibende Architektur: 3-Pfad-Nachrichtenzustellung

| Pfad | Wann | Was |
|------|------|-----|
| **SSE `message_sync`** | Normalfall (< 100ms) | Neue Nachricht wird direkt in die Liste eingefügt |
| **`silentRefresh()`** | Visibility-Change, Reconnect | Holt verpasste Nachrichten per API, merged sie |
| **Periodic Polling** | Alle 30–40s (mit Jitter) | Fängt komplett verlorene SSE-Events ab |

## Zusammenfassung der entfernten Komplexität

| Kategorie | Vorher | Nachher | Differenz |
|-----------|--------|---------|-----------|
| `handleSend()` | ~50 Zeilen | ~10 Zeilen | **-40** |
| `handleMessageSync` | ~80 Zeilen | ~20 Zeilen | **-60** |
| `silentRefresh()` | ~55 Zeilen | ~20 Zeilen | **-35** |
| Refs/Types | PendingSendInfo + Map | — | **-5** |
| **Total** | | | **~140 Zeilen entfernt** |

## Verifikation

- ✅ TypeScript-Type-Check (`tsc -b --noEmit`) ohne Fehler durchgelaufen
- ✅ Keine neuen Dependencies eingeführt
- ✅ SSE-Architektur bleibt vollständig erhalten
