import { Hash, Star } from 'lucide-react';
import { clsx } from 'clsx';
import Avatar from './Avatar';
import type { ChatTarget } from '../types';

interface ChatItemProps {
  target: ChatTarget;
  active: boolean;
  onSelect: (t: ChatTarget) => void;
  onToggleFavorite?: (t: ChatTarget) => void;
}

export default function ChatItem({ target, active, onSelect, onToggleFavorite }: ChatItemProps) {
  return (
    <button
      onClick={() => onSelect(target)}
      className={clsx(
        'group/item flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition',
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
        <Avatar name={target.name} image={target.image} size="sm" />
      )}
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{target.name}</span>
      {onToggleFavorite && (
        <span
          onClick={(e) => { e.stopPropagation(); onToggleFavorite(target); }}
          title={target.favorite ? 'Favorit entfernen' : 'Als Favorit markieren'}
          className={clsx(
            'shrink-0 cursor-pointer transition',
            target.favorite
              ? 'text-yellow-400'
              : 'text-transparent group-hover/item:text-surface-400 dark:group-hover/item:text-surface-600',
          )}
        >
          <Star size={13} className={target.favorite ? 'fill-yellow-400' : ''} />
        </span>
      )}
      {target.encrypted && <span className="shrink-0 text-xs text-surface-500" title="Verschlüsselt">🔒</span>}
      {(target.unread_count ?? 0) > 0 && (
        <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-ci-red-500 px-1.5 text-xs font-bold text-white">
          {target.unread_count}
        </span>
      )}
    </button>
  );
}
