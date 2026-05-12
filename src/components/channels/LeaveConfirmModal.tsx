import { useState } from 'react';
import { Loader2, LogOut } from 'lucide-react';
import { clsx } from 'clsx';
import * as api from '../../api';
import type { ChatTarget } from '../../types';
import { getCleanName } from '../../utils/subchannels';

export function LeaveConfirmModal({ chat, onClose, onLeft }: {
  chat: ChatTarget;
  onClose: () => void;
  onLeft: () => void;
}) {
  const [leaving, setLeaving] = useState(false);

  const handleLeave = async () => {
    setLeaving(true);
    try {
      await api.quitChannel(chat.id);
      onLeft();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Verlassen fehlgeschlagen');
      setLeaving(false);
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
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
            <LogOut size={28} className="text-amber-500" />
          </div>
          <h3 className="text-lg font-semibold text-surface-900 dark:text-white">Channel verlassen</h3>
          <p className="mt-2 text-sm text-surface-500">
            Möchtest du den Channel <strong>"{getCleanName(chat.name)}"</strong> wirklich verlassen? Du kannst später wieder beitreten.
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
            onClick={handleLeave}
            disabled={leaving}
            className={clsx(
              'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-white transition',
              leaving
                ? 'cursor-not-allowed bg-amber-300'
                : 'bg-amber-500 hover:bg-amber-600',
            )}
          >
            {leaving ? <Loader2 size={16} className="animate-spin" /> : null}
            Verlassen
          </button>
        </div>
      </div>
    </div>
  );
}
