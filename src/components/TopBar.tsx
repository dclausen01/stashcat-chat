import { useEffect, useRef, useState } from 'react';
import {
  Home, Bell, FolderOpen, Radio, CalendarDays, BarChart3,
  MoreVertical, Settings, Sun, Moon, LogOut, Hash, Mail,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import Avatar from './Avatar';
import type { ChatTarget } from '../types';

interface TopBarProps {
  totalUnread: number;
  unreadChannels: ChatTarget[];
  unreadConversations: ChatTarget[];
  onSelectChat: (target: ChatTarget) => void;
  notificationsOpen: boolean;
  onOpenNotifications: () => void;
  fileBrowserOpen: boolean;
  onOpenFileBrowser: () => void;
  broadcastsOpen: boolean;
  onOpenBroadcasts: () => void;
  calendarOpen: boolean;
  onOpenCalendar: () => void;
  pollsOpen: boolean;
  onOpenPolls: () => void;
  onGoHome: () => void;
  onOpenProfile: () => void;
  onOpenSettings: () => void;
}

function iconBtn(active: boolean) {
  return clsx(
    'flex h-8 w-8 items-center justify-center rounded-lg transition',
    active
      ? 'bg-primary-100 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400'
      : 'text-surface-500 hover:bg-surface-200 hover:text-surface-700 dark:text-surface-400 dark:hover:bg-surface-700 dark:hover:text-surface-200',
  );
}

export default function TopBar({
  totalUnread, unreadChannels, unreadConversations, onSelectChat,
  notificationsOpen, onOpenNotifications,
  fileBrowserOpen, onOpenFileBrowser,
  broadcastsOpen, onOpenBroadcasts,
  calendarOpen, onOpenCalendar,
  pollsOpen, onOpenPolls,
  onGoHome,
  onOpenProfile, onOpenSettings,
}: TopBarProps) {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const userName = user ? `${user.first_name} ${user.last_name}` : '';
  const userImage = user?.image;
  const hasUnread = totalUnread > 0;
  const hasAnyUnreadList = unreadChannels.length > 0 || unreadConversations.length > 0;

  // Close three-dot menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  return (
    <div className="hidden md:flex shrink-0 items-center gap-1 border-b border-surface-200 bg-[var(--theme-panel)] px-3 py-1.5 dark:border-surface-700">

      {/* Left group: navigation buttons */}
      <div className="flex items-center gap-0.5">

        {/* Home */}
        <button
          onClick={onGoHome}
          className={iconBtn(false)}
          title="Zur Startseite"
          aria-label="Zur Startseite"
        >
          <Home size={16} />
        </button>

        {/* Notification bell with unread badge + hover popup */}
        <div className="group/bell relative">
          <button
            onClick={onOpenNotifications}
            className={iconBtn(notificationsOpen)}
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

          {/* Hover popup with unread list */}
          {hasAnyUnreadList && (
            <div
              className="invisible absolute left-0 top-full z-50 w-72 rounded-lg border border-surface-200 bg-white opacity-0 shadow-xl transition-opacity duration-150 after:absolute after:top-full after:inset-x-0 after:h-2 group-hover/bell:visible group-hover/bell:opacity-100 dark:border-surface-700 dark:bg-surface-800"
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
                        onClick={() => onSelectChat(ch)}
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
                        onClick={() => onSelectChat(cv)}
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

        {/* File browser */}
        <button
          onClick={onOpenFileBrowser}
          className={iconBtn(fileBrowserOpen)}
          title="Dateiablage"
          aria-label="Dateiablage"
        >
          <FolderOpen size={16} />
        </button>

        {/* Broadcasts */}
        <button
          onClick={onOpenBroadcasts}
          className={iconBtn(broadcastsOpen)}
          title="Broadcasts"
          aria-label="Broadcasts"
        >
          <Radio size={16} />
        </button>

        {/* Calendar */}
        <button
          onClick={onOpenCalendar}
          className={iconBtn(calendarOpen)}
          title="Kalender"
          aria-label="Kalender"
        >
          <CalendarDays size={16} />
        </button>

        {/* Polls */}
        <button
          onClick={onOpenPolls}
          className={iconBtn(pollsOpen)}
          title="Umfragen"
          aria-label="Umfragen"
        >
          <BarChart3 size={16} />
        </button>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Right group: three-dot menu + profile */}
      <div className="flex items-center gap-2">

        {/* Three-dot menu */}
        <div ref={menuRef} className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className={iconBtn(menuOpen)}
            title="Menü"
            aria-label="Menü"
            aria-haspopup="true"
            aria-expanded={menuOpen}
          >
            <MoreVertical size={16} />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full z-50 mt-1 w-52 rounded-lg border border-surface-200 bg-white py-1 shadow-xl dark:border-surface-700 dark:bg-surface-800">
              <button
                onClick={() => { setMenuOpen(false); onOpenSettings(); }}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-surface-700 transition hover:bg-surface-50 dark:text-surface-200 dark:hover:bg-surface-700"
              >
                <Settings size={15} className="text-surface-500" />
                Einstellungen
              </button>
              <button
                onClick={() => { toggle(); setMenuOpen(false); }}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-surface-700 transition hover:bg-surface-50 dark:text-surface-200 dark:hover:bg-surface-700"
              >
                {theme === 'dark'
                  ? <Sun size={15} className="text-surface-500" />
                  : <Moon size={15} className="text-surface-500" />}
                {theme === 'dark' ? 'Helles Design' : 'Dunkles Design'}
              </button>
              <div className="my-1 border-t border-surface-200 dark:border-surface-700" />
              <button
                onClick={() => { setMenuOpen(false); logout(); }}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-red-600 transition hover:bg-surface-50 dark:text-red-400 dark:hover:bg-surface-700"
              >
                <LogOut size={15} />
                Abmelden
              </button>
            </div>
          )}
        </div>

        {/* Profile name + avatar */}
        <button
          onClick={onOpenProfile}
          className="flex items-center gap-2 rounded-lg px-2 py-1 transition hover:bg-surface-200 dark:hover:bg-surface-700"
          title="Profil bearbeiten"
        >
          <span className="text-sm font-medium text-surface-800 dark:text-surface-100">{userName}</span>
          <Avatar name={userName} image={userImage} size="sm" availability={user?.availability} />
        </button>
      </div>
    </div>
  );
}
