# Sending-Indicator Cleanup beim Chatwechsel

**Datum:** 15.04.2026
**Betroffene Datei:** `src/components/ChatView.tsx`

## Problem

Die „Wird gesendet…"-Bubble blieb beim Wechseln des Chats hängen und war im
neuen Chat sichtbar, obwohl sie für den vorherigen Chat gedacht war.

## Ursache

Beim Chatwechsel (ChatView-Mounting) wurden diverse States zurückgesetzt:
`searchMatchIdx`, `searchOpen`, `searchQuery`, `lastMarkedMsgIdRef` etc.
— aber **nicht** `sendingTexts` und `sendingTextsRef.current`.

Wenn der User also:
1. Eine Nachricht sendet (Bubble erscheint)
2. Sofort den Chat wechselt
3. Das SSE-Echo noch nicht zurückgekommen ist

…dann blieb die Animation im neuen Chat sichtbar.

## Fix

Neuer Cleanup-UseEffect beim Chatwechsel:

```tsx
// Clear sending indicators when switching chats
useEffect(() => {
  sendingTextsRef.current.clear();
  setSendingTexts([]);
}, [chat.id]);
```

## Verifikation

- TypeScript-Kompilierung erfolgreich (`tsc --noEmit -p tsconfig.app.json`)
- Chatwechsel zeigt keine hängenden Sending-Indikatoren mehr
