# Silent-Refresh & SSE-Reconnect-Fix (Code-Review-Follow-up)

**Datum:** 13.04.2026
**Betroffene Datei:** `src/components/ChatView.tsx`

## Anlass

Nach Implementierung des SSE-Reconnect-Fixes wurde ein **Code-Review** durchgeführt, das mehrere substanzielle Issues im `silentRefresh()`-Mechanismus und den zugehörigen Timern aufdeckte. Dieser Fix adressiert alle Review-Ergebnisse.

## Review-Ergebnisse & Fixes

### 🔴 1. `markAsRead` für eigene Nachrichten (Race Condition)

**Problem:** `silentRefresh()` rief `api.markAsRead()` für die neueste Nachricht auf — auch wenn diese eine **eigene** (gerade gesendete) Nachricht war. Das ist redundant und potenziell problematisch: Der Server könnte denken, der Client habe fremde Nachrichten bestätigt, die er gar nicht gesehen hat.

**Vorher:**
```tsx
const last = merged[merged.length - 1];
if (last) api.markAsRead(chat.id, chat.type, String(last.id)).catch(() => {});
```

**Nachher:**
```tsx
const last = merged[merged.length - 1];
if (last && String(last.sender?.id) !== userId) {
  api.markAsRead(chat.id, chat.type, String(last.id)).catch(() => {});
}
```

---

### 🔴 2. Chat-Wechsel-Race Condition — stale Timer rufen falschen Chat

**Problem:** Die gestaffelten `setTimeout`-Timer (500ms / 2500ms / 6000ms) und der 30s-Polling-Intervall rufen `silentRefreshRef.current()` auf. Wenn der User **vor Ablauf der Timer** den Chat wechselt, zeigt `chatRef.current` bereits auf den **neuen Chat**. Die stale Timer lösen dann API-Calls für den falschen Chat aus.

**Fix:** `activeChatIdRef` + Guard in `silentRefresh`:
```tsx
const activeChatIdRef = useRef(chat.id);
activeChatIdRef.current = chat.id;

// In silentRefresh:
if (chat.id !== activeChatIdRef.current) return; // stale call — abbrechen
```

---

### 🟠 3. Parallele `silentRefresh`-Aufrufe (visibilitychange + focus Overlap)

**Problem:** Wenn `visibilitychange` und `focus` fast gleichzeitig feuern (passiert beim Restore aus minimiertem Zustand), können bis zu **4** überlappende `silentRefresh`-Calls entstehen (3 gestaffelte + 1 focus). Das verursacht unnötige API-Last.

**Fix:** `refreshingRef` Guard:
```tsx
const refreshingRef = useRef(false);

const silentRefresh = useCallback(async () => {
  if (refreshingRef.current) return;
  refreshingRef.current = true;
  try {
    // ... API call ...
  } finally {
    refreshingRef.current = false;
  }
}, [chat.id, chat.type, userId]);
```

---

### 🟡 4. Polling-Intervall ohne Jitter (Thundering Herd)

**Problem:** Bei vielen offenen Tabs/Instances feuern alle synchron alle 30 Sekunden → Burst-Last auf dem Server.

**Fix:** Zufälliger Jitter von 0–10 Sekunden:
```tsx
const POLL_INTERVAL = 30_000;
const jitter = Math.random() * 10_000;
const intervalId = setInterval(() => {
  if (!document.hidden) {
    silentRefreshRef.current();
  }
}, POLL_INTERVAL + jitter); // 30–40 Sekunden
```

---

### 🟢 5. `requestAnimationFrame` Guard (Konsistenz)

**Problem:** `messagesEndRef.current?.scrollIntoView()` innerhalb von `requestAnimationFrame` war inkonsistent mit der äußeren `containerRef.current`-Prüfung.

**Fix:** Expliziter Guard im Callback:
```tsx
requestAnimationFrame(() => {
  if (messagesEndRef.current) {
    messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }
});
```

---

## Zusammenfassung der Änderungen

| # | Priorität | Problem | Lösung |
|---|-----------|---------|--------|
| 1 | 🔴 Hoch | `markAsRead` für eigene Nachrichten | `userId`-Check vor `markAsRead` |
| 2 | 🔴 Hoch | Stale Timer nach Chat-Wechsel | `activeChatIdRef` + Guard |
| 3 | 🟠 Mittel | Parallele Refresh-Overlaps | `refreshingRef` Guard |
| 4 | 🟡 Niedrig | Thundering Herd beim Polling | 0–10s Jitter |
| 5 | 🟢 Niedrig | Inkonsistenter rAF-Guard | Expliziter Null-Check |

## Verifikation

- ✅ TypeScript-Type-Check (`tsc -b --noEmit`) ohne Fehler durchgelaufen
- ✅ Keine neuen Dependencies eingeführt
- ✅ Bestehende Architektur (Ref-Pattern) beibehalten
