import { useState, useEffect } from 'react';
import { Loader2, Trash2, GitBranch } from 'lucide-react';
import { clsx } from 'clsx';
import * as api from '../../api';
import type { ChatTarget } from '../../types';
import { getCleanName, getParentId } from '../../utils/subchannels';
import { getErrorMessage } from '../../utils/errorMessage';
import MobileSheet from '../MobileSheet';

export function DeleteConfirmModal({ chat, channels, onClose, onDeleted }: {
  chat: ChatTarget;
  channels?: ChatTarget[];
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [countdown, setCountdown] = useState(3);
  const [deleting, setDeleting] = useState(false);
  // 'ask' | 'keep' | 'delete' — only relevant when subchannels exist
  const [subchannelAction, setSubchannelAction] = useState<'ask' | 'keep' | 'delete'>('ask');

  const subchannels = channels?.filter((ch) => getParentId(ch.name) === chat.id) ?? [];
  const hasSubchannels = subchannels.length > 0;

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown(c => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  const handleDelete = async (action: 'keep' | 'delete') => {
    setDeleting(true);
    try {
      if (action === 'keep') {
        for (const sub of subchannels) {
          try {
            await api.editChannel(sub.id, sub.company_id ?? '', sub.description ?? '', getCleanName(sub.name));
          } catch { /* best-effort */ }
        }
      } else if (action === 'delete') {
        for (const sub of subchannels) {
          try { await api.deleteChannel(sub.id); } catch { /* best-effort */ }
        }
      }
      await api.deleteChannel(chat.id);
      window.dispatchEvent(new CustomEvent('channel-deleted', { detail: { channelId: chat.id } }));
      onDeleted();
    } catch (err) {
      alert(getErrorMessage(err, 'Löschen fehlgeschlagen'));
      setDeleting(false);
    }
  };

  if (hasSubchannels && subchannelAction === 'ask') {
    return (
      <MobileSheet open onClose={onClose} ariaLabel="Subkanäle behandeln">
        <div className="relative flex flex-col">
          <div className="flex flex-col items-center px-6 pt-6 pb-2 text-center">
            <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
              <GitBranch size={28} className="text-amber-500" />
            </div>
            <h3 className="text-lg font-semibold text-surface-900 dark:text-white">Subkanäle vorhanden</h3>
            <p className="mt-2 text-sm text-surface-500">
              <strong>"{getCleanName(chat.name)}"</strong> hat {subchannels.length} Subkanal{subchannels.length !== 1 ? 'e' : ''}. Was soll damit geschehen?
            </p>
          </div>
          <div className="flex flex-col gap-2 px-6 pb-6 pt-2">
            <button
              onClick={() => setSubchannelAction('keep')}
              className="w-full rounded-lg border border-surface-300 px-4 py-2 text-sm font-medium text-surface-700 transition hover:bg-surface-100 dark:border-surface-600 dark:text-surface-300 dark:hover:bg-surface-800"
            >
              Subkanäle behalten (entkoppeln)
            </button>
            <button
              onClick={() => setSubchannelAction('delete')}
              className="w-full rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600 transition hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/20"
            >
              Subkanäle mitlöschen
            </button>
            <button
              onClick={onClose}
              className="w-full rounded-lg px-4 py-2 text-sm font-medium text-surface-500 transition hover:bg-surface-100 dark:hover:bg-surface-800"
            >
              Abbrechen
            </button>
          </div>
        </div>
      </MobileSheet>
    );
  }

  return (
    <MobileSheet open onClose={onClose} ariaLabel="Channel löschen">
      <div className="relative flex flex-col">
        <div className="flex flex-col items-center px-6 pt-6 pb-2 text-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
            <Trash2 size={28} className="text-red-500" />
          </div>
          <h3 className="text-lg font-semibold text-surface-900 dark:text-white">Channel löschen</h3>
          <p className="mt-2 text-sm text-surface-500">
            Möchtest du den Channel <strong>"{getCleanName(chat.name)}"</strong> wirklich löschen? Alle Nachrichten gehen verloren.
            {hasSubchannels && subchannelAction === 'delete' && (
              <> Die {subchannels.length} Subkanäle werden ebenfalls gelöscht.</>
            )}
            {hasSubchannels && subchannelAction === 'keep' && (
              <> Die Subkanäle werden entkoppelt und bleiben erhalten.</>
            )}
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
            onClick={() => handleDelete(hasSubchannels ? subchannelAction as 'keep' | 'delete' : 'keep')}
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
    </MobileSheet>
  );
}
