# Channel-Dropdown Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ein ⋮ Dropdown im Chat-Header für Manager mit Zugriff auf Mitglieder, Beschreibung, Export und Löschen.

**Architecture:** Neues `ChannelDropdownMenu`-Component wird in `ChatView` integriert. Ein DELETE-Endpoint wird im Backend hinzugefügt. Eine `exportChatAsMarkdown`-Utility formt Nachrichten als Markdown.

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `server/index.ts` | Modify | Neuer `DELETE /api/channels/:channelId` Endpoint |
| `src/api.ts` | Modify | `deleteChannel(chatId)` Funktion |
| `src/components/ChannelDropdownMenu.tsx` | Create | Dropdown + Delete-Confirm-Modal |
| `src/components/ChatView.tsx` | Modify | Dropdown-Button im Header, State `dropdownOpen` |

---

## Task 1: Server DELETE Endpoint

**Files:**
- Modify: `server/index.ts` (nach Zeile ~385, nach dem PATCH channel Endpoint)

- [ ] **Step 1: DELETE Endpoint hinzufügen**

Füge nach dem `app.patch('/api/channels/:channelId', ...)` Block (ca. Zeile 387) ein:

```typescript
// ── Delete channel ────────────────────────────────────────────────────────────
app.delete('/api/channels/:channelId', async (req, res) => {
  try {
    const client = await getClient(req);
    const { channelId } = req.params;
    await client.deleteChannel(channelId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to delete channel' });
  }
});
```

- [ ] **Step 2: Build test**

Run: `npm run build 2>&1 | grep -E "error TS" | head -5`
Expected: Keine neuen Fehler (nur die bekannten poll-Fehler)

---

## Task 2: API deleteChannel

**Files:**
- Modify: `src/api.ts` (am Ende der Datei, nach `editChannel`)

- [ ] **Step 1: deleteChannel in api.ts einfügen**

```typescript
export async function deleteChannel(channelId: string): Promise<void> {
  const res = await fetchWithAuth(`/api/channels/${channelId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error(await res.text());
}
```

- [ ] **Step 2: Commit**

```bash
git add src/api.ts server/index.ts
git commit -m "feat: add DELETE channel endpoint and api.deleteChannel"
```

---

## Task 3: ChannelDropdownMenu Component

**Files:**
- Create: `src/components/ChannelDropdownMenu.tsx`

- [ ] **Step 1: Komplettes Component schreiben**

```tsx
import { useState, useRef, useEffect } from 'react';
import { MoreVertical, Users, Pencil, Download, Trash2, X, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import * as api from '../api';
import type { ChatTarget, Message } from '../types';

interface ChannelDropdownMenuProps {
  chat: ChatTarget;
  isManager: boolean;
  onOpenMembers: () => void;
  onOpenDescriptionEditor: () => void;
}

function formatDateLabel(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString('de-DE', {
    hour: '2-digit', minute: '2-digit',
  });
}

async function exportChatAsMarkdown(chat: ChatTarget): Promise<void> {
  const msgs = await api.getMessages(chat.type, chat.id, { limit: 9999 });
  const sorted = [...msgs].sort(
    (a, b) => (Number((a as Record<string, unknown>).time) || 0) - (Number((b as Record<string, unknown>).time) || 0)
  );

  const dateExport = new Date().toLocaleDateString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
  const timeStart = sorted.length > 0 ? formatTime(Number((sorted[0] as Record<string, unknown>).time) || 0) : '--:--';
  const timeEnd = sorted.length > 0 ? formatTime(Number((sorted[sorted.length - 1] as Record<string, unknown>).time) || 0) : '--:--';

  const lines: string[] = [];
  lines.push(`# ${chat.name}\n`);
  lines.push(`*Exportiert am ${dateExport} von ${timeStart} bis ${timeEnd}*\n`);
  lines.push('---\n');

  let lastDay = '';

  for (const msg of sorted) {
    const t = Number((msg as Record<string, unknown>).time) || 0;
    const day = formatDateLabel(t);
    const time = formatTime(t);

    if (day !== lastDay) {
      lines.push(`\n### ${day}\n`);
      lastDay = day;
    }

    const author = (msg as Record<string, unknown>).author_name as string || (msg as Record<string, unknown>).author as string || 'Unbekannt';
    const text = (msg as Record<string, unknown>).text as string || '';
    const kind = (msg as Record<string, unknown>).kind as string | undefined;

    if (kind === 'forward') {
      lines.push(`**[${time}] ${author}** (weitergeleitet)\n${text}\n`);
    } else if (kind === 'joined' || kind === 'left' || kind === 'removed') {
      lines.push(`*[System: ${author} ist ${kind === 'joined' ? 'dem Channel beigetreten' : kind === 'left' ? 'ausgetreten' : 'entfernt worden'}]*\n`);
    } else {
      lines.push(`**[${time}] ${author}**\n${text}\n`);

      const reactions = (msg as Record<string, unknown>).reactions as Record<string, number> | undefined;
      if (reactions && Object.keys(reactions).length > 0) {
        const reactionStr = Object.entries(reactions)
          .map(([emoji, count]) => `${emoji} ${count}`)
          .join(' | ');
        lines.push(`Reactions: ${reactionStr}\n`);
      }

      const files = (msg as Record<string, unknown>).files as Array<{ name?: string; url?: string }> | undefined;
      if (files && files.length > 0) {
        for (const f of files) {
          const name = f.name || 'Datei';
          const url = f.url || '#';
          lines.push(`[📎 ${name}](${url})\n`);
        }
      }
    }

    lines.push('---\n');
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${chat.name.replace(/[^a-zA-Z0-9ÄÖÜäöüß0-9_-]/g, '-')}-${dateExport.replace(/\./g, '-')}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function DeleteConfirmModal({ chat, onClose, onDeleted }: {
  chat: ChatTarget;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [countdown, setCountdown] = useState(3);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await api.deleteChannel(chat.id);
      onDeleted();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Löschen fehlgeschlagen');
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="relative w-full max-w-sm rounded-2xl bg-white shadow-2xl dark:bg-surface-900" onClick={e => e.stopPropagation()}>
        <div className="flex flex-col items-center px-6 pt-6 pb-2 text-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
            <Trash2 size={28} className="text-red-500" />
          </div>
          <h3 className="text-lg font-semibold text-surface-900 dark:text-white">Channel löschen</h3>
          <p className="mt-2 text-sm text-surface-500">
            Möchtest du den Channel <strong>"{chat.name}"</strong> wirklich löschen? Alle Nachrichten gehen verloren.
          </p>
        </div>
        <div className="flex gap-2 px-6 pb-6 pt-2">
          <button onClick={onClose} className="flex-1 rounded-lg border border-surface-300 px-4 py-2 text-sm font-medium text-surface-700 transition hover:bg-surface-100 dark:border-surface-600 dark:text-surface-300 dark:hover:bg-surface-800">
            Abbrechen
          </button>
          <button
            onClick={handleDelete}
            disabled={countdown > 0 || deleting}
            className={clsx(
              'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-white transition',
              countdown > 0 || deleting
                ? 'bg-red-300 cursor-not-allowed'
                : 'bg-red-500 hover:bg-red-600'
            )}
          >
            {deleting ? <Loader2 size={16} className="animate-spin" /> : null}
            {countdown > 0 ? `${countdown}s` : 'Jetzt löschen'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ChannelDropdownMenu({ chat, isManager, onOpenMembers, onOpenDescriptionEditor }: ChannelDropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [exporting, setExporting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (!isManager) return null;

  const handleExport = async () => {
    setOpen(false);
    setExporting(true);
    try {
      await exportChatAsMarkdown(chat);
    } catch (err) {
      alert('Export fehlgeschlagen: ' + (err instanceof Error ? err.message : err));
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = () => {
    setOpen(false);
    setShowDeleteModal(true);
  };

  return (
    <>
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setOpen(o => !o)}
          className={clsx(
            'rounded-lg p-2 transition',
            open
              ? 'bg-primary-100 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400'
              : 'text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800'
          )}
          title="Channel-Optionen"
        >
          {exporting ? <Loader2 size={18} className="animate-spin" /> : <MoreVertical size={18} />}
        </button>

        {open && (
          <div className="absolute right-0 top-full z-40 mt-1 w-52 rounded-xl border border-surface-200 bg-white py-1 shadow-xl dark:border-surface-700 dark:bg-surface-800">
            <button
              onClick={() => { setOpen(false); onOpenMembers(); }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-surface-700 transition hover:bg-surface-100 dark:text-surface-200 dark:hover:bg-surface-700"
            >
              <Users size={16} className="text-surface-400" />
              Channel-Mitglieder
            </button>
            <button
              onClick={() => { setOpen(false); onOpenDescriptionEditor(); }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-surface-700 transition hover:bg-surface-100 dark:text-surface-200 dark:hover:bg-surface-700"
            >
              <Pencil size={16} className="text-surface-400" />
              Beschreibung bearbeiten
            </button>
            <button
              onClick={handleExport}
              disabled={exporting}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-surface-700 transition hover:bg-surface-100 disabled:opacity-50 dark:text-surface-200 dark:hover:bg-surface-700"
            >
              <Download size={16} className="text-surface-400" />
              Als Markdown exportieren
            </button>
            <div className="my-1 border-t border-surface-200 dark:border-surface-700" />
            <button
              onClick={handleDelete}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-red-500 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
            >
              <Trash2 size={16} />
              Channel löschen
            </button>
          </div>
        )}
      </div>

      {showDeleteModal && (
        <DeleteConfirmModal
          chat={chat}
          onClose={() => setShowDeleteModal(false)}
          onDeleted={() => {
            setShowDeleteModal(false);
            window.location.reload();
          }}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2: Build test**

Run: `npm run build 2>&1 | grep "ChannelDropdownMenu" || echo "No errors"`
Expected: "No errors"

- [ ] **Step 3: Commit**

```bash
git add src/components/ChannelDropdownMenu.tsx
git commit -m "feat: add ChannelDropdownMenu component with export and delete"
```

---

## Task 4: Integration in ChatView

**Files:**
- Modify: `src/components/ChatView.tsx`

- [ ] **Step 1: Import hinzufügen**

Füge in den Import-Block (nach den anderen Component-Imports) ein:
```tsx
import ChannelDropdownMenu from './ChannelDropdownMenu';
```

- [ ] **Step 2: State-Variable hinzufügen**

Füge nach `const [descEditorOpen, setDescEditorOpen] = useState(false);` (ca. Zeile 85) ein:
```tsx
const [dropdownOpen, setDropdownOpen] = useState(false);
```

- [ ] **Step 3: Dropdown in den Header einfügen**

Füge im Header (nach dem Video-Button, vor dem Members-Button) ein:

```tsx
<ChannelDropdownMenu
  chat={chat}
  isManager={isManager}
  onOpenMembers={() => setMembersOpen(true)}
  onOpenDescriptionEditor={() => setDescEditorOpen(true)}
/>
```

Kontext — einzufügen nach Zeile 493 (nach dem Video-Button `</button>`, vor `{chat.type === 'channel' && (` auf Zeile 494):

```tsx
<ChannelDropdownMenu
  chat={chat}
  isManager={isManager}
  onOpenMembers={() => setMembersOpen(true)}
  onOpenDescriptionEditor={() => setDescEditorOpen(true)}
/>
{chat.type === 'channel' && (
```

- [ ] **Step 4: Build test**

Run: `npm run build 2>&1 | grep -E "error TS|ChannelDropdownMenu" | head -10`
Expected: Keine Fehler bzgl. ChannelDropdownMenu

- [ ] **Step 5: Commit**

```bash
git add src/components/ChatView.tsx
git commit -m "feat: integrate ChannelDropdownMenu in ChatView header"
```

---

## Self-Review Checklist

- [ ] Dropdown nur für Manager sichtbar (isManager check in ChatView)
- [ ] Countdown-Delete-Dialog funktioniert (3 Sekunden)
- [ ] Markdown-Export enthält: Tages-Trenner, Zeit, Autor, Text, Reactions, Datei-Anhänge
- [ ] Bestehende ChannelMembersPanel und ChannelDescriptionEditor werden weitergenutzt
- [ ] `api.deleteChannel` in api.ts und DELETE-Endpoint im Server
