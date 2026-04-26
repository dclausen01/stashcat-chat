import { useState, useCallback, useRef } from 'react';
import { useAuth } from './context/AuthContext';
import { useSettings } from './context/SettingsContext';
import { useCallManager } from './hooks/useCallManager';
import LoginPage from './pages/LoginPage';
import Sidebar from './components/Sidebar';
import ChatView from './components/ChatView';
import EmptyState from './components/EmptyState';
import SettingsPanel from './components/SettingsPanel';
import FileBrowserPanel from './components/FileBrowserPanel';
import BroadcastsPanel from './components/BroadcastsPanel';
import CalendarView from './components/CalendarView';
import PollsView from './components/PollsView';
import NotificationsPanel from './components/NotificationsPanel';
import FavoriteCardsView from './components/FavoriteCardsView';
import ProfileModal from './components/ProfileModal';
import FlaggedMessagesPanel from './components/FlaggedMessagesPanel';
import CallModal from './components/CallModal';
import type { ChatTarget } from './types';
import type { CallParty } from './api/calls';
import { Menu, X } from 'lucide-react';

type ActiveView = 'chat' | 'calendar' | 'polls';

export default function App() {
  const { loggedIn } = useAuth();
  const { homeView } = useSettings();
  const { activeCall, startCall, acceptCall, rejectCall, hangUp, isMuted, toggleMute } = useCallManager(loggedIn);
  const [activeChat, setActiveChat] = useState<ChatTarget | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fileBrowserOpen, setFileBrowserOpen] = useState(false);
  const [broadcastsOpen, setBroadcastsOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [activeView, setActiveView] = useState<ActiveView>('chat');
  const [channels, setChannels] = useState<ChatTarget[]>([]);
  const [profileOpen, setProfileOpen] = useState(false);
  const [flaggedOpen, setFlaggedOpen] = useState(false);
  const [pollIdToOpen, setPollIdToOpen] = useState<string | null>(null);
  const [eventIdToOpen, setEventIdToOpen] = useState<string | null>(null);
  const [jumpToMessageId, setJumpToMessageId] = useState<string | null>(null);
  const [jumpToMessageTime, setJumpToMessageTime] = useState<number | null>(null);
  const [jumpKey, setJumpKey] = useState(0);
  const [jumpSearching, setJumpSearching] = useState(false);
  const refreshSidebarRef = useRef<(() => void) | null>(null);
  const toggleFavoriteRef = useRef<((target: ChatTarget) => void) | null>(null);

  // Mobile sidebar state
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Close sidebar on route change (chat selected on mobile)
  const handleSelectChat = useCallback((chat: ChatTarget) => {
    setActiveView('chat');
    closeAllPanels();
    setActiveChat(chat);
    setSidebarOpen(false);
  }, []);

  const handleToggleFavoriteFromChatView = useCallback((chat: ChatTarget) => {
    setActiveChat((prev) => prev?.id === chat.id ? { ...prev, favorite: !prev.favorite } : prev);
    toggleFavoriteRef.current?.(chat);
  }, []);

  // Close all side panels
  const closeAllPanels = () => {
    setSettingsOpen(false);
    setFileBrowserOpen(false);
    setBroadcastsOpen(false);
    setNotificationsOpen(false);
    setProfileOpen(false);
    setFlaggedOpen(false);
  };

  const toggleSettings = () => {
    const wasOpen = settingsOpen;
    closeAllPanels();
    if (!wasOpen) setSettingsOpen(true);
  };

  const toggleFileBrowser = () => {
    const wasOpen = fileBrowserOpen;
    closeAllPanels();
    if (!wasOpen) setFileBrowserOpen(true);
  };

  const toggleFlagged = () => {
    const wasOpen = flaggedOpen;
    closeAllPanels();
    if (!wasOpen) setFlaggedOpen(true);
  };

  const toggleBroadcasts = () => {
    const wasOpen = broadcastsOpen;
    closeAllPanels();
    setActiveView('chat');
    if (!wasOpen) setBroadcastsOpen(true);
  };

  const openCalendar = () => {
    const wasOpen = activeView === 'calendar';
    closeAllPanels();
    setEventIdToOpen(null);
    setActiveView(wasOpen ? 'chat' : 'calendar');
  };

  const openEvent = (eventId: string) => {
    closeAllPanels();
    setEventIdToOpen(eventId);
    setActiveView('calendar');
  };

  const openPolls = () => {
    const wasOpen = activeView === 'polls';
    closeAllPanels();
    setPollIdToOpen(null);
    setActiveView(wasOpen ? 'chat' : 'polls');
  };

  const openPoll = (pollId: string) => {
    closeAllPanels();
    setPollIdToOpen(pollId);
    setActiveView('polls');
  };

  const handleGoHome = () => {
    closeAllPanels();
    setActiveChat(null);
    setSidebarOpen(false);
  };

  const handleChannelsLoaded = useCallback((loadedChannels: ChatTarget[]) => {
    setChannels(loadedChannels);
  }, []);

  const handleFlaggedMessageClick = useCallback((messageId: string, chat: ChatTarget, messageTime?: number) => {
    if (activeChat?.id !== chat.id || activeChat?.type !== chat.type) {
      setActiveChat(chat);
    }
    setJumpToMessageId(messageId);
    setJumpToMessageTime(messageTime ?? null);
    setJumpSearching(true);
    setJumpKey((k) => k + 1);
  }, [activeChat]);

  const handleJumpComplete = useCallback(() => {
    setJumpToMessageId(null);
    setJumpToMessageTime(null);
    setJumpSearching(false);
  }, []);

  if (!loggedIn) {
    return <LoginPage />;
  }

  return (
    <div className="flex h-full">
      {/* Mobile: Sidebar as overlay drawer */}
      {/* Desktop (lg+): Sidebar always visible */}
      <div
        className={`
          fixed inset-0 z-40 shrink-0 lg:relative
          ${sidebarOpen ? 'flex' : 'hidden lg:flex'}
        `}
      >
        <Sidebar
          activeChat={activeChat}
          onSelectChat={handleSelectChat}
          loggedIn={loggedIn}
          onOpenFileBrowser={toggleFileBrowser}
          onOpenBroadcasts={toggleBroadcasts}
          onOpenCalendar={openCalendar}
          onOpenPolls={openPolls}
          onOpenNotifications={() => { const wasOpen = notificationsOpen; closeAllPanels(); if (!wasOpen) setNotificationsOpen(true); }}
          onOpenSettings={toggleSettings}
          onOpenProfile={() => { const wasOpen = profileOpen; closeAllPanels(); if (!wasOpen) setProfileOpen(true); }}
          broadcastsOpen={broadcastsOpen}
          calendarOpen={activeView === 'calendar'}
          pollsOpen={activeView === 'polls'}
          notificationsOpen={notificationsOpen}
          onChannelsLoaded={handleChannelsLoaded}
          onRegisterRefresh={(fn) => { refreshSidebarRef.current = fn; }}
          onRegisterToggleFavorite={(fn) => { toggleFavoriteRef.current = fn; }}
        />
      </div>

      {/* Mobile: Sidebar backdrop overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Mobile: Hamburger toggle button */}
      <button
        onClick={() => setSidebarOpen((v) => !v)}
        className="fixed left-3 top-3 z-50 flex h-10 w-10 items-center justify-center rounded-lg bg-white/90 text-surface-700 shadow-md backdrop-blur hover:bg-white dark:bg-surface-800/90 dark:text-white lg:hidden"
        aria-label={sidebarOpen ? 'Menü schließen' : 'Menü öffnen'}
      >
        {sidebarOpen ? <X size={20} /> : <Menu size={20} />}
      </button>

      {activeView === 'calendar' ? (
        <CalendarView eventIdToOpen={eventIdToOpen} onEventOpened={() => setEventIdToOpen(null)} />
      ) : activeView === 'polls' ? (
        <PollsView pollIdToOpen={pollIdToOpen} onPollOpened={() => setPollIdToOpen(null)} />
      ) : (
        <>
          {activeChat
            ? <ChatView
                chat={activeChat}
                onGoHome={handleGoHome}
                onToggleFileBrowser={toggleFileBrowser}
                fileBrowserOpen={fileBrowserOpen}
                onOpenPolls={openPolls}
                onOpenPoll={openPoll}
                onOpenCalendar={openCalendar}
                onOpenEvent={openEvent}
                onToggleFlagged={toggleFlagged}
                flaggedOpen={flaggedOpen}
                jumpToMessageId={jumpToMessageId}
                jumpToMessageTime={jumpToMessageTime}
                jumpKey={jumpKey}
                onJumpComplete={handleJumpComplete}
                onStartCall={(calleeId: string, targetId: string, callee: CallParty) =>
                  startCall(calleeId, targetId, callee)
                }
                onToggleFavorite={handleToggleFavoriteFromChatView}
              />
            : homeView === 'cards'
              ? <FavoriteCardsView channels={channels} onSelectChat={handleSelectChat} />
              : <EmptyState />}
          {fileBrowserOpen && (
            <div className="fixed inset-0 z-40 flex lg:relative lg:inset-auto lg:z-auto">
              <FileBrowserPanel chat={activeChat} onClose={() => setFileBrowserOpen(false)} />
            </div>
          )}
          {broadcastsOpen && (
            <div className="fixed inset-0 z-40 flex lg:relative lg:inset-auto lg:z-auto">
              <BroadcastsPanel onClose={() => setBroadcastsOpen(false)} />
            </div>
          )}
          {flaggedOpen && (
            <div className="fixed inset-0 z-40 flex lg:relative lg:inset-auto lg:z-auto">
              <FlaggedMessagesPanel
                chat={activeChat}
                onClose={() => setFlaggedOpen(false)}
                onMessageClick={handleFlaggedMessageClick}
                jumpSearching={jumpSearching}
              />
            </div>
          )}
          {notificationsOpen && (
            <div className="fixed inset-0 z-40 flex lg:relative lg:inset-auto lg:z-auto">
              <NotificationsPanel onClose={() => setNotificationsOpen(false)} onOpenPolls={openPolls} onOpenPoll={openPoll} onOpenCalendar={openCalendar} onOpenEvent={openEvent} onChannelJoined={() => refreshSidebarRef.current?.()} />
            </div>
          )}
        </>
      )}
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      {profileOpen && <ProfileModal onClose={() => setProfileOpen(false)} />}
      {activeCall && (
        <CallModal
          call={activeCall}
          onAccept={acceptCall}
          onReject={rejectCall}
          onHangUp={hangUp}
          isMuted={isMuted}
          onToggleMute={toggleMute}
        />
      )}
    </div>
  );
}
