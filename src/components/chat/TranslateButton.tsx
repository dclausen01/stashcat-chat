/**
 * Uebersetzt eine Nachricht auf Knopfdruck und zeigt das Ergebnis in einem
 * Popover — dasselbe Muster wie `LikeBadge` und `SeenByBadge`.
 *
 * Bewusst kein Inline-Ersatz des Nachrichtentexts: Das Original bleibt
 * sichtbar, die Uebersetzung kommt daneben. Wer die Nachricht zitiert oder
 * kopiert, bekommt so weiterhin den Originaltext.
 */

import { useEffect, useRef, useState } from 'react';
import { Languages, Loader2, Copy, Check } from 'lucide-react';
import * as api from '../../api';

interface TranslateButtonProps {
  text: string;
  /** Kompakte Variante fuer die schmalere Aktionsleiste der Listenansicht. */
  compact?: boolean;
}

export default function TranslateButton({ text, compact = false }: TranslateButtonProps) {
  const [open, setOpen] = useState(false);
  const [translation, setTranslation] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const popupRef = useRef<HTMLSpanElement>(null);

  async function toggle() {
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (translation !== null || error) return;
    setLoading(true);
    setError('');
    try {
      const result = await api.translateText(text);
      if (result === null) {
        setError('Keine Übersetzung verfügbar.');
      } else {
        setTranslation(result);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Übersetzung fehlgeschlagen');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <span className="relative inline-flex" ref={popupRef}>
      <button
        onClick={toggle}
        title="Übersetzen"
        aria-label="Nachricht übersetzen"
        className={
          compact
            ? 'flex items-center justify-center rounded-md p-1 text-surface-600 transition hover:bg-surface-200 hover:text-primary-600 dark:hover:bg-surface-700 dark:hover:text-primary-400'
            : 'flex min-h-9 min-w-9 items-center justify-center rounded-md p-1.5 text-surface-600 transition hover:bg-surface-200 hover:text-primary-600 sm:min-h-7 sm:min-w-7 sm:p-1 dark:hover:bg-surface-700 dark:hover:text-primary-400'
        }
      >
        <Languages size={13} />
      </button>
      {open && (
        <div className="absolute bottom-full right-0 z-30 mb-1.5 w-72 rounded-xl bg-white p-3 shadow-xl ring-1 ring-surface-200 dark:bg-surface-800 dark:ring-surface-700">
          <div className="mb-1.5 flex items-center gap-1.5">
            <span className="flex-1 text-[10px] font-semibold uppercase tracking-wider text-surface-600">
              Übersetzung
            </span>
            {translation && (
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(translation);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  } catch { /* Clipboard kann blockiert sein — dann bleibt Markieren */ }
                }}
                title="Übersetzung kopieren"
                aria-label="Übersetzung kopieren"
                className="rounded p-0.5 text-surface-400 hover:text-surface-600"
              >
                {copied ? <Check size={12} className="text-green-500" /> : <Copy size={12} />}
              </button>
            )}
          </div>
          {loading ? (
            <div className="flex justify-center py-2">
              <Loader2 size={14} className="animate-spin text-primary-400" />
            </div>
          ) : error ? (
            <p className="text-xs text-surface-500">{error}</p>
          ) : (
            <p className="max-h-48 overflow-y-auto whitespace-pre-wrap text-xs text-surface-800 dark:text-surface-200">
              {translation}
            </p>
          )}
        </div>
      )}
    </span>
  );
}
