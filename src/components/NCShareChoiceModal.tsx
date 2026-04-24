import { useState } from 'react';
import { X, Link2, Paperclip, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import * as api from '../api';

interface NCShareChoiceModalProps {
  fileName: string;
  ncPath: string;
  /** File object from drag-drop; if not provided, file will be downloaded */
  file?: File;
  chatId: string;
  chatType: 'channel' | 'conversation';
  onClose: () => void;
  onSent: () => void;
}

type Mode = 'link' | 'attach';

export default function NCShareChoiceModal({
  fileName,
  ncPath,
  file,
  chatId,
  chatType,
  onClose,
  onSent,
}: NCShareChoiceModalProps) {
  const [mode, setMode] = useState<Mode>('link');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setLoading(true);
    setError(null);
    try {
      if (mode === 'link') {
        // Share as public link
        const { url } = await api.ncShare(ncPath);
        await api.sendMessage(chatId, chatType, `📎 ${fileName}\n${url}`);
      } else {
        // Download from Nextcloud and attach as file
        let fileToUpload: File;

        if (file) {
          // File already provided via drag-drop
          fileToUpload = file;
        } else {
          // Need to download first
          const url = api.ncDownloadUrl(ncPath);
          const response = await fetch(url);
          if (!response.ok) throw new Error(`Download fehlgeschlagen: ${response.status}`);
          const blob = await response.blob();
          const contentType = response.headers.get('content-type') || 'application/octet-stream';
          fileToUpload = new File([blob], fileName, { type: contentType });
        }

        // uploadFile uploads + sends the file to the chat in one call
        await api.uploadFile(chatType, chatId, fileToUpload);
      }

      onSent();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unbekannter Fehler');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-96 max-w-[90vw] rounded-xl border border-surface-200 bg-surface-50 shadow-xl dark:border-surface-700 dark:bg-surface-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center gap-2 border-b border-surface-200 px-4 py-3 dark:border-surface-700">
          <Link2 size={16} className="text-teal-600 dark:text-teal-400" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-surface-900 dark:text-white">Datei teilen</p>
            <p className="truncate text-xs text-surface-500">{fileName}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-surface-500 hover:bg-surface-200 dark:hover:bg-surface-700"
          >
            <X size={16} />
          </button>
        </div>

        {/* Mode selection */}
        <div className="space-y-2 p-4">
          <p className="text-sm text-surface-700 dark:text-surface-300">Wie möchtest du die Datei teilen?</p>

          <label className={clsx(
            'flex cursor-pointer items-center gap-3 rounded-lg border-2 p-3 transition',
            mode === 'link'
              ? 'border-teal-500 bg-teal-50 dark:bg-teal-950/30'
              : 'border-surface-200 hover:border-surface-300 dark:border-surface-700 dark:hover:border-surface-600',
          )}>
            <input
              type="radio"
              name="share-mode"
              checked={mode === 'link'}
              onChange={() => setMode('link')}
              className="accent-teal-600"
            />
            <Link2 size={18} className={mode === 'link' ? 'text-teal-600 dark:text-teal-400' : 'text-surface-400'} />
            <div className="flex-1">
              <p className="text-sm font-medium text-surface-800 dark:text-surface-100">Öffentlicher Link</p>
              <p className="text-xs text-surface-500">Erstellt einen Nextcloud-Freigabelink</p>
            </div>
          </label>

          <label className={clsx(
            'flex cursor-pointer items-center gap-3 rounded-lg border-2 p-3 transition',
            mode === 'attach'
              ? 'border-teal-500 bg-teal-50 dark:bg-teal-950/30'
              : 'border-surface-200 hover:border-surface-300 dark:border-surface-700 dark:hover:border-surface-600',
          )}>
            <input
              type="radio"
              name="share-mode"
              checked={mode === 'attach'}
              onChange={() => setMode('attach')}
              className="accent-teal-600"
            />
            <Paperclip size={18} className={mode === 'attach' ? 'text-teal-600 dark:text-teal-400' : 'text-surface-400'} />
            <div className="flex-1">
              <p className="text-sm font-medium text-surface-800 dark:text-surface-100">Datei direkt anhängen</p>
              <p className="text-xs text-surface-500">Datei wird hochgeladen und angehängt</p>
            </div>
          </label>

          {error && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-950/30 dark:text-red-400">
              {error}
            </p>
          )}

          <div className="flex gap-2 pt-2">
            <button
              onClick={onClose}
              className="flex-1 rounded-lg border border-surface-300 px-3 py-2 text-sm font-medium text-surface-700 transition hover:bg-surface-100 dark:border-surface-600 dark:text-surface-200 dark:hover:bg-surface-800"
            >
              Abbrechen
            </button>
            <button
              onClick={handleConfirm}
              disabled={loading}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-teal-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-teal-700 disabled:opacity-50"
            >
              {loading && <Loader2 size={14} className="animate-spin" />}
              {loading ? 'Wird gesendet…' : 'Teilen'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
