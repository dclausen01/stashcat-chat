import { useState } from 'react';
import { Loader2, X, Type } from 'lucide-react';
import { clsx } from 'clsx';
import * as api from '../../api';
import type { ChatTarget } from '../../types';
import { getCleanName, getParentId, encodeSubchannelName } from '../../utils/subchannels';
import { getErrorMessage } from '../../utils/errorMessage';
import MobileSheet from '../MobileSheet';

export function RenameChannelModal({ chat, onClose, onRenamed }: {
  chat: ChatTarget;
  onClose: () => void;
  onRenamed: (newName: string) => void;
}) {
  const [name, setName] = useState(getCleanName(chat.name));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) { setError('Name darf nicht leer sein'); return; }
    if (!chat.company_id) { setError('Keine company_id vorhanden'); return; }
    setSaving(true);
    setError('');
    try {
      const parentId = getParentId(chat.name);
      const encodedName = parentId ? encodeSubchannelName(trimmed, parentId) : trimmed;
      await api.editChannel(chat.id, chat.company_id, chat.description || '', encodedName);
      window.dispatchEvent(new CustomEvent('channel-renamed', { detail: { channelId: chat.id, newName: encodedName } }));
      onRenamed(encodedName);
      onClose();
    } catch (err) {
      setError(getErrorMessage(err, 'Umbenennen fehlgeschlagen'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <MobileSheet open onClose={onClose} ariaLabel="Channel umbenennen">
      <div className="relative flex flex-col">
        <div className="flex items-center justify-between border-b border-surface-200 px-6 py-4 dark:border-surface-700">
          <div className="flex items-center gap-2">
            <Type size={18} className="text-primary-500" />
            <h2 className="text-base font-semibold text-surface-900 dark:text-white">Channel umbenennen</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-surface-500 hover:bg-surface-200 dark:hover:bg-surface-700">
            <X size={18} />
          </button>
        </div>
        <div className="px-6 py-4 space-y-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') onClose(); }}
            autoFocus
            className="w-full rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm text-surface-900 outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 dark:border-surface-600 dark:bg-surface-800 dark:text-white"
          />
          {error && (
            <p className="text-sm text-red-500">{error}</p>
          )}
        </div>
        <div className="flex gap-2 px-6 pb-5">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-surface-300 px-4 py-2 text-sm font-medium text-surface-700 transition hover:bg-surface-200 dark:border-surface-600 dark:text-surface-300 dark:hover:bg-surface-800"
          >
            Abbrechen
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className={clsx(
              'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-white transition',
              saving || !name.trim() ? 'cursor-not-allowed bg-primary-300' : 'bg-primary-600 hover:bg-primary-700',
            )}
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : null}
            Umbenennen
          </button>
        </div>
      </div>
    </MobileSheet>
  );
}
