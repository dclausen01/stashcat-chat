# Poll Submit Button: Single Button at End — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the "Abstimmen" button out of the question loop and place a single button at the end of the questions list.

**Architecture:** Batch-submit all selected answers via parallel `Promise.all`. Button only appears once after the last question, disabled until all questions have at least one selection.

**Tech Stack:** React 19, TypeScript 5.9, `lucide-react` icons, `clsx`

---

## Files

- Modify: `src/components/PollsView.tsx` — `PollDetail` component only

---

## Task 1: Refactor `PollDetail` state and submit logic

**Files:**
- Modify: `src/components/PollsView.tsx:31-190`

- [ ] **Step 1: Remove per-question submitting state**

Change `submitting: string | null` to `submitting: boolean` (line ~36).

- [ ] **Step 2: Replace per-question submitted tracking with global flag**

Change `submitted: Set<string>` to `allSubmitted: boolean` (line ~37).

- [ ] **Step 3: Remove the per-question "Abstimmen" button from inside the map**

In the `questions.map()` block, remove this block (lines 168-177):
```tsx
{active && !alreadyVoted && (
  <button
    onClick={() => submitQuestion(q)}
    disabled={chosen.size === 0 || submitting === q.id}
    className="mt-3 flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
  >
    {submitting === q.id && <Loader2 size={13} className="animate-spin" />}
    Abstimmen
  </button>
)}
```

Also remove the "alreadyVoted" line that shows "Stimme abgegeben" after the button (line 178-180) — keep the checkmark display for already-voted questions, but make sure it shows based on `allSubmitted` or `q.user_answers` for that question, not on per-question state.

- [ ] **Step 4: Refactor `submitQuestion` → `submitAll`**

Replace the `submitQuestion` function (lines 55-68) with `submitAll`:

```tsx
async function submitAll() {
  const unanswered = d.questions?.filter(q => (selections[q.id] ?? []).length === 0) ?? [];
  if (unanswered.length > 0) {
    setError(`Bitte beantworten Sie zuerst alle Fragen (${unanswered.length} fehlen noch).`);
    return;
  }
  setSubmitting(true);
  setError('');
  try {
    await Promise.all(
      (d.questions ?? []).map(q =>
        api.submitPollAnswer(poll.id, q.id, [...(selections[q.id] ?? [])])
      )
    );
    setAllSubmitted(true);
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Fehler beim Abstimmen');
  } finally {
    setSubmitting(false);
  }
}
```

- [ ] **Step 5: Add the single "Abstimmen" button after the questions map**

After `})} />` closing the `questions.map()`, before the `</div>` of `flex-1 overflow-y-auto`, add:

```tsx
{active && !allSubmitted && (
  <div className="sticky bottom-0 border-t border-surface-200 bg-white px-6 py-4 dark:border-surface-700 dark:bg-surface-900">
    <button
      onClick={submitAll}
      disabled={submitting || (d.questions ?? []).some(q => (selections[q.id] ?? []).length === 0)}
      className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
    >
      {submitting && <Loader2 size={15} className="animate-spin" />}
      Abstimmen
    </button>
  </div>
)}
```

- [ ] **Step 6: Show results for all questions after `allSubmitted` is true**

The condition `showResults` (line 113) uses `alreadyVoted || !active || d.hidden_results === false`. Update the `alreadyVoted` variable inside the map to also check `allSubmitted`:

```tsx
const alreadyVoted = (q.user_answers?.length ?? 0) > 0 || allSubmitted;
```

Change `submitted.has(q.id)` to just `allSubmitted` since we now track globally.

- [ ] **Step 7: Fix the "Stimme abgegeben" checkmark display**

The line that shows "Stimme abgegeben" checkmark (line ~179) currently reads:
```tsx
{alreadyVoted && (
  <p className="mt-2 flex items-center gap-1 text-xs text-green-600 dark:text-green-400"><Check size={12} /> Stimme abgegeben</p>
)}
```
Keep this — it now shows for any question that has `alreadyVoted = true` (which includes `allSubmitted`).

- [ ] **Step 8: Commit**

```bash
git add src/components/PollsView.tsx
git commit -m "feat(polls): single submit button at end instead of per-question"
```
