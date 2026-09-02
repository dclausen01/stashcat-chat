/**
 * Erstellt und verwaltet einen oeffentlichen Share-Link fuer eine Datei.
 *
 * Beim Oeffnen wird geprueft, ob bereits ein Link existiert (`/share/get`).
 * Falls ja, wird er angezeigt und kann gesperrt, reaktiviert oder geloescht
 * werden — falls nein, laesst sich einer anlegen, optional mit Passwort.
 *
 * Ob Share-Links ueberhaupt erlaubt sind, entscheidet die Company-Einstellung
 * `share_links`. Ist sie aus, meldet die API einen Fehler, der hier angezeigt
 * wird.
 */

import { useCallback, useEffect, useState } from 'react';
import { X, Loader2, AlertCircle, Link2, Copy, Check, Trash2, Lock, Ban, RotateCcw } from 'lucide-react';
import * as api from '../../api';
import type { ShareLink } from '../../api/files';
import type { FileEntry } from './types';
import { useConfirm } from '../../context/ConfirmContext';

interface ShareLinkModalProps {
  file: FileEntry;
  onClose: () => void;
}

export default function ShareLinkModal({ file, onClose }: ShareLinkModalProps) {
  const confirm = useConfirm();
  const target = { fileId: file.id };

  const [share, setShare] = useState<ShareLink | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [password, setPassword] = useState('');
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setShare(await api.getShareLink(target));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Share konnte nicht geladen werden');
      setShare(null);
    } finally {
      setLoading(false);
    }
  // target ist bei gleichem file stabil
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.id]);

  useEffect(() => { void load(); }, [load]);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Aktion fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!share?.url) return;
    try {
      await navigator.clipboard.writeText(share.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard kann in unsicheren Kontexten fehlschlagen — dann bleibt
      // dem Nutzer das manuelle Markieren im Textfeld.
      setError('Kopieren nicht möglich — bitte den Link von Hand markieren.');
    }
  }

  const active = api.isShareActive(share);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-surface-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-surface-200 px-6 py-4 dark:border-surface-700">
          <Link2 size={18} className="text-primary-500" />
          <h2 className="flex-1 truncate text-base font-semibold text-surface-900 dark:text-white">
            Link teilen
          </h2>
          <button
            onClick={onClose}
            aria-label="Schließen"
            className="rounded-lg p-1.5 text-surface-500 hover:bg-surface-200 dark:hover:bg-surface-700"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5">
          <p className="mb-4 truncate text-sm text-surface-600 dark:text-surface-400">{file.name}</p>

          {error && (
            <p className="mb-4 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
              <AlertCircle size={16} className="mt-0.5 shrink-0" /> {error}
            </p>
          )}

          {loading ? (
            <div className="flex justify-center py-6">
              <Loader2 size={22} className="animate-spin text-surface-400" />
            </div>
          ) : share ? (
            <div className="space-y-4">
              <div>
                <span className="mb-1 block text-xs font-medium text-surface-600 dark:text-surface-400">
                  Öffentlicher Link
                </span>
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={share.url ?? ''}
                    onFocus={(e) => e.currentTarget.select()}
                    className="w-full rounded-lg border border-surface-300 bg-surface-50 px-3 py-2 text-sm text-surface-900 dark:border-surface-600 dark:bg-surface-800 dark:text-white"
                  />
                  <button
                    onClick={() => void copyLink()}
                    title="Link kopieren"
                    aria-label="Link kopieren"
                    className="shrink-0 rounded-lg border border-surface-300 px-3 text-surface-600 hover:bg-surface-100 dark:border-surface-600 dark:hover:bg-surface-800"
                  >
                    {copied ? <Check size={16} className="text-green-500" /> : <Copy size={16} />}
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs text-surface-500">
                <span
                  className={
                    active
                      ? 'rounded-full bg-green-100 px-2 py-0.5 font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400'
                      : 'rounded-full bg-surface-100 px-2 py-0.5 font-medium text-surface-600 dark:bg-surface-800 dark:text-surface-400'
                  }
                >
                  {active ? 'Aktiv' : 'Gesperrt'}
                </span>
                {Boolean(share.protected) && (
                  <span className="flex items-center gap-1"><Lock size={11} /> passwortgeschützt</span>
                )}
                {typeof share.views === 'number' && <span>{share.views} Aufrufe</span>}
                {typeof share.downloads === 'number' && <span>{share.downloads} Downloads</span>}
              </div>

              <div className="flex flex-wrap gap-2 border-t border-surface-200 pt-4 dark:border-surface-700">
                <button
                  disabled={busy}
                  onClick={() => void run(() => api.setShareLinkActive(target, !active))}
                  className="flex items-center gap-1.5 rounded-lg border border-surface-300 px-3 py-1.5 text-xs font-medium text-surface-700 hover:bg-surface-100 disabled:opacity-50 dark:border-surface-600 dark:text-surface-300 dark:hover:bg-surface-800"
                >
                  {active ? <><Ban size={14} /> Sperren</> : <><RotateCcw size={14} /> Reaktivieren</>}
                </button>
                <button
                  disabled={busy}
                  onClick={async () => {
                    if (!await confirm('Diesen Link endgültig löschen? Er funktioniert danach nicht mehr.', 'Löschen')) return;
                    await run(() => api.deleteShareLink(target));
                    onClose();
                  }}
                  className="flex items-center gap-1.5 rounded-lg border border-surface-300 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-surface-600 dark:text-red-400 dark:hover:bg-red-900/20"
                >
                  <Trash2 size={14} /> Löschen
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-surface-600 dark:text-surface-400">
                Für diese Datei gibt es noch keinen Link. Wer den Link kennt, kann die Datei
                herunterladen — auch ohne Konto.
              </p>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-surface-600 dark:text-surface-400">
                  Passwort <span className="font-normal text-surface-400">(optional)</span>
                </span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  placeholder="Ohne Passwort frei zugänglich"
                  className="w-full rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm text-surface-900 dark:border-surface-600 dark:bg-surface-800 dark:text-white"
                />
              </label>
              <button
                disabled={busy}
                onClick={() => void run(() => api.createShareLink(target, password || undefined))}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
              >
                {busy && <Loader2 size={14} className="animate-spin" />}
                <Link2 size={15} /> Link erstellen
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
