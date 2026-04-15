# Sending-Indicator: Verbesserte SSE-Detection

**Datum:** 15.04.2026
**Betroffene Datei:** `src/components/ChatView.tsx`

## Problem

Der Sending-Indicator „Wird gesendet…" blieb manchmal stehen, obwohl die
gesendete Nachricht bereits im Chat sichtbar war – insbesondere wenn SSE
schnell antwortete.

## Ursache

Die Detection in `handleMessageSync` prüfte nur den **exakten Text-Match**:

```tsx
if (senderId === userId && newMsg.text) {
  const text = String(newMsg.text);
  if (sendingTextsRef.current.has(text)) {  // ← Nur exakt!
    sendingTextsRef.current.delete(text);
    setSendingTexts([...sendingTextsRef.current]);
  }
}
```

Wenn der Server den Text anders formatiert (Trim, Whitespace, Emoji-Escaping)
oder die Nachricht kein `text`-Feld hatte (z.B. nur Attachment), wurde der
Indicator **nicht** entfernt.

## Fix

Erweiterte Detection-Logik mit Fallback auf ältesten pending Indicator:

```tsx
if (senderId === userId && sendingTextsRef.current.size > 0) {
  const text = String(newMsg.text ?? '');
  // Try exact match first
  if (text && sendingTextsRef.current.has(text)) {
    sendingTextsRef.current.delete(text);
    setSendingTexts([...sendingTextsRef.current]);
  } else if (!text || !sendingTextsRef.current.has(text)) {
    // No exact match (formatting differences, attachments, etc.) —
    // but our own message arrived: remove the oldest pending indicator
    const oldest = [...sendingTextsRef.current][0];
    if (oldest) {
      sendingTextsRef.current.delete(oldest);
      setSendingTexts([...sendingTextsRef.current]);
    }
  }
}
```

**Logik:**
1. Exakter Match → löschen
2. Kein Match, aber eigene Nachricht in diesem Chat → ältesten pending löschen

## Verifikation

- TypeScript-Kompilierung erfolgreich
- Live-Test: Indicator verschwindet sofort bei SSE-Echo, unabhängig von
  Textformatierung
