# Fix-Protokoll

## 2026-04-03 — Dateiupload: Drag & Drop und Upload-Reihenfolge

### Bug 1: Drag & Drop aus dem System-Datei-Explorer funktionierte nicht

**Problem:** Beim Ablegen einer Datei aus dem Betriebssystem-Dateimanager in den Chat-Bereich wurde der Drop-Overlay korrekt angezeigt, die Datei wurde jedoch nicht im Eingabefeld als ausstehender Anhang eingetragen. Der Grund: `ChatView.tsx` rief `handleUpload()` direkt auf und umging dabei die `pendingFiles`-Verwaltung in `MessageInput.tsx` vollständig.

**Fix:** Der `onDrop`-Handler in `ChatView.tsx` wurde geändert. Anstatt die Datei sofort hochzuladen, werden die gedropten Dateien nun per `droppedFiles`-Prop an `MessageInput` weitergereicht. `MessageInput` nimmt sie per `useEffect` in seine `pendingFiles`-Liste auf. Die Datei erscheint danach korrekt als Anhang im Eingabefeld, bevor sie (ggf. mit Text) abgesendet wird.

**Betroffene Dateien:**
- `src/components/ChatView.tsx`
- `src/components/MessageInput.tsx`

---

### Bug 2: Beim Upload mehrerer Dateien falsche Reihenfolge und fehlende Einzelübersicht

**Problem:** Mehrere ausstehende Dateien wurden mit `Promise.allSettled` parallel hochgeladen. Da parallele Uploads in beliebiger Reihenfolge abschließen können, stimmte die Reihenfolge der Nachrichten im Chat nicht mit der gewählten Reihenfolge überein (Datei 2 erschien vor Datei 1). Außerdem zeigte das Anhang-Preview nur „N Dateien ausgewählt", was es unmöglich machte, versehentlich doppelt hinzugefügte Dateien zu erkennen.

**Fix:**
1. **Sequentieller Upload:** `Promise.allSettled` wurde durch eine `for`-Schleife mit `await` ersetzt, sodass Dateien garantiert in der richtigen Reihenfolge (i=0 zuerst) hochgeladen werden.
2. **Einzelne Datei-Previews:** Das Anhang-Preview zeigt nun jede Datei einzeln mit Name, Dateigröße und einem individuellen ✕-Button zum Entfernen.

**Betroffene Dateien:**
- `src/components/MessageInput.tsx`
