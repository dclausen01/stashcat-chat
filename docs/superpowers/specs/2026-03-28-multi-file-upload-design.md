# Multi-File Upload mit Zähler — Design

**Datum:** 2026-03-28
**Status:** Approved

## Problem

Das Büroklammer-Dropdown erlaubt nur eine einzelne Datei pro Nachricht. User müssen mehrere Dateien umständlich einzeln hochladen.

## Gewünschtes Verhalten

Mehrere Dateien gleichzeitig auswählen → jede Datei als eigene Nachricht, mit Zähler.

## Ablauf

1. User klickt Büroklammer → Dateiauswahl (mehrere Dateien erlaubt)
2. User gibt Text ein (optional)
3. Beim Senden: jede Datei als eigene Nachricht, parallel hochgeladen (Promise.all)
4. Erste Nachricht: `<Text> 1/<total>` + erste Datei
5. Alle weiteren: `<N>/<total>` + jeweilige Datei

## Beispiel

3 Dateien, Text "Hallo Welt":
- Nachricht 1: "Hallo Welt\n1/3" + Datei 1
- Nachricht 2: "2/3" + Datei 2
- Nachricht 3: "3/3" + Datei 3

## Implementierung

### State-Änderungen

| Vorher | Nachher |
|--------|---------|
| `pendingFile: File \| null` | `pendingFiles: File[]` |
| `fileInputRef` ohne `multiple` | `multiple` Attribute hinzufügen |
| `onFileChange`: `files[0]` | Alle Files in `pendingFiles` |

### Zähler-Logik

- `1/${total}` in erster Nachricht (mit User-Text)
- `${N}/${total}` in allen weiteren (ohne User-Text)
- Format: `${index + 1}/${total}` als suffix nach dem Text oder in Klammern

### Fehlerbehandlung

- `Promise.allSettled` statt `Promise.all` — alle Uploads starten, fehlgeschlagene werden gemeldet
- Bei Teilerfolg: bereits hochgeladene Nachrichten bleiben, Fehlermeldung für diejenigen die fehlschlugen
- Button zeigt Loader während irgendein Upload läuft

### Keine UI-Änderungen nötig

- Kein Progress-UI, kein File-List-Preview im Input
- Counter in der Nachricht selbst reicht als Feedback
- Bestehende Text-Input-Zeile bleibt unverändert

## Dateien

- `src/components/MessageInput.tsx` — Stateful-Komponente mit Multi-File-Logik

## Keine Änderungen

- API: `onUpload` wird pro Datei aufgerufen, bleibt wie bisher
- Backend: keine Änderung
- ChatView: keine Änderung
