import { LogOut, Sun, Moon, FolderOpen, Bell, Settings } from 'lucide-react';
import { clsx } from 'clsx';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import Avatar from './Avatar';

interface SidebarHeaderProps {
  totalUnread: number;
  notificationsOpen: boolean;
  onOpenNotifications: () => void;
  onOpenFileBrowser: () => void;
  onOpenSettings: () => void;
  onOpenProfile: () => void;
}

export default function SidebarHeader({ totalUnread, notificationsOpen, onOpenNotifications, onOpenFileBrowser, onOpenSettings, onOpenProfile }: SidebarHeaderProps) {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();

  const userName = user ? `${user.first_name} ${user.last_name}` : '';
  const userImage = user?.image;

  return (
    <div className="shrink-0 border-b border-surface-200 px-3 py-2 dark:border-surface-700">
      {/* Row 1: Avatar, Name, BBZ Logo */}
      <div className="flex items-center gap-2">
        <button
          onClick={onOpenProfile}
          className="rounded-full transition hover:opacity-80"
          title="Profil bearbeiten"
        >
          <Avatar name={userName} image={userImage} size="sm" availability={user?.availability} />
        </button>
        <button
          onClick={onOpenProfile}
          className="min-w-0 flex-1 text-left"
          title="Profil bearbeiten"
        >
          <div className="truncate text-sm font-semibold text-surface-900 hover:text-primary-600 dark:text-white dark:hover:text-primary-400">{userName}</div>
        </button>
        <img src="/bbz-logo-neu.png" alt="BBZ Chat" className="h-5 w-auto shrink-0 opacity-70" title="BBZ Chat" />
      </div>
      {/* Row 2: Action buttons */}
      <div className="mt-1.5 flex items-center justify-between px-1">
        <button
          onClick={onOpenNotifications}
          className={clsx(
            'relative rounded-lg p-1.5 transition',
            notificationsOpen
              ? 'bg-primary-100 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400'
              : 'text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700',
          )}
          title="Benachrichtigungen"
          aria-label="Benachrichtigungen"
        >
          <Bell size={16} />
          {totalUnread > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
              {totalUnread > 99 ? '99+' : totalUnread}
            </span>
          )}
        </button>
        <button
          onClick={onOpenFileBrowser}
          className="rounded-lg p-1.5 text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700"
          title="Meine Dateien"
          aria-label="Meine Dateien"
        >
          <FolderOpen size={16} />
        </button>
        <button onClick={toggle} aria-label={theme === 'dark' ? 'Helles Design aktivieren' : 'Dunkles Design aktivieren'} title={theme === 'dark' ? 'Helles Design' : 'Dunkles Design'} className="rounded-lg p-1.5 text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700">
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <button
          onClick={onOpenSettings}
          className="rounded-lg p-1.5 text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700"
          title="Einstellungen"
          aria-label="Einstellungen"
        >
          <Settings size={16} />
        </button>
        <button onClick={logout} aria-label="Abmelden" title="Abmelden" className="rounded-lg p-1.5 text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700">
          <LogOut size={16} />
        </button>
      </div>
    </div>
  );
}
