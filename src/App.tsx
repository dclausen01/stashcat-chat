import { useState } from 'react';
import { useAuth } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
import Sidebar from './components/Sidebar';
import ChatView from './components/ChatView';
import EmptyState from './components/EmptyState';
import SettingsPanel from './components/SettingsPanel';
import type { ChatTarget } from './types';

export default function App() {
  const { loggedIn } = useAuth();
  const [activeChat, setActiveChat] = useState<ChatTarget | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  if (!loggedIn) {
    return <LoginPage />;
  }

  return (
    <div className="flex h-full">
      <Sidebar activeChat={activeChat} onSelectChat={setActiveChat} loggedIn={loggedIn} />
      {activeChat
        ? <ChatView chat={activeChat} onToggleSettings={() => setSettingsOpen((o) => !o)} />
        : <EmptyState />}
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
