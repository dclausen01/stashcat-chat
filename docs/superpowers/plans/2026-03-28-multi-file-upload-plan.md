# Multi-File Upload mit Zähler — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Erlaube multiple Dateiauswahl im Büroklammer-Dropdown; jede Datei wird als eigene Nachricht hochgeladen mit Zähler "1/N".

**Architecture:** `pendingFile: File | null` → `pendingFiles: File[]`, `Promise.allSettled` für alle Uploads, Counter in Nachrichtentext.

**Tech Stack:** React 19, TypeScript 5.9

---

## Files

- Modify: `src/components/MessageInput.tsx`

---

## Task 1: Multi-File-Upload implementieren

**Files:**
- Modify: `src/components/MessageInput.tsx`

### Schritte

- [ ] **Step 1: State ändern**

`pendingFile: File | null` → `pendingFiles: File[]`:

```tsx
const [pendingFiles, setPendingFiles] = useState<File[]>([]);
```

- [ ] **Step 2: `fileInputRef` auf `multiple` setzen**

In Zeile ~231:
```tsx
<input
  ref={fileInputRef}
  type="file"
  multiple
  className="hidden"
  onChange={onFilesChange}
/>
```

- [ ] **Step 3: `onFileChange` → `onFilesChange` (mehrere Dateien)**

Ersetze `onFileChange` (ca. Zeile 165):
```tsx
const onFilesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
  const files = Array.from(e.target.files ?? []);
  if (files.length > 0) {
    setPendingFiles((prev) => [...prev, ...files]);
  }
  e.target.value = '';
};
```

- [ ] **Step 4: `canSend` anpassen**

Ersetze Zeile ~171:
```tsx
const canSend = !sending && (pendingFiles.length > 0 || text.trim().length > 0);
```

- [ ] **Step 5: `handleSend` auf Multi-File umbauen**

Ersetze `handleSend` (ca. Zeile 97):
```tsx
const handleSend = async () => {
  if (sending) return;
  if (pendingFiles.length > 0) {
    setSending(true);
    const results = await Promise.allSettled(
      pendingFiles.map((file, i) =>
        onUpload(file, i === 0 ? text.trim() : `${i + 1}/${pendingFiles.length}`)
      )
    );
    const failures = results.filter((r) => r.status === 'rejected');
    if (failures.length > 0) {
      // Some uploads failed — already posted messages stay, show error
      const msg = failures.length === 1
        ? '1 Datei konnte nicht hochgeladen werden.'
        : `${failures.length} Dateien konnten nicht hochgeladen werden.`;
      alert(msg);
    }
    setPendingFiles([]);
    setText('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setSending(false);
  } else {
    const trimmed = text.trim();
    if (!trimmed) return;
    setSending(true);
    try {
      await onSend(trimmed);
      setText('');
    } finally {
      setSending(false);
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
    }
  }
};
```

**Wichtig:** `onUpload(file, text)` wird pro Datei aufgerufen. Die erste Datei bekommt den User-Text, alle weiteren nur den Zähler. Die Counter-Nachricht (z.B. "2/3") wird von `handleSend` generiert — `onUpload` bekommt den fertigen Text.

**Fehlerbehandlung mit `Promise.allSettled`:**
- Alle Uploads starten parallel
- Erfolgreiche werden als Nachrichten gepostet
- Fehlgeschlagene werden gezählt und als `alert` gemeldet
- bereits gepostete Nachrichten bleiben (kein Rollback nötig)

- [ ] **Step 6: `pendingFile`-Referenzen ersetzen**

Suche alle Verwendungen von `pendingFile` im File und ersetze durch `pendingFiles`:

- `pendingFile` in `useState` → `pendingFiles` in `useState`
- `setPendingFile(null)` → `setPendingFiles([])`
- `pendingFile` in `placeholder` → `pendingFiles.length > 0`

- [ ] **Step 7: Build verifizieren**

```bash
npm run build
```

Erwartet: Exit 0, kein TypeScript-Fehler.

- [ ] **Step 8: Commit**

```bash
git add src/components/MessageInput.tsx
git commit -m "feat(message-input): support multi-file upload with 1/N counter"
```
