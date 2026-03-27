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

  // Close all side panels
  const closeAllPanels = () => {
    setSettingsOpen(false);
    setFileBrowserOpen(false);
    setBroadcastsOpen(false);
    setNotificationsOpen(false);
    setProfileOpen(false);
  };

  const toggleSettings = () => {
    closeAllPanels();
    setSettingsOpen((o) => !o);
  };

  const toggleFileBrowser = () => {
    closeAllPanels();
    setFileBrowserOpen((o) => !o);
  };

  const toggleBroadcasts = () => {
    closeAllPanels();
    setActiveView('chat');
    setBroadcastsOpen((o) => !o);
  };

  const openCalendar = () => {
    closeAllPanels();
    setActiveView('calendar');
  };

  const openPolls = () => {
    closeAllPanels();
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

  if (!loggedIn) {
    return <LoginPage />;
  }

  return (
    <div className="flex h-full">
      <Sidebar
        activeChat={activeChat}
        onSelectChat={handleSelectChat}
        loggedIn={loggedIn}
        onOpenFileBrowser={() => { closeAllPanels(); setFileBrowserOpen((o) => !o); }}
        onOpenBroadcasts={toggleBroadcasts}
        onOpenCalendar={openCalendar}
        onOpenPolls={openPolls}
        onOpenNotifications={() => { closeAllPanels(); setNotificationsOpen((o) => !o); }}
        onOpenSettings={toggleSettings}
        onOpenProfile={() => { closeAllPanels(); setProfileOpen(true); }}
        broadcastsOpen={broadcastsOpen}
        calendarOpen={activeView === 'calendar'}
        pollsOpen={activeView === 'polls'}
        notificationsOpen={notificationsOpen}
        onChannelsLoaded={handleChannelsLoaded}
      />

      {activeView === 'calendar' ? (
        <CalendarView />
      ) : activeView === 'polls' ? (
        <PollsView />
      ) : (
        <>
          {activeChat
            ? <ChatView
                chat={activeChat}
                onGoHome={handleGoHome}
                onToggleFileBrowser={toggleFileBrowser}
                fileBrowserOpen={fileBrowserOpen}
                onOpenPolls={openPolls}
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
