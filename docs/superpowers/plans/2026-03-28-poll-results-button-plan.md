# Poll Results Button: Direkter Zugang — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Ergebnisse anzeigen" button in the poll list view, next to Archive and Delete.

**Architecture:** One new button in the list item's action area. Visibility determined by current tab + poll properties. Click navigates to PollDetail.

**Tech Stack:** React 19, TypeScript 5.9, `lucide-react` (`PieChart` icon), `clsx`

---

## Files

- Modify: `src/components/PollsView.tsx` — only the list view (`polls.map()` block, ~lines 333-378)

---

## Task 1: Add Results button to poll list

**Files:**
- Modify: `src/components/PollsView.tsx` (~lines 357-378)

- [ ] **Step 1: Import `PieChart` icon**

In the `lucide-react` import at the top of the file, add `PieChart` alongside `BarChart3`:
```tsx
import { BarChart3, Plus, Trash2, Archive, RefreshCw, Loader2, ChevronRight, ChevronLeft, Check, PieChart } from 'lucide-react';
```

- [ ] **Step 2: Add Results button in the list**

In the list item's action area (after `handleArchive`, before `handleDelete`), add:

```tsx
{(tab !== 'invited' || poll.hidden_results === false) && (
  <button
    type="button"
    onClick={(e) => { e.stopPropagation(); setSelectedPoll(poll); }}
    className="rounded-lg p-1.5 text-surface-400 hover:bg-surface-200 hover:text-primary-600 dark:hover:bg-surface-700"
    title={poll.status === 'archived' ? 'Ergebnisse anzeigen (archiviert)' : 'Ergebnisse anzeigen'}
  >
    <PieChart size={15} />
  </button>
)}
```

The `tab` variable is available in the list scope (set at line ~214). The condition `tab !== 'invited' || poll.hidden_results === false` implements:
- "Meine" (`tab === 'mine'`): `tab !== 'invited'` → true → shown
- "Eingeladen" (`tab === 'invited'`): only shown if `hidden_results === false`
- "Archiviert" (`tab === 'archived'`): `tab !== 'invited'` → true → shown

Note: We use `tab` from the outer scope, not from the `poll` object. This is correct since all visible polls in a given tab share the same tab context.

- [ ] **Step 3: Run build to verify**

```bash
npm run build
```

Expected: Exit code 0, no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/PollsView.tsx
git commit -m "feat(polls): add results button to poll list view"
```
