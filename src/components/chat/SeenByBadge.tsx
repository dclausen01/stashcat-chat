/**
 * Klickbarer Lese-Haken an eigenen Nachrichten.
 *
 * Der Doppelhaken zeigt wie bisher an, dass jemand die Nachricht gesehen hat —
 * ein Klick laedt zusaetzlich, *wer* das war. Die Liste wird erst beim Oeffnen
 * geholt und danach im State behalten.
 *
 * Aufbau bewusst analog zu `LikeBadge`, damit sich beide gleich anfuehlen.
 */

import { useEffect, useRef, useState } from 'react';
import { CheckCheck, Loader2 } from 'lucide-react';
import * as api from '../../api';
import type { SeenUser } from '../../api/messages';
import Avatar from '../Avatar';

function displayName(u: SeenUser): string {
  const name = `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim();
  return name || 'Unbekannt';
}

function formatTime(ts?: number): string {
  if (!ts) return '';
  return new Date(ts * 1000).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

export default function SeenByBadge({ messageId }: { messageId: string }) {
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<SeenUser[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const popupRef = useRef<HTMLSpanElement>(null);

  async function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (open) { setOpen(false); return; }
    setOpen(true);
    if (users !== null) return;
    setLoading(true);
    setError('');
    try {
      setUsers(await api.listSeenUsers(messageId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Laden');
      setUsers([]);
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
        title="Wer hat das gelesen?"
        aria-label="Wer hat das gelesen?"
        className="inline-flex cursor-pointer items-center rounded transition hover:opacity-70"
      >
        <CheckCheck size={13} className="text-primary-500" />
      </button>
      {open && (
        <div className="absolute bottom-full right-0 z-20 mb-1.5 w-56 rounded-xl bg-white px-1 py-1.5 shadow-xl ring-1 ring-surface-200 dark:bg-surface-800 dark:ring-surface-700">
          <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-surface-600">
            Gelesen von {users?.length ? users.length : ''}
          </div>
          {loading ? (
            <div className="flex justify-center py-2">
              <Loader2 size={14} className="animate-spin text-primary-400" />
            </div>
          ) : error ? (
            <p className="px-2 py-1 text-xs text-red-500">{error}</p>
          ) : users && users.length > 0 ? (
            <ul className="max-h-48 overflow-y-auto">
              {users.map((u) => (
                <li key={u.user_id} className="flex items-center gap-2 rounded-lg px-2 py-1">
                  <Avatar name={displayName(u)} image={u.image} size="xs" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs text-surface-800 dark:text-surface-200">{displayName(u)}</p>
                    {u.time && <p className="text-[10px] text-surface-500">{formatTime(u.time)}</p>}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-2 py-1 text-xs text-surface-500">Noch niemand.</p>
          )}
        </div>
      )}
    </span>
  );
}
