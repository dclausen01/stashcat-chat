import { useState, useCallback } from 'react';
import { useAuth } from './context/AuthContext';
import { useSettings } from './context/SettingsContext';
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
import type { ChatTarget } from './types';

type ActiveView = 'chat' | 'calendar' | 'polls';

export default function App() {
  const { loggedIn } = useAuth();
  const { homeView } = useSettings();
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
  const [jumpToMessageId, setJumpToMessageId] = useState<string | null>(null);

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
    setActiveView(wasOpen ? 'chat' : 'calendar');
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

  const handleSelectChat = (chat: ChatTarget) => {
    setActiveView('chat');
    closeAllPanels();
    setActiveChat(chat);
  };

  const handleGoHome = () => {
    closeAllPanels();
    setActiveChat(null);
  };

  const handleChannelsLoaded = useCallback((loadedChannels: ChatTarget[]) => {
    setChannels(loadedChannels);
  }, []);

  const handleFlaggedMessageClick = useCallback((messageId: string, chat: ChatTarget) => {
    // If clicking a message from a different chat, switch to that chat first
    if (activeChat?.id !== chat.id || activeChat?.type !== chat.type) {
      setActiveChat(chat);
    }
    // Set the message ID to jump to (ChatView will handle the scrolling)
    setJumpToMessageId(messageId);
  }, [activeChat]);

  const handleJumpComplete = useCallback(() => {
    setJumpToMessageId(null);
  }, []);

  if (!loggedIn) {
    return <LoginPage />;
  }

  return (
    <div className="flex h-full">
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
      />

      {activeView === 'calendar' ? (
        <CalendarView />
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
                onToggleFlagged={toggleFlagged}
                flaggedOpen={flaggedOpen}
                jumpToMessageId={jumpToMessageId}
                onJumpComplete={handleJumpComplete}
              />
            : homeView === 'cards'
              ? <FavoriteCardsView channels={channels} onSelectChat={handleSelectChat} />
              : <EmptyState />}
          {fileBrowserOpen && (
            <FileBrowserPanel chat={activeChat} onClose={() => setFileBrowserOpen(false)} />
          )}
          {broadcastsOpen && (
            <BroadcastsPanel onClose={() => setBroadcastsOpen(false)} />
          )}
          {flaggedOpen && (
            <FlaggedMessagesPanel
              chat={activeChat}
              onClose={() => setFlaggedOpen(false)}
              onMessageClick={handleFlaggedMessageClick}
            />
          )}
          {notificationsOpen && (
            <NotificationsPanel onClose={() => setNotificationsOpen(false)} onOpenPolls={openPolls} />
          )}
        </>
      )}
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
      {profileOpen && <ProfileModal onClose={() => setProfileOpen(false)} />}
    </div>
  );
}
