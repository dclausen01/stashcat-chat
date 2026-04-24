import { useState } from 'react';
import { X, Link2, Paperclip, Loader2, KeyRound, RefreshCw } from 'lucide-react';
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

/** Generate a short random password: 5 chars, letters + digits only */
function generatePassword(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let pw = '';
  for (let i = 0; i < 5; i++) {
    pw += chars[Math.floor(Math.random() * chars.length)];
  }
  return pw;
}

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

  // Share password state
  const [useAutoPassword, setUseAutoPassword] = useState(true);
  const [sharePassword, setSharePassword] = useState(() => generatePassword());

  async function handleConfirm() {
    setLoading(true);
    setError(null);
    try {
      if (mode === 'link') {
        // Share as public link (with optional password)
        const { url } = await api.ncShare(ncPath, sharePassword);
        const passwordLine = sharePassword ? `\n🔑 Passwort: ${sharePassword}` : '';
        await api.sendMessage(chatId, chatType, `📎 ${fileName}\n🔗 ${url}${passwordLine}`);
      } else {
        // Download from Nextcloud and attach as file
        let fileToUpload: File;

        if (file) {
          fileToUpload = file;
        } else {
          const url = api.ncDownloadUrl(ncPath);
          const response = await fetch(url);
          if (!response.ok) throw new Error(`Download fehlgeschlagen: ${response.status}`);
          const blob = await response.blob();
          const contentType = response.headers.get('content-type') || 'application/octet-stream';
          fileToUpload = new File([blob], fileName, { type: contentType });
        }

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

          {/* Share password options — only shown in link mode */}
          {mode === 'link' && (
            <div className="space-y-2 rounded-lg border border-surface-200 bg-surface-100 p-3 dark:border-surface-700 dark:bg-surface-800">
              <div className="flex items-center gap-2">
                <KeyRound size={14} className="text-surface-500" />
                <span className="text-xs font-medium text-surface-600 dark:text-surface-400">Link-Passwort</span>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => { setUseAutoPassword(true); setSharePassword(generatePassword()); }}
                  className={clsx(
                    'flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition',
                    useAutoPassword
                      ? 'bg-teal-600 text-white'
                      : 'bg-surface-200 text-surface-600 dark:bg-surface-700 dark:text-surface-400 hover:bg-surface-300 dark:hover:bg-surface-600',
                  )}
                >
                  Auto generieren
                </button>
                <button
                  onClick={() => setUseAutoPassword(false)}
                  className={clsx(
                    'flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition',
                    !useAutoPassword
                      ? 'bg-teal-600 text-white'
                      : 'bg-surface-200 text-surface-600 dark:bg-surface-700 dark:text-surface-400 hover:bg-surface-300 dark:hover:bg-surface-600',
                  )}
                >
                  Eigenes Passwort
                </button>
              </div>

              {useAutoPassword ? (
                <div className="flex items-center gap-2 rounded-md bg-surface-200 px-3 py-2 dark:bg-surface-700">
                  <span className="flex-1 font-mono text-sm font-semibold tracking-widest text-surface-700 dark:text-surface-200">
                    {sharePassword}
                  </span>
                  <button
                    onClick={() => setSharePassword(generatePassword())}
                    className="rounded p-1 text-surface-500 hover:bg-surface-300 dark:hover:bg-surface-600"
                    title="Neu generieren"
                  >
                    <RefreshCw size={13} />
                  </button>
                </div>
              ) : (
                <input
                  type="text"
                  value={sharePassword}
                  onChange={(e) => setSharePassword(e.target.value)}
                  placeholder="Passwort eingeben"
                  className="w-full rounded-md border border-surface-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-teal-500 dark:border-surface-600 dark:bg-surface-900 dark:text-surface-100 dark:placeholder-surface-500"
                />
              )}
            </div>
          )}

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
              disabled={loading || (mode === 'link' && !sharePassword.trim())}
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
