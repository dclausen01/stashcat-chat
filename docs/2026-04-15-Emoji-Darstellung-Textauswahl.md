# Feature-Dokumentation

## 2026-04-15 — Emoji-Darstellung, Textauswahl und personalisierte Typing-Notifications

### Feature 1: Emoji-only Nachrichten werden größer dargestellt

**Beschreibung:** Enthält eine Nachricht ausschließlich ein oder mehrere Emojis (kein Text, keine Datei, kein Reply, kein Forward), wird diese mit `font-size: 5xl` (~3rem) deutlich größer dargestellt.

**Implementierung:**
- Neue Hilfsfunktion `isOnlyEmoji(text)` in `ChatView.tsx` erkennt Emoji-only Nachrichten anhand eines umfangreichen Unicode-Emoji-Regex
- Die Erkennung prüft folgende Bedingungen:
  - Nachricht enthält Text
  - Kein `deleted` oder `is_deleted_by_manager`-Flag
  - Nicht verschlüsselt
  - Kein Reply (keine `reply_to` Referenz)
  - Nicht weitergeleitet
  - Keine Dateien im Anhang
  - Text besteht nur aus Emoji-Zeichen
- Das Emoji-Styling wird in `MarkdownContent` über den neuen `isEmojiOnly`-Prop angewendet

**Betroffene Dateien:**
- `src/components/ChatView.tsx`

---

### Feature 2: Textauswahl in Chat-Bubbles ermöglicht

**Beschreibung:** Benutzer können Text in Chat-Bubbles markieren und kopieren. Die `select-text` CSS-Klasse wurde auf die relevanten Container-Elemente angewendet.

**Implementierung:**
- `MessageGroup` (Bubble-View): `select-text` auf Bubble-Container
- `PlainTextMessage` (Flat-View): `select-text` auf Content-Container

**Betroffene Dateien:**
- `src/components/ChatView.tsx`

---

### Feature 3: Personalisierte Typing-Notifications

**Beschreibung:** Wenn jemand tippt, wird statt "Jemand tippt…" der vollständige Name angezeigt (z.B. "Dennis Clausen tippt…").

**Implementierung:**
- `userNameCacheRef`: Eine Map zwischen `userId` (number) und dem vollständigen Namen
- Der Cache wird beim Laden von Nachrichten (`loadMessages`, `loadOlder`, `silentRefresh`) aus den Sender-Informationen befüllt
- Bei Empfang eines Typing-Events wird versucht, den Namen aus dem Cache zu holen
- Falls der Name nicht im Cache ist (z.B. bei neuen Usern), wird "Jemand tippt…" angezeigt

**Betroffene Dateien:**
- `src/components/ChatView.tsx`
