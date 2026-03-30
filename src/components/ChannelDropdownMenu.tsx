import { useState, useRef, useEffect } from 'react';
import { MoreVertical, Users, Pencil, Download, Trash2, Loader2, Info, X, Lock, UsersRound, Clock } from 'lucide-react';
import { clsx } from 'clsx';
import * as api from '../api';
import type { ChatTarget, Channel } from '../types';

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
  const msgs = await api.getMessages(chat.id, chat.type, 9999);
  const sorted = [...msgs].sort(
    (a, b) => (Number((a as Record<string, unknown>).time) || 0) - (Number((b as Record<string, unknown>).time) || 0)
  );

  const dateExport = new Date().toLocaleDateString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
  const timeStart = sorted.length > 0
    ? formatTime(Number((sorted[0] as Record<string, unknown>).time) || 0)
    : '--:--';
  const timeEnd = sorted.length > 0
    ? formatTime(Number((sorted[sorted.length - 1] as Record<string, unknown>).time) || 0)
    : '--:--';

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

    const author = (msg as Record<string, unknown>).author_name as string
      || (msg as Record<string, unknown>).author as string
      || 'Unbekannt';
    const text = (msg as Record<string, unknown>).text as string || '';
    const kind = (msg as Record<string, unknown>).kind as string | undefined;

    if (kind === 'forward') {
      lines.push(`**[${time}] ${author}** (weitergeleitet)\n${text}\n`);
    } else if (kind === 'joined' || kind === 'left' || kind === 'removed') {
      const actionText =
        kind === 'joined' ? 'ist dem Channel beigetreten'
        : kind === 'left' ? 'ist ausgetreten'
        : 'wurde entfernt';
      lines.push(`*[System: ${author} ${actionText}]*\n`);
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

function typeLabel(type: string): string {
  switch (type) {
    case 'closed': return 'Geschlossen';
    case 'public': return 'Öffentlich';
    case 'open': return 'Offen';
    default: return type;
  }
}

function InfoRow({ icon: Icon, label, value }: { icon: typeof Info; label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <Icon size={16} className="mt-0.5 shrink-0 text-surface-500" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-surface-500">{label}</p>
        <p className="mt-0.5 text-sm text-surface-900 dark:text-white break-all">{value ?? '—'}</p>
      </div>
    </div>
  );
}

function ChannelInfoModal({ chat, onClose }: { chat: ChatTarget; onClose: () => void }) {
  const [info, setInfo] = useState<Channel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getChannelInfo(chat.id).then(ch => {
      setInfo(ch);
      setLoading(false);
    }).catch(err => {
      setError(err instanceof Error ? err.message : 'Fehler beim Laden');
      setLoading(false);
    });
  }, [chat.id]);

  const createdStr = info
    ? info.created_at
      ? new Date(Number(info.created_at) * 1000).toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' })
      : info.last_activity
      ? `Zuletzt aktiv: ${new Date(Number(info.last_activity) * 1000).toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' })}`
      : 'Unbekannt'
    : 'Unbekannt';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl dark:bg-surface-900"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-surface-200 px-6 py-4 dark:border-surface-700">
          <div className="flex items-center gap-2">
            <Info size={18} className="text-primary-500" />
            <h2 className="text-base font-semibold text-surface-900 dark:text-white">Channel-Info</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-surface-500 hover:bg-surface-200 dark:hover:bg-surface-700">
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="px-6 py-4">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={24} className="animate-spin text-surface-500" />
            </div>
          )}
          {error && (
            <p className="text-center text-sm text-red-500 py-4">{error}</p>
          )}
          {!loading && !error && info && (
            <div className="space-y-0">
              <div className="mb-4 border-b border-surface-200 pb-4 dark:border-surface-700">
                <h3 className="text-xl font-bold text-surface-900 dark:text-white">{String(info.name || '')}</h3>
                <p className="mt-1">
                  <span className={clsx(
                    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                    info.type === 'closed'
                      ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                      : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
                  )}>
                    {typeLabel(String(info.type || ''))}
                  </span>
                </p>
              </div>

              <InfoRow icon={Lock} label="Verschlüsselung" value={info.encrypted ? `AES 256 (${info.encryption || 'AES'})` : 'Keine'} />
              <InfoRow icon={UsersRound} label="Mitglieder" value={String(info.user_count ?? 0)} />
              <InfoRow icon={Clock} label="Erstellt" value={createdStr} />
              {!!info.description && (
                <InfoRow icon={Info} label="Beschreibung" value={String(info.description)} />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm rounded-2xl bg-white shadow-2xl dark:bg-surface-900"
        onClick={e => e.stopPropagation()}
      >
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
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-surface-300 px-4 py-2 text-sm font-medium text-surface-700 transition hover:bg-surface-200 dark:border-surface-600 dark:text-surface-300 dark:hover:bg-surface-800"
          >
            Abbrechen
          </button>
          <button
            onClick={handleDelete}
            disabled={countdown > 0 || deleting}
            className={clsx(
              'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-white transition',
              countdown > 0 || deleting
                ? 'cursor-not-allowed bg-red-300'
                : 'bg-red-500 hover:bg-red-600',
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

export default function ChannelDropdownMenu({
  chat,
  isManager,
  onOpenMembers,
  onOpenDescriptionEditor,
}: ChannelDropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState(false);
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
              : 'text-surface-500 hover:bg-surface-200 dark:hover:bg-surface-800',
          )}
          title="Channel-Optionen"
        >
          {exporting ? <Loader2 size={18} className="animate-spin" /> : <MoreVertical size={18} />}
        </button>

        {open && (
          <div className="absolute right-0 top-full z-40 mt-1 w-52 rounded-xl border border-surface-200 bg-white py-1 shadow-xl dark:border-surface-700 dark:bg-surface-800">
            <button
              onClick={() => { setOpen(false); onOpenMembers(); }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-surface-700 transition hover:bg-surface-200 dark:text-surface-200 dark:hover:bg-surface-700"
            >
              <Users size={16} className="text-surface-500" />
              Channel-Mitglieder
            </button>
            <button
              onClick={() => { setOpen(false); setShowInfoModal(true); }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-surface-700 transition hover:bg-surface-200 dark:text-surface-200 dark:hover:bg-surface-700"
            >
              <Info size={16} className="text-surface-500" />
              Channel-Info
            </button>
            <button
              onClick={() => { setOpen(false); onOpenDescriptionEditor(); }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-surface-700 transition hover:bg-surface-200 dark:text-surface-200 dark:hover:bg-surface-700"
            >
              <Pencil size={16} className="text-surface-500" />
              Beschreibung bearbeiten
            </button>
            <button
              onClick={handleExport}
              disabled={exporting}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-surface-700 transition hover:bg-surface-200 disabled:opacity-50 dark:text-surface-200 dark:hover:bg-surface-700"
            >
              <Download size={16} className="text-surface-500" />
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
      {showInfoModal && (
        <ChannelInfoModal chat={chat} onClose={() => setShowInfoModal(false)} />
      )}
    </>
  );
}
