import { LogOut, Sun, Moon, FolderOpen, Bell, Settings, Hash, Mail, Home } from 'lucide-react';
import { clsx } from 'clsx';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import Avatar from './Avatar';
import type { ChatTarget } from '../types';

interface SidebarHeaderProps {
  totalUnread: number;
  unreadChannels?: ChatTarget[];
  unreadConversations?: ChatTarget[];
  onSelectChat?: (target: ChatTarget) => void;
  notificationsOpen: boolean;
  onOpenNotifications: () => void;
  onOpenFileBrowser: () => void;
  onOpenSettings: () => void;
  onOpenProfile: () => void;
  onGoHome?: () => void;
}

export default function SidebarHeader({
  totalUnread,
  unreadChannels = [],
  unreadConversations = [],
  onSelectChat,
  notificationsOpen,
  onOpenNotifications,
  onOpenFileBrowser,
  onOpenSettings,
  onOpenProfile,
  onGoHome,
}: SidebarHeaderProps) {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();

  const userName = user ? `${user.first_name} ${user.last_name}` : '';
  const userImage = user?.image;

  const hasUnread = totalUnread > 0;
  const hasAnyUnreadList = unreadChannels.length > 0 || unreadConversations.length > 0;

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
        {/* Home button — always visible */}
        {onGoHome && (
          <button
            onClick={onGoHome}
            className="rounded-lg p-1.5 text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700"
            title="Zur Startseite"
            aria-label="Zur Startseite"
          >
            <Home size={16} />
          </button>
        )}
        <div className="group/bell relative">
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
            {hasUnread && (
              <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold text-white">
                {totalUnread > 99 ? '99+' : totalUnread}
              </span>
            )}
          </button>

          {/* Hover popup — desktop only, only when there are unread messages */}
          {hasAnyUnreadList && (
            <div
              className="invisible absolute left-0 top-full z-50 hidden w-72 rounded-lg border border-surface-200 bg-white opacity-0 shadow-xl transition-opacity duration-150 after:absolute after:top-full after:inset-x-0 after:h-2 group-hover/bell:visible group-hover/bell:opacity-100 dark:border-surface-700 dark:bg-surface-800 md:block"
              role="menu"
            >
              <div className="border-b border-surface-200 px-3 pt-2 pb-2 text-xs font-semibold uppercase tracking-wider text-surface-600 dark:border-surface-700 dark:text-surface-300">
                Neue Nachrichten
              </div>
              <div className="max-h-80 overflow-y-auto py-1">
                {unreadChannels.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400">
                      <Hash size={10} /> Channels
                    </div>
                    {unreadChannels.map((ch) => (
                      <button
                        key={`ch-${ch.id}`}
                        onClick={() => onSelectChat?.(ch)}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition hover:bg-surface-100 dark:hover:bg-surface-700"
                        role="menuitem"
                      >
                        <Avatar name={ch.name} image={ch.image} size="xs" />
                        <span className="min-w-0 flex-1 truncate text-surface-800 dark:text-surface-100">{ch.name}</span>
                        <span className="shrink-0 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                          {(ch.unread_count ?? 0) > 99 ? '99+' : ch.unread_count}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {unreadChannels.length > 0 && unreadConversations.length > 0 && (
                  <div className="my-1 border-t border-surface-200 dark:border-surface-700" />
                )}
                {unreadConversations.length > 0 && (
                  <div>
                    <div className="flex items-center gap-1.5 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-surface-500 dark:text-surface-400">
                      <Mail size={10} /> Konversationen
                    </div>
                    {unreadConversations.map((cv) => (
                      <button
                        key={`cv-${cv.id}`}
                        onClick={() => onSelectChat?.(cv)}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition hover:bg-surface-100 dark:hover:bg-surface-700"
                        role="menuitem"
                      >
                        <Avatar name={cv.name} image={cv.image} size="xs" availability={cv.userAvailability} />
                        <span className="min-w-0 flex-1 truncate text-surface-800 dark:text-surface-100">{cv.name}</span>
                        <span className="shrink-0 rounded-full bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
                          {(cv.unread_count ?? 0) > 99 ? '99+' : cv.unread_count}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
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
