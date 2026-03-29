# Poll-Abstimmung: Eine Schaltfläche am Ende

**Datum:** 2026-03-28
**Status:** Draft

## Problem

In `PollsView.tsx` steht die "Abstimmen"-Schaltfläche innerhalb der `.map()`-Schleife für Fragen (Zeile 168). Dadurch erscheint sie unter **jeder** Frage — bei 3 Fragen also 3x.

## Gewünschtes Verhalten

Nur **eine** Schaltfläche am Ende der letzten Frage. Alle selektierten Antworten werden auf einmal abgestimmt.

## Lösung

### Layout (nach Änderung)

```
Frage 1: [Antworten]        → Ergebnis-Balken oder "✓ Stimme abgegeben"
Frage 2: [Antworten]
Frage 3: [Antworten]

[  Abstimmen  ]  ← Eine Schaltfläche, am Ende der Fragenliste
```

### Logik

- `submitting: string | null` → `submitting: boolean`
- `submitted: Set<string>` → `allSubmitted: boolean`
- Neue Funktion `submitAll()`:
  - Sammelt alle Fragen mit mindestens einer Auswahl
  - Prüft: sind **alle** Fragen beantwortet? → Button enabled
  - Führt `Promise.all([submitPollAnswer(...) for each question])` aus
  - Bei vollem Erfolg: `allSubmitted = true`
  - Bei Teilfehler: Fehlermeldung, bereits erfolgreiche Stimmen bleiben, User kann erneut klicken

### Validierung

- Button disabled (keine Auswahl) bis **alle** Fragen mindestens eine Auswahl haben
- Alternativ-UX: Button immer enabled, aber visuell warnen wenn noch nicht alle beantwortet → dafür ist die_spec zu klein

### Änderungen in `PollDetail`

| Vorher | Nachher |
|--------|---------|
| Button in `questions.map()` (Zeile 168) | Button nach der Schleife |
| `submitting: string \| null` | `submitting: boolean` |
| `submitted: Set<string>` | `allSubmitted: boolean` |
| `submitQuestion(q)` | `submitAll()` |

## Dateien

- `src/components/PollsView.tsx` — `PollDetail`-Komponente

## Keine Änderungen

- API: `submitPollAnswer` bleibt wie bisher (pro Frage ein Call)
- Backend: keine Änderung
- Andere Komponenten: keine Änderung
