import { useState, useEffect, useRef, useCallback } from 'react';
import { Hash, Lock, Users, ArrowDown, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
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
      const msgs = (res as unknown as Message[]).reverse();
      setMessages(msgs);
      api.markAsRead(chat.id, chat.type).catch(() => {});
    } catch (err) {
      console.error('Failed to load messages:', err);
    } finally {
      setLoading(false);
    }
  }, [chat.id, chat.type]);

  useEffect(() => { loadMessages(); }, [loadMessages]);

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

  const handleSend = async (text: string) => {
    await api.sendMessage(chat.id, chat.type, text);
    await loadMessages();
  };

  // Group consecutive messages by sender
  const groups: Array<{ sender: Message['sender']; isOwn: boolean; messages: Message[] }> = [];
  for (const msg of messages) {
    const isOwn = String(msg.sender?.id) === userId;
    const last = groups[groups.length - 1];
    if (last && String(last.sender?.id) === String(msg.sender?.id)) {
      last.messages.push(msg);
    } else {
      groups.push({ sender: msg.sender, isOwn, messages: [msg] });
    }
  }

  return (
    <div className="flex h-full flex-1 flex-col bg-white dark:bg-surface-950">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-surface-200 px-6 py-3 dark:border-surface-700">
        {chat.type === 'channel' ? (
          <Hash size={22} className="text-surface-400" />
        ) : (
          <Avatar name={chat.name} size="md" />
        )}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-surface-900 dark:text-white">{chat.name}</h2>
        </div>
        {chat.encrypted && (
          <div className="flex items-center gap-1 rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-700 dark:bg-green-900/20 dark:text-green-400">
            <Lock size={12} /> Verschlüsselt
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
        className="relative flex-1 overflow-y-auto px-4 py-4"
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
          <div className="flex flex-col gap-4">
            {groups.map((group, gi) => (
              <MessageGroup key={gi} group={group} />
            ))}
          </div>
        )}
        <div ref={messagesEndRef} />

        {showScrollBtn && (
          <button
            onClick={() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })}
            className="absolute bottom-4 right-6 rounded-full bg-primary-600 p-2 text-white shadow-lg transition hover:bg-primary-700"
          >
            <ArrowDown size={20} />
          </button>
        )}
      </div>

      <MessageInput onSend={handleSend} chatName={chat.name} />
    </div>
  );
}

function MessageGroup({ group }: { group: { sender: Message['sender']; isOwn: boolean; messages: Message[] } }) {
  const { sender, isOwn, messages } = group;
  const senderName = sender ? `${sender.first_name} ${sender.last_name}` : 'Unbekannt';

  return (
    <div className={clsx('flex gap-2', isOwn ? 'flex-row-reverse' : 'flex-row')}>
      {/* Avatar — only for others, aligned to first bubble */}
      {!isOwn && (
        <div className="shrink-0 pt-0.5">
          <Avatar name={senderName} size="sm" />
        </div>
      )}

      <div className={clsx('flex max-w-[75%] flex-col gap-0.5', isOwn ? 'items-end' : 'items-start')}>
        {/* Sender name — only for others */}
        {!isOwn && (
          <span className="mb-0.5 pl-1 text-xs font-semibold text-surface-600 dark:text-surface-400">
            {senderName}
          </span>
        )}

        {messages.map((msg, i) => {
          const time = msg.time
            ? new Date(msg.time * 1000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
            : '';
          const isFirst = i === 0;
          const isLast = i === messages.length - 1;

          return (
            <div key={msg.id} className={clsx('group flex flex-col gap-0.5', isOwn ? 'items-end' : 'items-start')}>
              <div
                className={clsx(
                  'relative max-w-full px-3 py-2 text-sm leading-relaxed',
                  // Bubble shape with rounded corners, flat on grouped sides
                  isOwn
                    ? 'rounded-2xl bg-primary-600 text-white'
                    : 'rounded-2xl bg-surface-100 text-surface-900 dark:bg-surface-800 dark:text-surface-100',
                  // Flatten the corner where bubbles connect
                  isOwn && !isFirst ? 'rounded-tr-md' : '',
                  isOwn && !isLast ? 'rounded-br-md' : '',
                  !isOwn && !isFirst ? 'rounded-tl-md' : '',
                  !isOwn && !isLast ? 'rounded-bl-md' : '',
                )}
              >
                {msg.text || (msg.encrypted ? '🔒 Verschlüsselte Nachricht' : '')}

                {msg.files && msg.files.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {msg.files.map((f) => (
                      <div
                        key={f.id}
                        className={clsx(
                          'inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium',
                          isOwn
                            ? 'bg-primary-700 text-primary-100'
                            : 'bg-surface-200 text-surface-600 dark:bg-surface-700 dark:text-surface-300',
                        )}
                      >
                        📎 {f.name}
                        {f.size_string && <span className="opacity-70">({f.size_string})</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Timestamp + likes — shown on hover or for last message */}
              {isLast && (
                <div className={clsx('flex items-center gap-1.5 px-1', isOwn ? 'flex-row-reverse' : 'flex-row')}>
                  <span className="text-xs text-surface-400">{time}</span>
                  {(msg.likes ?? 0) > 0 && (
                    <span className="text-xs text-surface-400">❤️ {msg.likes}</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
