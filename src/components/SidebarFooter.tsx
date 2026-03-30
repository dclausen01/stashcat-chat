import { Radio, CalendarDays, BarChart3 } from 'lucide-react';
import { clsx } from 'clsx';

interface SidebarFooterProps {
  broadcastsOpen: boolean;
  calendarOpen: boolean;
  pollsOpen: boolean;
  onOpenBroadcasts: () => void;
  onOpenCalendar: () => void;
  onOpenPolls: () => void;
}

export default function SidebarFooter({ broadcastsOpen, calendarOpen, pollsOpen, onOpenBroadcasts, onOpenCalendar, onOpenPolls }: SidebarFooterProps) {
  return (
    <div className="flex shrink-0 items-center border-t border-surface-200 dark:border-surface-700">
      <button
        onClick={onOpenBroadcasts}
        className={clsx(
          'flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition',
          broadcastsOpen
            ? 'bg-primary-50 text-primary-600 dark:bg-primary-900/20 dark:text-primary-400'
            : 'text-surface-500 hover:bg-surface-100 hover:text-surface-700 dark:text-surface-400 dark:hover:bg-surface-800 dark:hover:text-surface-200',
        )}
        title="Broadcasts"
      >
        <Radio size={15} />
        <span>Broadcasts</span>
      </button>
      <div className="h-6 w-px bg-surface-200 dark:bg-surface-700" />
      <button
        onClick={onOpenCalendar}
        className={clsx(
          'flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition',
          calendarOpen
            ? 'bg-primary-50 text-primary-600 dark:bg-primary-900/20 dark:text-primary-400'
            : 'text-surface-500 hover:bg-surface-100 hover:text-surface-700 dark:text-surface-400 dark:hover:bg-surface-800 dark:hover:text-surface-200',
        )}
        title="Kalender"
      >
        <CalendarDays size={15} />
        <span>Kalender</span>
      </button>
      <div className="h-6 w-px bg-surface-200 dark:bg-surface-700" />
      <button
        onClick={onOpenPolls}
        className={clsx(
          'flex flex-1 items-center justify-center gap-1.5 py-2.5 text-xs font-medium transition',
          pollsOpen
            ? 'bg-primary-50 text-primary-600 dark:bg-primary-900/20 dark:text-primary-400'
            : 'text-surface-500 hover:bg-surface-100 hover:text-surface-700 dark:text-surface-400 dark:hover:bg-surface-800 dark:hover:text-surface-200',
        )}
        title="Umfragen"
      >
        <BarChart3 size={15} />
        <span>Umfragen</span>
      </button>
    </div>
  );
}
