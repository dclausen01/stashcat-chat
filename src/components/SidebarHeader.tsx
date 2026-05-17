import { useRef, useState } from 'react';
import { LogOut, Sun, Moon, FolderOpen, Bell, Settings, Hash, Mail, Home } from 'lucide-react';
import { clsx } from 'clsx';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { usePanels } from '../context/PanelContext';
import Avatar from './Avatar';
import type { ChatTarget } from '../types';
import { getCleanName } from '../utils/subchannels';
import { bridge } from '../lib/flutterBridge';

interface SidebarHeaderProps {
  totalUnread: number;
  unreadChannels?: ChatTarget[];
  unreadConversations?: ChatTarget[];
  onSelectChat?: (target: ChatTarget) => void;
  onGoHome?: () => void;
}

export default function SidebarHeader({
  totalUnread,
  unreadChannels = [],
  unreadConversations = [],
  onSelectChat,
  onGoHome,
}: SidebarHeaderProps) {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const {
    notifications: notificationsOpen,
    toggleNotifications,
    toggleFileBrowser,
    toggleSettings,
    toggleProfile,
  } = usePanels();

  const userName = user ? `${user.first_name} ${user.last_name}` : '';
  const userImage = user?.image;

  const hasUnread = totalUnread > 0;
  const hasAnyUnreadList = unreadChannels.length > 0 || unreadConversations.length > 0;

  // Long-Press auf der Glocke öffnet auf Touch-Geräten dasselbe Popup, das
  // Desktop-User mit Hover bekommen. State wird nur durch Long-Press
  // gesetzt (kein Toggle), damit der normale Tap weiter die Notifications-
  // Panel-Ansicht öffnet.
  const [mobileBellOpen, setMobileBellOpen] = useState(false);
  const longPressTimer = useRef<number | null>(null);
  const longPressFired = useRef(false);
  const startBellPress = (e: React.TouchEvent | React.PointerEvent) => {
    if (!hasAnyUnreadList) return;
    longPressFired.current = false;
    if (longPressTimer.current != null) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = window.setTimeout(() => {
      longPressFired.current = true;
      bridge.haptic('medium');
      setMobileBellOpen(true);
      longPressTimer.current = null;
    }, 500);
    // Verhindern, dass auf iOS ein Context-Menu mit "Bild speichern"-Inhalt
    // aufpoppt (nicht 100 % notwendig, aber konsistenter).
    if ('preventDefault' in e && typeof e.preventDefault === 'function') {
      // no-op; touchstart can't preventDefault on passive listeners
    }
  };
  const cancelBellPress = () => {
    if (longPressTimer.current != null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  return (
    <div className="app-bar bridge-sticky-top shrink-0 border-b border-surface-200 px-3 py-2 dark:border-surface-700">
      {/* Row 1: Avatar, Name, BBZ Logo */}
      <div className="flex items-center gap-2">
        <button
          onClick={toggleProfile}
          className="rounded-full transition hover:opacity-80"
          title="Profil bearbeiten"
        >
          <Avatar name={userName} image={userImage} size="sm" availability={user?.availability} />
        </button>
        <button
          onClick={toggleProfile}
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
            className="touch-target inline-flex items-center justify-center rounded-lg p-1.5 text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700"
            title="Zur Startseite"
            aria-label="Zur Startseite"
          >
            <Home size={16} />
          </button>
        )}
        <div className="group/bell relative">
          <button
            onClick={() => {
              // Wenn Long-Press das Popup aktiviert hat, das Tap-Event nicht
              // gleich als "öffne Notifications-Panel" interpretieren.
              if (longPressFired.current) { longPressFired.current = false; return; }
              toggleNotifications();
            }}
            onTouchStart={startBellPress}
            onTouchEnd={cancelBellPress}
            onTouchCancel={cancelBellPress}
            onContextMenu={(e) => { if (hasAnyUnreadList) e.preventDefault(); }}
            className={clsx(
              'touch-target relative inline-flex items-center justify-center rounded-lg p-1.5 transition',
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

          {/* Mobile-only Backdrop, schließt das Long-Press-Popup beim Tippen
              irgendwo außerhalb. Auf Desktop existiert kein mobileBellOpen-
              Zustand. */}
          {mobileBellOpen && (
            <div
              className="fixed inset-0 z-40 md:hidden"
              onClick={() => setMobileBellOpen(false)}
              aria-hidden
            />
          )}

          {/* Popup: Desktop = Hover; Mobile = Long-Press-getriggert.
              Sichtbar wenn:
                - Desktop (md+): nur über group-hover Klassen (gleicher
                  Code wie bisher)
                - Mobile (<md):  nur wenn mobileBellOpen=true */}
          {hasAnyUnreadList && (
            <div
              className={clsx(
                'absolute left-0 top-full z-50 w-72 rounded-lg border border-surface-200 bg-white shadow-xl after:absolute after:top-full after:inset-x-0 after:h-2 dark:border-surface-700 dark:bg-surface-800',
                // Desktop-Verhalten: nur Hover sichtbar
                'md:invisible md:opacity-0 md:transition-opacity md:duration-150 md:group-hover/bell:visible md:group-hover/bell:opacity-100',
                // Mobile-Verhalten: gesteuert via mobileBellOpen
                mobileBellOpen ? 'block' : 'hidden md:block',
              )}
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
                        onClick={() => { setMobileBellOpen(false); onSelectChat?.(ch); }}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition hover:bg-surface-100 dark:hover:bg-surface-700"
                        role="menuitem"
                      >
                        <Avatar name={getCleanName(ch.name)} image={ch.image} size="xs" />
                        <span className="min-w-0 flex-1 truncate text-surface-800 dark:text-surface-100">{getCleanName(ch.name)}</span>
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
                        onClick={() => { setMobileBellOpen(false); onSelectChat?.(cv); }}
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
          onClick={toggleFileBrowser}
          className="touch-target inline-flex items-center justify-center rounded-lg p-1.5 text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700"
          title="Meine Dateien"
          aria-label="Meine Dateien"
        >
          <FolderOpen size={16} />
        </button>
        <button onClick={toggle} aria-label={theme === 'dark' ? 'Helles Design aktivieren' : 'Dunkles Design aktivieren'} title={theme === 'dark' ? 'Helles Design' : 'Dunkles Design'} className="touch-target inline-flex items-center justify-center rounded-lg p-1.5 text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700">
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <button
          onClick={toggleSettings}
          className="touch-target inline-flex items-center justify-center rounded-lg p-1.5 text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700"
          title="Einstellungen"
          aria-label="Einstellungen"
        >
          <Settings size={16} />
        </button>
        <button onClick={logout} aria-label="Abmelden" title="Abmelden" className="touch-target inline-flex items-center justify-center rounded-lg p-1.5 text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700">
          <LogOut size={16} />
        </button>
      </div>
    </div>
  );
}
