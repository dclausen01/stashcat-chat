# Sending-Indicator Bugfix & Schnelleres Fallback

**Datum:** 15.04.2026
**Betroffene Datei:** `src/components/ChatView.tsx`

## Problem

Beim Senden einer Nachricht wurde die „Wird gesendet…"-Bubble nur sehr kurz
(< 1 s) angezeigt und verschwand dann wieder — die echte Nachricht tauchte
aber erst mehrere Sekunden (bis zu 30 s) später auf. UX-seitig entstand eine
unschöne Lücke.

## Ursache

`handleSend()` hatte einen `finally`-Block, der den Sending-Indicator
**sobald die HTTP-Response von `api.sendMessage()` zurückkam** löschte:

```tsx
try {
  await api.sendMessage(chat.id, chat.type, text, opts);
} catch { … }
finally {
  clearTimeout(timeoutId);
  sendingTextsRef.current.delete(text);   // ← zu früh!
  setSendingTexts([...sendingTextsRef.current]);
}
```

Die HTTP-Response bestätigt aber nur, dass der Server die Nachricht
angenommen hat — **nicht**, dass sie in der Nachrichtenliste sichtbar ist.
Die Sichtbarkeit hängt davon ab, wann SSE `message_sync` zurück liefert,
was in der Praxis (insb. nach Standby, im BBZ-Netz, auf Windows) signifikant
verzögert sein kann oder komplett ausfällt.

### Zeitachse vorher

| t | Event |
|---|---|
| 0 ms | User drückt Enter → Bubble erscheint |
| ~500 ms | HTTP-Response → `finally` räumt auf → **Bubble verschwindet** |
| 100 ms – 30 s | SSE echot irgendwann die echte Nachricht |
| Worst case 30 s | 30-s-Polling holt sie ab |

## Fix

Zwei Änderungen in `handleSend()`:

### 1. Kein `finally`-Block mehr

Der Success-Pfad lässt den Indicator bewusst stehen. Er wird nur durch
**zwei legitime Ereignisse** gelöscht:

- `handleMessageSync` findet die eigene Nachricht per SSE → Indicator weg
- Hard-Timeout (10 s) läuft aus → Indicator weg

Im `catch` werden Timer + Indicator wie bisher sofort geräumt und der
User bekommt `setSendError(…)` zu sehen.

### 2. Drei-Stufen-Fallback-Timer

Zusätzlich zum 10-s-Hard-Timeout werden jetzt zwei **proaktive**
`silentRefresh()`-Calls bei 2 s und 5 s scheduled:

```tsx
const fastFallbackId = setTimeout(() => {
  if (sendingTextsRef.current.has(text)) silentRefreshRef.current();
}, 2_000);

const midFallbackId = setTimeout(() => {
  if (sendingTextsRef.current.has(text)) silentRefreshRef.current();
}, 5_000);

const hardTimeoutId = setTimeout(() => {
  if (sendingTextsRef.current.has(text)) {
    sendingTextsRef.current.delete(text);
    setSendingTexts([...sendingTextsRef.current]);
    silentRefreshRef.current();
  }
}, 10_000);
```

Jeder Timer prüft, ob der Indicator **noch** gesetzt ist (d. h. SSE hat
noch nicht geliefert). Falls ja: REST-Refresh anstoßen. Falls SSE gesund
ist (< 100 ms), sind alle drei Timer no-ops.

### Zeitachse nachher

| Szenario | Sichtbarkeit |
|----------|--------------|
| SSE gesund | Bubble → echte Nachricht (~100 ms Übergang) |
| SSE träge, Refresh hilft | Bubble → echte Nachricht nach 2 s |
| SSE defekt (Standby) | Bubble 10 s → Refresh macht sie sichtbar |
| Harter Sendefehler | Bubble weg + Fehlermeldung „Nachricht konnte nicht gesendet werden." |

## Warum das keine Duplikate erzeugt

Der alte optimistic-Ansatz hat Nachrichten **lokal** mit temp-IDs in
`messages[]` eingefügt und musste sie dann mit den echten SSE-Echos
deduplizieren — das war die Quelle aller Duplikate-Bugs.

Hier ist der Indicator aber **nur UI-State** (ein String-Set,
`sendingTextsRef`), **kein** Message-Eintrag. Es gibt weiterhin **nur eine
Quelle** für Nachrichten: der Server (via SSE oder `silentRefresh`). Die
Dedup-Logik in `silentRefresh()` und `handleMessageSync` (ID-basiert) bleibt
unverändert simpel und kann keine Duplikate produzieren.

## Verifikation

- Code-Review: `silentRefreshRef` ist vor `handleSend` definiert (Zeile
  611), Timer werden im `catch` cleared, `handleMessageSync` (Zeile 682–689)
  löscht den Indicator beim SSE-Echo.
- `yarn build` lokal nicht lauffähig (keine Netzanbindung für
  `yarn install` in dieser Claude-Code-Umgebung) — muss im Live-Test
  verifiziert werden.
