import { Radio, CalendarDays, BarChart3, Users } from 'lucide-react';
import { clsx } from 'clsx';
import { usePanels } from '../context/PanelContext';
import { useAuth } from '../context/AuthContext';
import { useAdminAccess } from '../hooks/useAdminAccess';

function isStudentEmail(email?: string): boolean {
  return !!email && email.toLowerCase().endsWith('@sus.bbz-rd-eck.de');
}

export default function SidebarFooter() {
  const {
    broadcasts: broadcastsOpen,
    activeView,
    toggleBroadcasts,
    openCalendar,
    openPolls,
    openAdmin,
  } = usePanels();
  const { user } = useAuth();
  // Nur Admins sehen die Nutzerverwaltung. Die Pruefung laeuft einmal pro
  // Session und ist modulweit gecached (siehe useAdminAccess).
  const { isAdmin } = useAdminAccess();
  const calendarOpen = activeView === 'calendar';
  const pollsOpen = activeView === 'polls';
  const adminOpen = activeView === 'admin';
  const hideBroadcasts = isStudentEmail(user?.email);
  return (
    <div className="flex shrink-0 items-center border-t border-surface-200 dark:border-surface-700">
      {!hideBroadcasts && (
        <>
          <button
            onClick={toggleBroadcasts}
            className={clsx(
              'flex flex-1 items-center justify-center gap-1.5 py-4 text-xs font-medium transition md:py-3',
              broadcastsOpen
                ? 'bg-primary-50 text-primary-600 dark:bg-primary-900/20 dark:text-primary-400'
                : 'text-surface-500 hover:bg-surface-200 hover:text-surface-700 dark:text-surface-500 dark:hover:bg-surface-800 dark:hover:text-surface-200',
            )}
            title="Broadcasts"
          >
            <Radio size={15} />
            <span>Broadcasts</span>
          </button>
          <div className="h-6 w-px bg-surface-200 dark:bg-surface-700" />
        </>
      )}
      <button
        onClick={openCalendar}
        className={clsx(
          'flex flex-1 items-center justify-center gap-1.5 py-4 text-xs font-medium transition md:py-3',
          calendarOpen
            ? 'bg-primary-50 text-primary-600 dark:bg-primary-900/20 dark:text-primary-400'
            : 'text-surface-500 hover:bg-surface-200 hover:text-surface-700 dark:text-surface-500 dark:hover:bg-surface-800 dark:hover:text-surface-200',
        )}
        title="Kalender"
      >
        <CalendarDays size={15} />
        <span>Kalender</span>
      </button>
      <div className="h-6 w-px bg-surface-200 dark:bg-surface-700" />
      <button
        onClick={openPolls}
        className={clsx(
          'flex flex-1 items-center justify-center gap-1.5 py-4 text-xs font-medium transition md:py-3',
          pollsOpen
            ? 'bg-primary-50 text-primary-600 dark:bg-primary-900/20 dark:text-primary-400'
            : 'text-surface-500 hover:bg-surface-200 hover:text-surface-700 dark:text-surface-500 dark:hover:bg-surface-800 dark:hover:text-surface-200',
        )}
        title="Umfragen"
      >
        <BarChart3 size={15} />
        <span>Umfragen</span>
      </button>
      {isAdmin && (
        <>
          <div className="h-6 w-px bg-surface-200 dark:bg-surface-700" />
          <button
            onClick={openAdmin}
            className={clsx(
              'flex flex-1 items-center justify-center gap-1.5 py-4 text-xs font-medium transition md:py-3',
              adminOpen
                ? 'bg-primary-50 text-primary-600 dark:bg-primary-900/20 dark:text-primary-400'
                : 'text-surface-500 hover:bg-surface-200 hover:text-surface-700 dark:text-surface-500 dark:hover:bg-surface-800 dark:hover:text-surface-200',
            )}
            title="Nutzerverwaltung"
          >
            <Users size={15} />
            <span>Verwaltung</span>
          </button>
        </>
      )}
    </div>
  );
}
