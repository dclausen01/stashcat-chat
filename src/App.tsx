import { useState, useCallback, useRef, useMemo } from 'react';
import { useAuth } from './context/AuthContext';
import { useSettings } from './context/SettingsContext';
import { useCallManager } from './hooks/useCallManager';
import { useHotkeys } from './hooks/useHotkeys';
import LoginPage from './pages/LoginPage';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
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
import QuickSwitcher from './components/QuickSwitcher';
import ShortcutsModal from './components/ShortcutsModal';
import type { ChatTarget } from './types';
import type { CallParty } from './api/calls';

type ActiveView = 'chat' | 'calendar' | 'polls';

export default function App() {
  const { loggedIn } = useAuth();
  const { homeView } = useSettings();
  const { activeCall, startCall, acceptCall, rejectCall, hangUp, isMuted, toggleMute } = useCallManager(loggedIn);
  const [activeChat, setActiveChat] = useState<ChatTarget | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fileBrowserOpen, setFileBrowserOpen] = useState(false);
  const [fileBrowserStandalone, setFileBrowserStandalone] = useState(false);
  const [topBarUnread, setTopBarUnread] = useState({ total: 0, channels: [] as ChatTarget[], conversations: [] as ChatTarget[] });
  const [broadcastsOpen, setBroadcastsOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [activeView, setActiveView] = useState<ActiveView>('chat');
  const [channels, setChannels] = useState<ChatTarget[]>([]);
  const [conversations, setConversations] = useState<ChatTarget[]>([]);
  const [profileOpen, setProfileOpen] = useState(false);
  const [flaggedOpen, setFlaggedOpen] = useState(false);
  const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [pollIdToOpen, setPollIdToOpen] = useState<string | null>(null);
  const [eventIdToOpen, setEventIdToOpen] = useState<string | null>(null);
  const [jumpToMessageId, setJumpToMessageId] = useState<string | null>(null);
  const [jumpToMessageTime, setJumpToMessageTime] = useState<number | null>(null);
  const [jumpKey, setJumpKey] = useState(0);
  const [jumpSearching, setJumpSearching] = useState(false);
  const refreshSidebarRef = useRef<(() => void) | null>(null);
  const toggleFavoriteRef = useRef<((target: ChatTarget) => void) | null>(null);

  // Close all side panels — defined before use to avoid forward reference
  const closeAllPanels = useCallback(() => {
    setSettingsOpen(false);
    setFileBrowserOpen(false);
    setBroadcastsOpen(false);
    setNotificationsOpen(false);
    setProfileOpen(false);
    setFlaggedOpen(false);
  }, []);

  const handleSelectChat = useCallback((chat: ChatTarget) => {
    setActiveView('chat');
    closeAllPanels();
    setActiveChat(chat);
  }, [closeAllPanels]);

  const handleToggleFavoriteFromChatView = useCallback((chat: ChatTarget) => {
    setActiveChat((prev) => prev?.id === chat.id ? { ...prev, favorite: !prev.favorite } : prev);
    toggleFavoriteRef.current?.(chat);
  }, []);

  const toggleSettings = () => {
    const wasOpen = settingsOpen;
    closeAllPanels();
    if (!wasOpen) setSettingsOpen(true);
  };

  const toggleFileBrowser = () => {
    const wasOpen = fileBrowserOpen && !fileBrowserStandalone;
    closeAllPanels();
    setFileBrowserStandalone(false);
    if (!wasOpen) setFileBrowserOpen(true);
  };

  const openFileBrowserStandalone = () => {
    const wasOpen = fileBrowserOpen && fileBrowserStandalone;
    closeAllPanels();
    setActiveView('chat');
    if (!wasOpen) {
      setFileBrowserStandalone(true);
      setFileBrowserOpen(true);
    }
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
  };

  const handleChannelsLoaded = useCallback((loadedChannels: ChatTarget[]) => {
    setChannels(loadedChannels);
  }, []);

  const handleConversationsLoaded = useCallback((loadedConversations: ChatTarget[]) => {
    setConversations(loadedConversations);
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

  // Keyboard shortcuts (only when logged in)
  const hotkeys = useMemo(() => loggedIn ? [
    { key: 'k', mod: true, handler: (e: KeyboardEvent) => { e.preventDefault(); setQuickSwitcherOpen(true); } },
    { key: ',', mod: true, handler: (e: KeyboardEvent) => { e.preventDefault(); closeAllPanels(); setSettingsOpen(true); } },
    { key: 'c', alt: true, handler: (e: KeyboardEvent) => { e.preventDefault(); closeAllPanels(); setEventIdToOpen(null); setActiveView('calendar'); } },
    { key: 'b', alt: true, handler: (e: KeyboardEvent) => { e.preventDefault(); closeAllPanels(); setActiveView('chat'); setBroadcastsOpen(true); } },
    { key: 'u', alt: true, handler: (e: KeyboardEvent) => { e.preventDefault(); closeAllPanels(); setPollIdToOpen(null); setActiveView('polls'); } },
    { key: '?', shift: true, handler: (e: KeyboardEvent) => { e.preventDefault(); setShortcutsOpen(true); } },
  ] : [], [loggedIn, closeAllPanels]);
  useHotkeys(hotkeys, loggedIn);

  // On mobile: when nothing else is open, the Sidebar is the home screen (fullscreen).
  // When activeChat or any panel/view is open, the Sidebar is hidden and that takes over.
  // On desktop: Sidebar is always visible (md:flex).
  const nothingElseOpen =
    !activeChat && !settingsOpen && !fileBrowserOpen && !broadcastsOpen &&
    !notificationsOpen && !flaggedOpen && !profileOpen && activeView === 'chat';

  if (!loggedIn) {
    return <LoginPage />;
  }

  const showHomeButton = activeChat !== null || fileBrowserStandalone || activeView !== 'chat';

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* TopBar — Desktop only, full width over sidebar + main area */}
      <TopBar
        totalUnread={topBarUnread.total}
        unreadChannels={topBarUnread.channels}
        unreadConversations={topBarUnread.conversations}
        onSelectChat={handleSelectChat}
        notificationsOpen={notificationsOpen}
        onOpenNotifications={() => { const wasOpen = notificationsOpen; closeAllPanels(); if (!wasOpen) setNotificationsOpen(true); }}
        fileBrowserOpen={fileBrowserOpen && fileBrowserStandalone}
        onOpenFileBrowser={openFileBrowserStandalone}
        broadcastsOpen={broadcastsOpen}
        onOpenBroadcasts={toggleBroadcasts}
        calendarOpen={activeView === 'calendar'}
        onOpenCalendar={openCalendar}
        pollsOpen={activeView === 'polls'}
        onOpenPolls={openPolls}
        showHomeButton={showHomeButton}
        onGoHome={handleGoHome}
        onOpenProfile={() => { const wasOpen = profileOpen; closeAllPanels(); if (!wasOpen) setProfileOpen(true); }}
        onOpenSettings={toggleSettings}
      />

      {/* Bottom area: Sidebar + Main content (flex-row) */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar: fullscreen home on mobile when nothing else is open; always visible on desktop */}
        <div className={`shrink-0 ${nothingElseOpen ? 'flex w-full' : 'hidden'} md:flex md:w-auto`}>
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
            onConversationsLoaded={handleConversationsLoaded}
            onRegisterRefresh={(fn) => { refreshSidebarRef.current = fn; }}
            onRegisterToggleFavorite={(fn) => { toggleFavoriteRef.current = fn; }}
            onGoHome={handleGoHome}
            onUnreadChange={(total, ch, cv) => setTopBarUnread({ total, channels: ch, conversations: cv })}
          />
        </div>

        {/* Main content — hidden on mobile when sidebar is fullscreen home */}
        <div className={`flex flex-1 overflow-hidden ${nothingElseOpen ? 'hidden' : 'flex'} md:flex`}>
          {activeView === 'calendar' ? (
            <CalendarView eventIdToOpen={eventIdToOpen} onEventOpened={() => setEventIdToOpen(null)} onClose={() => setActiveView('chat')} />
          ) : activeView === 'polls' ? (
            <PollsView pollIdToOpen={pollIdToOpen} onPollOpened={() => setPollIdToOpen(null)} onClose={() => setActiveView('chat')} />
          ) : fileBrowserStandalone && fileBrowserOpen ? (
            // Standalone FileBrowser — full main area
            <FileBrowserPanel
              chat={null}
              onClose={() => { setFileBrowserOpen(false); setFileBrowserStandalone(false); }}
              fullscreen
            />
          ) : (
            <>
              {activeChat
                ? <ChatView
                    chat={activeChat}
                    onGoHome={handleGoHome}
                    onToggleFileBrowser={toggleFileBrowser}
                    fileBrowserOpen={fileBrowserOpen && !fileBrowserStandalone}
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
                  // FavoriteCardsView is hidden on mobile — Sidebar is the mobile home screen.
                  ? <div className="hidden flex-1 md:flex"><FavoriteCardsView channels={channels} conversations={conversations} onSelectChat={handleSelectChat} /></div>
                  : <div className="hidden flex-1 md:flex"><EmptyState /></div>}
              {fileBrowserOpen && !fileBrowserStandalone && (
                <div className="fixed inset-0 z-40 flex md:relative md:inset-auto md:z-auto">
                  <FileBrowserPanel chat={activeChat} onClose={() => setFileBrowserOpen(false)} />
                </div>
              )}
              {broadcastsOpen && (
                <div className="fixed inset-0 z-40 flex md:relative md:inset-auto md:z-auto">
                  <BroadcastsPanel onClose={() => setBroadcastsOpen(false)} />
                </div>
              )}
              {flaggedOpen && (
                <div className="fixed inset-0 z-40 flex md:relative md:inset-auto md:z-auto">
                  <FlaggedMessagesPanel
                    chat={activeChat}
                    onClose={() => setFlaggedOpen(false)}
                    onMessageClick={handleFlaggedMessageClick}
                    jumpSearching={jumpSearching}
                  />
                </div>
              )}
              {notificationsOpen && (
                <div className="fixed inset-0 z-40 flex md:relative md:inset-auto md:z-auto">
                  <NotificationsPanel onClose={() => setNotificationsOpen(false)} onOpenPolls={openPolls} onOpenPoll={openPoll} onOpenCalendar={openCalendar} onOpenEvent={openEvent} onChannelJoined={() => refreshSidebarRef.current?.()} />
                </div>
              )}
            </>
          )}
          {settingsOpen && (
            <div className="fixed inset-0 z-50 flex md:relative md:inset-auto md:z-auto">
              <SettingsPanel onClose={() => setSettingsOpen(false)} />
            </div>
          )}
          {profileOpen && (
            <div className="fixed inset-0 z-50 flex md:items-center md:justify-center md:bg-black/50">
              <ProfileModal onClose={() => setProfileOpen(false)} />
            </div>
          )}
        </div>
      </div>

      {/* Full-screen modals (outside layout flow) */}
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
      {quickSwitcherOpen && (
        <QuickSwitcher
          channels={channels}
          conversations={conversations}
          onSelect={handleSelectChat}
          onClose={() => setQuickSwitcherOpen(false)}
        />
      )}
      {shortcutsOpen && (
        <ShortcutsModal onClose={() => setShortcutsOpen(false)} />
      )}
    </div>
  );
}
