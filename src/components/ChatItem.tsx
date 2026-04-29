import { useState, useRef, useEffect } from 'react';
import { Hash, Star, MoreHorizontal, Mail } from 'lucide-react';
import { clsx } from 'clsx';
import Avatar from './Avatar';
import type { ChatTarget } from '../types';

interface ChatItemProps {
  target: ChatTarget;
  active: boolean;
  onSelect: (t: ChatTarget) => void;
  onToggleFavorite?: (t: ChatTarget) => void;
  onMarkUnread?: (t: ChatTarget) => void;
}

export default function ChatItem({ target, active, onSelect, onToggleFavorite, onMarkUnread }: ChatItemProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  return (
    <button
      onClick={() => onSelect(target)}
      className={clsx(
        'group/item relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition',
        active
          ? 'bg-primary-100 text-primary-900 dark:bg-primary-900/30 dark:text-primary-200'
          : 'text-surface-700 hover:bg-surface-200 dark:text-surface-400 dark:hover:bg-surface-800',
      )}
    >
      {target.type === 'channel' ? (
        target.image
          ? <Avatar name={target.name} image={target.image} size="sm" />
          : <Hash size={17} className={clsx('shrink-0', active ? 'text-primary-600 dark:text-primary-400' : 'text-surface-500')} />
      ) : (
        <Avatar name={target.name} image={target.image} size="sm" availability={target.userAvailability} />
      )}
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{target.name}</span>
      {onToggleFavorite && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggleFavorite(target); }}
          title={target.favorite ? 'Favorit entfernen' : 'Als Favorit markieren'}
          aria-label={target.favorite ? 'Favorit entfernen' : 'Als Favorit markieren'}
          aria-pressed={target.favorite}
          className={clsx(
            'shrink-0 rounded transition min-h-[44px] min-w-[44px] flex items-center justify-center md:min-h-0 md:min-w-0',
            target.favorite
              ? 'text-yellow-400'
              : 'text-transparent group-hover/item:text-surface-400 dark:group-hover/item:text-surface-600',
          )}
        >
          <Star size={13} className={target.favorite ? 'fill-yellow-400' : ''} />
        </button>
      )}
      {onMarkUnread && (
        <div ref={menuRef} className="relative shrink-0">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
            title="Mehr"
            aria-label="Chat-Optionen"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className={clsx(
              'rounded transition min-h-[44px] min-w-[44px] flex items-center justify-center md:min-h-0 md:min-w-0',
              menuOpen
                ? 'text-surface-700 dark:text-surface-200'
                : 'text-transparent group-hover/item:text-surface-400 dark:group-hover/item:text-surface-600',
            )}
          >
            <MoreHorizontal size={14} />
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute right-0 top-full z-50 mt-1 min-w-[200px] overflow-hidden rounded-lg border border-surface-200 bg-white shadow-lg dark:border-surface-700 dark:bg-surface-800"
            >
              <button
                type="button"
                role="menuitem"
                onClick={(e) => {
                  e.stopPropagation();
                  setMenuOpen(false);
                  onMarkUnread(target);
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-surface-700 hover:bg-surface-100 dark:text-surface-200 dark:hover:bg-surface-700"
              >
                <Mail size={14} className="shrink-0 text-surface-500" />
                Als ungelesen markieren
              </button>
            </div>
          )}
        </div>
      )}
      {(target.unread_count ?? 0) > 0 && (
        <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-ci-red-500 px-1.5 text-xs font-bold text-white">
          {target.unread_count}
        </span>
      )}
    </button>
  );
}
