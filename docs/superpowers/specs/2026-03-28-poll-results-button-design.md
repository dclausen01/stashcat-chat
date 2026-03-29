# Poll Results Button: Direkter Zugang zu Ergebnissen aus der Liste

**Datum:** 2026-03-28
**Status:** Draft

## Problem

Aus der Umfragen-Liste gibt es keinen direkten Weg zu den Ergebnissen. Erstellende müssen erst in die Umfrage klicken, dann sehen sie die Ergebnisse. Das ist umständlich wenn man nur schnell die Resultate checken will.

## Gewünschtes Verhalten

Ein "Ergebnisse anzeigen"-Button direkt in der Liste, neben Archivieren und Löschen.

## Lösung

### Button in der Umfragen-Liste

In der List-Ansicht (Zeile ~357 in `PollsView.tsx`) wird ein Results-Button hinzugefügt:

```
[Archive] [Results] [Delete] [>]
```

**Sichtbarkeit:**

| Tab | Results-Button |
|-----|----------------|
| "Meine" (`mine`) | Immer |
| "Eingeladen" (`invited`) | Nur wenn `hidden_results === false` |
| "Archiviert" (`archived`) | Immer |

**Klick-Verhalten:** Öffnet `PollDetail` wie bisher — `PollDetail` zeigt bereits Ergebnisse basierend auf `allSubmitted`, `!active` und `hidden_results`.

**Icon:** `PieChart` von `lucide-react` (oder `BarChart3` — `PieChart` ist treffender für Ergebnisse)

**Tooltips:**
- "Ergebnisse anzeigen"
- Tab "Archiviert": "Ergebnisse anzeigen (archiviert)"

### Keine Logik-Änderung

`PollDetail` zeigt Ergebnisse bereits korrekt:
- `showResults = alreadyVoted || !active || d.hidden_results === false`
- Für Erstellende: Umfrage öffnen → eigene Antworten → Ergebnisse sichtbar
- Für Teilnehmende: Wenn `hidden_results === false` → Ergebnisse nach dem Abstimmen sichtbar

## Dateien

- `src/components/PollsView.tsx` — Listenansicht (`polls.map()`), nur UI-Änderung

## Keine Änderungen

- API: keine
- Backend: keine
- `PollDetail`: keine Änderung nötig
- Andere Komponenten: keine
