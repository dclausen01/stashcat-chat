# silentRefresh Duplicate-Fix

**Datum:** 14.04.2026
**Betroffene Datei:** `src/components/ChatView.tsx`

## Problem

Eigene Nachrichten wurden **doppelt** angezeigt (optimistic + echte Nachricht), bis der User den Chat verließ und zurückkam. Das passierte, wenn SSE die eigene Nachricht **nicht** an den Sender zurücklieferte.

## Ursache

`silentRefresh()` (30s-Fallback, periodic polling, reconnect) merge't neue Server-Nachrichten per ID-Dedup:

```tsx
const prevIds = new Set(prev.map(m => String(m.id)));
const newMsgs = msgs.filter(m => !prevIds.has(String(m.id)));
// merged = [...prev, ...newMsgs]
```

Szenario:
1. User sendet Nachricht → optimistic mit `temp-123` wird hinzugefügt
2. `api.sendMessage()` erfolgreich
3. SSE liefert **nicht** zurück (manche Server broadcasten nicht an den Sender, oder Handler verpasst)
4. 30s-Fallback → `silentRefresh()` holt die echte Nachricht (neue ID)
5. Echte Nachricht hat andere ID → wird gemerged
6. Optimistic (`temp-123`) wird **nicht entfernt** → **DUPlikAT!**

## Fix

`silentRefresh()` prüft jetzt in **Step 2**, ob eine neue Server-Nachricht per Inhalt (Text + Sender ±5s) mit einer optimistischen Nachricht matcht. Wenn ja:

1. Optimistic wird durch Server-Version **ersetzt**
2. Fallback-Timer der optimistic wird gecleared
3. Server-Nachricht wird vom `newMsgs` entfernt (nicht nochmal gemerged)
4. Nur verbleibende `newMsgs` (die keine Match hatten) werden angehängt

```tsx
// Step 2: Check if any server message matches an optimistic temp message
const replacements = new Map<number, Message>(); // optimisticIdx → serverMsg
const consumedServerIds = new Set<string>();
const replacedOptimisticIds = new Set<string>(); // temp IDs already replaced
for (let i = 0; i < newMsgs.length; i++) {
  const serverMsg = newMsgs[i];
  if (consumedServerIds.has(String(serverMsg.id))) continue;
  const optimisticIdx = prev.findIndex((m) => {
    if (!String(m.id).startsWith('temp-')) return false;
    if (replacedOptimisticIds.has(String(m.id))) return false;
    if (String(m.sender?.id) !== serverSenderId) return false;
    if (m.text !== serverText) return false;
    return Math.abs((Number(m.time) || 0) - serverTime) <= 5;
  });
  if (optimisticIdx >= 0) {
    // Replace optimistic with server version, clear timer
    replacements.set(optimisticIdx, serverMsg);
    consumedServerIds.add(String(serverMsg.id));
    replacedOptimisticIds.add(String(tempId));
  }
}

// Step 3: Apply replacements + merge remaining
let merged = prev.map((m, idx) => replacements.get(idx) ?? m);
if (remainingNewMsgs.length > 0) {
  merged = [...merged, ...remainingNewMsgs];
}
```

## Drei-Pfad-Architektur für eigene Nachrichten

| Pfad | Wann | Was |
|------|------|-----|
| SSE `message_sync` | SSE liefert Nachricht zurück (< 3s) | `handleMessageSync` matched optimistic, ersetzt sie |
| `silentRefresh()` | 30s-Fallback, periodic polling, reconnect | Ersetzt optimistic per Content-Match (±5s) |
| Guard in `handleSend` | SSE war schneller als optimistic Add | Überspringt optimistic komplett |

## Verifikation

- ✅ TypeScript-Type-Check (`tsc -b --noEmit`) ohne Fehler durchgelaufen
