import { useState, useEffect, useRef, useCallback } from 'react';
import { Hash, Lock, Users, ArrowDown, Loader2 } from 'lucide-react';
import * as api from '../api';
import { useAuth } from '../context/AuthContext';
import Avatar from './Avatar';
import MessageInput from './MessageInput';
import type { ChatTarget, Message } from '../types';

interface ChatViewProps {
  chat: ChatTarget;
}

export default function ChatView({ chat }: ChatViewProps) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const userId = String((user as Record<string, unknown>)?.id || '');

  const loadMessages = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getMessages(chat.id, chat.type);
      const msgs = (res.messages as unknown as Message[]).reverse();
      setMessages(msgs);
      // Mark as read
      api.markAsRead(chat.id, chat.type).catch(() => {});
    } catch (err) {
      console.error('Failed to load messages:', err);
    } finally {
      setLoading(false);
    }
  }, [chat.id, chat.type]);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    if (!loading) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
    }
  }, [loading, messages.length]);

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    setShowScrollBtn(scrollHeight - scrollTop - clientHeight > 200);
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSend = async (text: string) => {
    await api.sendMessage(chat.id, chat.type, text);
    await loadMessages();
  };

  return (
    <div className="flex h-full flex-1 flex-col bg-white dark:bg-surface-950">
      {/* Chat header */}
      <div className="flex items-center gap-3 border-b border-surface-200 px-6 py-3 dark:border-surface-700">
        {chat.type === 'channel' ? (
          <Hash size={22} className="text-surface-400" />
        ) : (
          <Avatar name={chat.name} size="md" />
        )}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-surface-900 dark:text-white">
            {chat.name}
          </h2>
        </div>
        {chat.encrypted && (
          <div className="flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700 dark:bg-green-900/20 dark:text-green-400">
            <Lock size={12} />
            Verschlüsselt
          </div>
        )}
        <button className="rounded-lg p-2 text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800">
          <Users size={20} />
        </button>
      </div>

      {/* Messages */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="relative flex-1 overflow-y-auto px-6 py-4"
      >
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 size={32} className="animate-spin text-primary-500" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-surface-400">
            <Hash size={48} className="mb-3" />
            <p className="text-lg font-medium">Noch keine Nachrichten</p>
            <p className="text-sm">Schreibe die erste Nachricht!</p>
          </div>
        ) : (
          <>
            {messages.map((msg, i) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                isOwn={String(msg.sender?.id) === userId}
                showAvatar={i === 0 || String(messages[i - 1]?.sender?.id) !== String(msg.sender?.id)}
              />
            ))}
          </>
        )}
        <div ref={messagesEndRef} />

        {showScrollBtn && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-4 right-6 rounded-full bg-primary-600 p-2 text-white shadow-lg transition hover:bg-primary-700"
          >
            <ArrowDown size={20} />
          </button>
        )}
      </div>

      {/* Input */}
      <MessageInput onSend={handleSend} chatName={chat.name} />
    </div>
  );
}

function MessageBubble({ message, isOwn, showAvatar }: { message: Message; isOwn: boolean; showAvatar: boolean }) {
  const senderName = message.sender
    ? `${message.sender.first_name} ${message.sender.last_name}`
    : 'Unbekannt';

  const time = message.time
    ? new Date(message.time * 1000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <div className={`group flex gap-3 ${showAvatar ? 'mt-4' : 'mt-0.5'} ${isOwn ? '' : ''}`}>
      <div className="w-10 shrink-0">
        {showAvatar && <Avatar name={senderName} size="md" />}
      </div>
      <div className="min-w-0 flex-1">
        {showAvatar && (
          <div className="mb-0.5 flex items-baseline gap-2">
            <span className="text-sm font-semibold text-surface-900 dark:text-white">{senderName}</span>
            <span className="text-xs text-surface-400">{time}</span>
          </div>
        )}
        <div className="text-sm leading-relaxed text-surface-700 dark:text-surface-300">
          {message.text || (message.encrypted ? '🔒 Verschlüsselte Nachricht' : '')}
        </div>
        {message.files && message.files.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-2">
            {message.files.map((f) => (
              <div
                key={f.id}
                className="inline-flex items-center gap-1.5 rounded-lg bg-surface-100 px-3 py-1.5 text-xs font-medium text-surface-600 dark:bg-surface-800 dark:text-surface-400"
              >
                📎 {f.name}
                {f.size_string && <span className="text-surface-400">({f.size_string})</span>}
              </div>
            ))}
          </div>
        )}
        {(message.likes ?? 0) > 0 && (
          <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-surface-100 px-2 py-0.5 text-xs text-surface-500 dark:bg-surface-800">
            ❤️ {message.likes}
          </div>
        )}
      </div>
    </div>
  );
}
