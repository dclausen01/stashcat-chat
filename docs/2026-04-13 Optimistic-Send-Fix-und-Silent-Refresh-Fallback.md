# Optimistic-Send-Fix & Silent-Refresh-Fallback

**Datum:** 13.04.2026
**Betroffene Datei:** `src/components/ChatView.tsx`

## Anlass

Zwei Probleme traten beim Senden von Nachrichten auf:

1. **Chat-Flackern:** Nach ein paar Sekunden im Chat sah es aus, als würde die Nachrichtenliste kurz neu laden (flackert)
2. **Doppelte eigene Nachrichten (Windows):** Eigene Nachrichten wurden kurzzeitig doppelt angezeigt, verschwanden dann nach Chat-Wechsel

---

## Fix 1: Send-Timeout-Fallback von `loadMessages()` auf `silentRefresh()`

### Problem

Der 15-Sekunden-Timeout in `handleSend()` rief bei ausbleibender SSE-Zustellung `loadMessages()` auf:

```tsx
// Vorher
const fallbackTimer = setTimeout(() => {
  pendingSendRef.current.delete(tempId);
  loadMessages();  // ← Vollständiger Reload mit Loading-Spinner → Flackern!
}, 15000);
```

`loadMessages()` setzt `loading = true`, löscht die Nachrichtenliste und lädt alles neu → **visuelles Flackern**, Scroll-Position geht verloren.

### Fix

Auf `silentRefresh()` umgestellt, Timeout auf 30s verlängert:

```tsx
// Nachher
const fallbackTimer = setTimeout(() => {
  pendingSendRef.current.delete(tempId);
  silentRefreshRef.current();  // ← Kein Spinner, kein Scroll-Reset, nur Merge
}, 30000);
```

**Warum 30s:** Der 30s-Polling-Fallback deckt es sowieso ab — der send-spezifische Timer ist nur ein Safety-Net für den Sonderfall, dass SSE komplett ausfällt. 30s gibt SSE mehr Zeit und verhindert doppelte Calls.

---

## Fix 2: Doppelte eigene Nachrichten (Race Condition)

### Ursachenanalyse

Auf schnellen Verbindungen (insbesondere Windows) kann die SSE-Zustellung **vor** dem optimistic Add passieren:

```
Zeitachse:
  t=0    handleSend() startet
  t=50ms api.sendMessage() abgeschlossen
  t=80ms  SSE liefert echte Nachricht → setMessages([...prev, serverMsg])
  t=100ms optimisticMsg wird hinzugefügt → setMessages([...prev, tempMsg])
  Ergebnis: Beide Nachrichten sind in der Liste → DUPlikat!
```

Der SSE-Match-Algorithmus fand die optimistic Nachricht nicht, weil:
- Der `optimisticIdx`-Match (±3s, exakter Text) durch Timing-Abweichungen scheitern kann
- Wenn SSE **vor** dem optimistic Add kommt, existiert die optimistic noch nicht im `prev`-Array

### Fix: Zwei Guards

#### Guard 1: In `handleSend` — SSE-Check vor optimistic Add

```tsx
let wasAdded = true;
setMessages((prev) => {
  const sseAlreadyDelivered = prev.find((m) =>
    !String(m.id).startsWith('temp-') &&  // keine optimistic
    String(m.sender?.id) === userId &&     // eigene Nachricht
    m.text === text &&                     // gleicher Text
    Math.abs((Number(m.time) || 0) - sendTime) <= 10  // ±10s Fenster
  );
  if (sseAlreadyDelivered) {
    wasAdded = false;
    return prev; // SSE hat bereits geliefert — skip optimistic
  }
  // ... optimisticMsg erstellen und hinzufügen
});
```

**Warum im `setMessages`-Callback und nicht gegen `messages`?** `messages` kann stale sein — zwischen dem Render-Zyklus und `handleSend()` könnte SSE bereits eine Nachricht hinzugefügt haben. `setMessages`' `prev` ist immer aktuell.

#### Guard 2: Im SSE-Handler — `existingByContent`-Check

Nachdem der normale `optimisticIdx`-Match (temp-ID + ±3s) fehlgeschlagen ist:

```tsx
// Breiterer Content-Match (±5s)
const existingByContent = prev.findIndex((m) => {
  if (String(m.sender?.id) !== newSenderId) return false;
  if (m.text !== newText) return false;
  return Math.abs(msgTime - newTime) <= 5;
});

if (existingByContent >= 0) {
  const existingMsg = prev[existingByContent];
  if (String(existingMsg.id).startsWith('temp-')) {
    // Optimistic gefunden, die der enge Match verpasst hat → ersetzen
    clearTimeout(pendingInfo.fallbackTimer);
    updated[existingByContent] = newMsg;
    return updated;
  }
  // Echte Nachricht schon da (SSE vor optimistic) → Duplikat vermeiden
  return prev;
}
```

---

## Zusammenfassung der Änderungen

| # | Problem | Lösung |
|---|---------|--------|
| 1 | Flackern durch `loadMessages()` nach 15s | `silentRefresh()` nach 30s — kein Spinner, kein Scroll-Reset |
| 2 | Doppelte eigene Nachrichten (Race Condition) | Guard 1: SSE-Check im `setMessages`-Callback; Guard 2: `existingByContent`-Check im SSE-Handler |

## Verifikation

- ✅ TypeScript-Type-Check (`tsc -b --noEmit`) ohne Fehler durchgelaufen
- ✅ Keine neuen Dependencies eingeführt
- ✅ Bestehende Architektur (optimistic + SSE matching) beibehalten, nur robuster gemacht
