import { useState } from 'react';
import { useAuth } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
import Sidebar from './components/Sidebar';
import ChatView from './components/ChatView';
import EmptyState from './components/EmptyState';
import type { ChatTarget } from './types';

export default function App() {
  const { loggedIn } = useAuth();
  const [activeChat, setActiveChat] = useState<ChatTarget | null>(null);

  if (!loggedIn) {
    return <LoginPage />;
  }

  return (
    <div className="flex h-full">
      <Sidebar activeChat={activeChat} onSelectChat={setActiveChat} />
      {activeChat ? <ChatView chat={activeChat} /> : <EmptyState />}
    </div>
  );
}
