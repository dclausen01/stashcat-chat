import { memo, useEffect, useRef, useState } from 'react';
import { ThumbsUp, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import * as api from '../../api';
import Avatar from '../Avatar';

function LikeBadgeImpl({ count, liked, onToggle, messageId }: { count: number; liked: boolean; onToggle: () => void; messageId: string }) {
  const [showPopup, setShowPopup] = useState(false);
  const [likers, setLikers] = useState<Array<{ name: string; image?: string }> | null>(null);
  const [loadingLikers, setLoadingLikers] = useState(false);
  const [likeError, setLikeError] = useState('');
  const popupRef = useRef<HTMLDivElement>(null);

  const loadLikers = async () => {
    if (showPopup) { setShowPopup(false); return; }
    setShowPopup(true);
    if (likers !== null) return;
    setLoadingLikers(true);
    setLikeError('');
    try {
      const data = await api.listLikes(messageId);
      if (!data || !Array.isArray(data)) {
        setLikers([]);
        setLikeError('Unerwartetes Format');
        return;
      }
      setLikers(data.map((l) => ({ name: `${l.user.first_name ?? ''} ${l.user.last_name ?? ''}`.trim() || 'Unbekannt', image: l.user.image })));
    } catch (err) {
      console.error('Failed to load likers:', err);
      setLikeError(err instanceof Error ? err.message : 'Fehler beim Laden');
      setLikers([]);
    } finally {
      setLoadingLikers(false);
    }
  };

  useEffect(() => {
    if (!showPopup) return;
    const handler = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) setShowPopup(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showPopup]);

  return (
    <span className="relative inline-flex" ref={popupRef}>
      <button
        onClick={loadLikers}
        className={clsx(
          'flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold transition cursor-pointer shadow-sm',
          liked
            ? 'bg-amber-400 text-white dark:bg-amber-500 dark:text-white'
            : 'bg-sky-100 text-sky-600 hover:bg-amber-100 hover:text-amber-600 dark:bg-sky-900/40 dark:text-sky-400 dark:hover:bg-amber-900/40 dark:hover:text-amber-400',
        )}
      >
        <ThumbsUp size={13} fill={liked ? 'currentColor' : 'none'} />
        {count}
      </button>
      {showPopup && (
        <div className="absolute bottom-full left-1/2 z-20 mb-1.5 -translate-x-1/2 w-48 rounded-xl bg-white px-1 py-1.5 shadow-xl ring-1 ring-surface-200 dark:bg-surface-800 dark:ring-surface-700">
          <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-surface-600">
            Gefällt {count} {count === 1 ? 'Person' : 'Personen'}
          </div>
          {loadingLikers ? (
            <div className="flex justify-center py-2"><Loader2 size={14} className="animate-spin text-primary-400" /></div>
          ) : likers && likers.length > 0 ? (
            <div className="max-h-32 overflow-y-auto">
              {likers.map((l, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg px-2 py-1">
                  <Avatar name={l.name} image={l.image} size="xs" />
                  <span className="truncate text-xs text-surface-700 dark:text-surface-400">{l.name}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-2 py-1 text-xs text-surface-600">{likeError || 'Keine Daten'}</div>
          )}
          <div className="mt-1 border-t border-surface-100 px-1 pt-1 dark:border-surface-700">
            <button
              onClick={(e) => { e.stopPropagation(); onToggle(); setShowPopup(false); setLikers(null); }}
              className="flex w-full items-center justify-center gap-1 rounded-lg py-1 text-xs font-medium text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-900/20"
            >
              <ThumbsUp size={12} />
              {liked ? 'Like entfernen' : 'Gefällt mir'}
            </button>
          </div>
        </div>
      )}
    </span>
  );
}

export const LikeBadge = memo(LikeBadgeImpl);
