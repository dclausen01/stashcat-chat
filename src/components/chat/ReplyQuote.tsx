import { memo } from 'react';
import { clsx } from 'clsx';
import type { Message } from '../../types';

function ReplyQuoteImpl({ msg, isOwn }: { msg: Message; isOwn: boolean }) {
  const senderName = msg.sender ? `${msg.sender.first_name ?? ''} ${msg.sender.last_name ?? ''}`.trim() || 'Unbekannt' : 'Unbekannt';
  const isDeleted = msg.deleted || msg.is_deleted_by_manager;
  const text = isDeleted ? 'Nachricht wurde gelöscht' : (msg.text || '');
  const preview = text.slice(0, 120) + (text.length > 120 ? '...' : '');

  const handleClick = () => {
    const el = document.getElementById(`msg-${msg.id}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ring-2', 'ring-primary-400', 'rounded-xl');
      setTimeout(() => el.classList.remove('ring-2', 'ring-primary-400', 'rounded-xl'), 1500);
    }
  };

  return (
    <div
      onClick={handleClick}
      className={clsx(
        'mb-1.5 cursor-pointer rounded-lg border-l-3 px-2.5 py-1.5 text-xs transition hover:opacity-80',
        isOwn
          ? 'border-primary-300 bg-primary-700/50 text-primary-100'
          : 'border-surface-400 bg-surface-200/60 text-surface-600 dark:bg-surface-700/60 dark:text-surface-400',
      )}>
      <div className="font-semibold">{senderName}</div>
      <div className="line-clamp-2 opacity-80">{preview || 'Nachricht'}</div>
    </div>
  );
}

export const ReplyQuote = memo(ReplyQuoteImpl);
