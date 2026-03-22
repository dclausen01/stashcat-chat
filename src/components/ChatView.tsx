import { useState, useEffect, useRef, useCallback } from 'react';
import { Hash, Lock, Users, ArrowDown, Loader2, Trash2, Copy } from 'lucide-react';
import { clsx } from 'clsx';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import * as api from '../api';
import { useAuth } from '../context/AuthContext';
import { useRealtimeEvents } from '../hooks/useRealtimeEvents';
import { fileIcon } from '../utils/fileIcon';
import Avatar from './Avatar';
import MessageInput from './MessageInput';
import type { ChatTarget, ChannelMember, Message } from '../types';

interface ChatViewProps {
  chat: ChatTarget;
}

interface TypingUser {
  userId: number;
  name?: string;
  at: number;
}

export default function ChatView({ chat }: ChatViewProps) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const [isManager, setIsManager] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef(chat);
  chatRef.current = chat;

  const userId = String((user as Record<string, unknown>)?.id || '');

  const loadMessages = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getMessages(chat.id, chat.type);
      setMessages(res as unknown as Message[]);
      // Mark latest message as read
      const msgs = res as unknown as Message[];
      const last = msgs[msgs.length - 1];
      if (last) api.markAsRead(chat.id, chat.type, String(last.id)).catch(() => {});
    } catch (err) {
      console.error('Failed to load messages:', err);
    } finally {
      setLoading(false);
    }
  }, [chat.id, chat.type]);

  // Check manager status when entering a channel
  useEffect(() => {
    setIsManager(false);
    if (chat.type !== 'channel') return;
    api.getChannelMembers(chat.id)
      .then((members) => {
        const me = (members as unknown as ChannelMember[]).find((m) => m.user_id === userId);
        setIsManager(me?.role === 'moderator');
      })
      .catch(() => {});
  }, [chat.id, chat.type, userId]);

  useEffect(() => {
    setMessages([]);
    setTypingUsers([]);
    loadMessages();
  }, [loadMessages]);

  useEffect(() => {
    if (!loading) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
    }
  }, [loading, messages.length]);

  // Clear stale typing indicators after 4 s
  useEffect(() => {
    if (typingUsers.length === 0) return;
    const id = setInterval(() => {
      const cutoff = Date.now() - 4000;
      setTypingUsers((prev) => prev.filter((t) => t.at > cutoff));
    }, 1000);
    return () => clearInterval(id);
  }, [typingUsers.length]);

  // Realtime: new messages + typing indicators
  useRealtimeEvents({
    message_sync: (data) => {
      const payload = data as Record<string, unknown>;
      const currentChat = chatRef.current;
      const belongsHere =
        (currentChat.type === 'channel' && String(payload.channel_id) === currentChat.id) ||
        (currentChat.type === 'conversation' && String(payload.conversation_id) === currentChat.id);
      if (!belongsHere) return;

      // Append new message to state (avoid re-fetch)
      const newMsg = payload as unknown as Message;
      setMessages((prev) => {
        if (prev.find((m) => String(m.id) === String(newMsg.id))) return prev;
        const updated = [...prev, newMsg].sort(
          (a, b) => (Number(a.time) || 0) - (Number(b.time) || 0)
        );
        return updated;
      });
      // Auto-scroll if already at bottom
      if (containerRef.current) {
        const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
        if (scrollHeight - scrollTop - clientHeight < 150) {
          requestAnimationFrame(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }));
        }
      }
    },
    typing: (data) => {
      const { chatType, chatId, userId: typingUserId } = data as { chatType: string; chatId: number; userId: number };
      const currentChat = chatRef.current;
      if (
        chatType !== currentChat.type ||
        String(chatId) !== currentChat.id ||
        String(typingUserId) === userId
      ) return;
      setTypingUsers((prev) => {
        const filtered = prev.filter((t) => t.userId !== typingUserId);
        return [...filtered, { userId: typingUserId, at: Date.now() }];
      });
    },
  }, true);

  const handleScroll = () => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    setShowScrollBtn(scrollHeight - scrollTop - clientHeight > 200);
  };

  const handleDelete = useCallback(async (messageId: string) => {
    if (!confirm('Nachricht wirklich löschen?')) return;
    try {
      await api.deleteMessage(messageId);
      setMessages((prev) => prev.filter((m) => String(m.id) !== messageId));
    } catch (err) {
      alert(`Löschen fehlgeschlagen: ${err instanceof Error ? err.message : err}`);
    }
  }, []);

  const handleSend = async (text: string) => {
    await api.sendMessage(chat.id, chat.type, text);
    await loadMessages();
  };

  const handleUpload = async (file: File, text: string) => {
    await api.uploadFile(chat.type, chat.id, file, text);
    await loadMessages();
  };

  const handleTyping = useCallback(() => {
    api.sendTyping(chat.type, chat.id).catch(() => {});
  }, [chat.type, chat.id]);

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
              <MessageGroup key={gi} group={group} canDeleteAll={isManager && chat.type === 'channel'} onDelete={handleDelete} />
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

      {/* Typing indicator */}
      {typingUsers.length > 0 && (
        <div className="shrink-0 px-6 pb-1 text-xs text-surface-400 italic">
          {typingUsers.length === 1
            ? 'Jemand tippt…'
            : `${typingUsers.length} Personen tippen…`}
          <span className="ml-1 inline-flex gap-0.5">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="inline-block h-1 w-1 rounded-full bg-surface-400"
                style={{ animation: `bounce 1.2s ${i * 0.2}s infinite` }}
              />
            ))}
          </span>
        </div>
      )}

      <MessageInput onSend={handleSend} onUpload={handleUpload} onTyping={handleTyping} chatName={chat.name} />
    </div>
  );
}

function MessageGroup({
  group,
  canDeleteAll,
  onDelete,
}: {
  group: { sender: Message['sender']; isOwn: boolean; messages: Message[] };
  canDeleteAll: boolean;
  onDelete: (messageId: string) => void;
}) {
  const { sender, isOwn, messages } = group;
  const senderName = sender ? `${sender.first_name} ${sender.last_name}` : 'Unbekannt';

  return (
    <div className={clsx('flex gap-2', isOwn ? 'flex-row-reverse' : 'flex-row')}>
      {!isOwn && (
        <div className="shrink-0 pt-0.5">
          <Avatar name={senderName} size="sm" />
        </div>
      )}

      <div className={clsx('flex max-w-[75%] flex-col gap-0.5', isOwn ? 'items-end' : 'items-start')}>
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
          const content = msg.text || (msg.encrypted ? '🔒 *Verschlüsselte Nachricht*' : '');

          const canDelete = isOwn || canDeleteAll;

          return (
            <div key={msg.id} className={clsx('group/msg flex flex-col gap-0.5', isOwn ? 'items-end' : 'items-start')}>
              <div className={clsx('flex items-center gap-1', isOwn ? 'flex-row-reverse' : 'flex-row')}>
                <div
                  className={clsx(
                    'relative max-w-full px-3 py-2 text-sm leading-relaxed',
                    isOwn
                      ? 'rounded-2xl bg-primary-600 text-white'
                      : 'rounded-2xl bg-surface-100 text-surface-900 dark:bg-surface-800 dark:text-surface-100',
                    isOwn && !isFirst && 'rounded-tr-md',
                    isOwn && !isLast && 'rounded-br-md',
                    !isOwn && !isFirst && 'rounded-tl-md',
                    !isOwn && !isLast && 'rounded-bl-md',
                  )}
                >
                <MarkdownContent content={content} isOwn={isOwn} />

                {msg.files && msg.files.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {msg.files.map((f) => (
                      <a
                        key={f.id}
                        href={api.fileDownloadUrl(f.id, f.name)}
                        download={f.name}
                        title={`${f.name} herunterladen`}
                        className={clsx(
                          'inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition',
                          isOwn
                            ? 'bg-primary-700 text-primary-100 hover:bg-primary-800'
                            : 'bg-surface-200 text-surface-600 hover:bg-surface-300 dark:bg-surface-700 dark:text-surface-300 dark:hover:bg-surface-600',
                        )}
                      >
                        <span>{fileIcon(f.mime, f.ext)}</span>
                        <span className="max-w-[160px] truncate">{f.name}</span>
                        {f.size_string && <span className="opacity-60">({f.size_string})</span>}
                      </a>
                    ))}
                  </div>
                )}
                </div>

                {/* Action buttons — visible on hover */}
                <div className="hidden group-hover/msg:flex items-center gap-0.5">
                  <button
                    onClick={() => { if (msg.text) navigator.clipboard.writeText(msg.text).catch(() => {}); }}
                    title="Nachricht kopieren"
                    className="flex items-center justify-center rounded-md p-1 text-surface-400 hover:bg-surface-200 hover:text-surface-700 dark:hover:bg-surface-700 dark:hover:text-surface-200 transition"
                  >
                    <Copy size={14} />
                  </button>
                  {canDelete && (
                    <button
                      onClick={() => onDelete(String(msg.id))}
                      title="Nachricht löschen"
                      className="flex items-center justify-center rounded-md p-1 text-surface-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400 transition"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              </div>

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

function MarkdownContent({ content, isOwn }: { content: string; isOwn: boolean }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="m-0">{children}</p>,
        strong: ({ children }) => <strong className="font-bold">{children}</strong>,
        em: ({ children }) => <em className="italic">{children}</em>,
        del: ({ children }) => <del className="line-through opacity-75">{children}</del>,
        code: ({ children, className }) => {
          const isBlock = className?.includes('language-');
          return isBlock ? (
            <code className={clsx(
              'block overflow-x-auto rounded-lg px-3 py-2 font-mono text-xs my-1',
              isOwn ? 'bg-primary-700 text-primary-100' : 'bg-surface-200 text-surface-800 dark:bg-surface-700 dark:text-surface-200',
            )}>{children}</code>
          ) : (
            <code className={clsx(
              'rounded px-1 py-0.5 font-mono text-xs',
              isOwn ? 'bg-primary-700 text-primary-100' : 'bg-surface-200 text-surface-800 dark:bg-surface-700 dark:text-surface-200',
            )}>{children}</code>
          );
        },
        h1: ({ children }) => <h1 className="text-lg font-bold mb-1 mt-0">{children}</h1>,
        h2: ({ children }) => <h2 className="text-base font-bold mb-1 mt-0">{children}</h2>,
        h3: ({ children }) => <h3 className="text-sm font-bold mb-0.5 mt-0">{children}</h3>,
        ul: ({ children }) => <ul className="my-1 ml-4 list-disc space-y-0.5">{children}</ul>,
        ol: ({ children }) => <ol className="my-1 ml-4 list-decimal space-y-0.5">{children}</ol>,
        li: ({ children }) => <li className="text-sm">{children}</li>,
        blockquote: ({ children }) => (
          <blockquote className={clsx(
            'my-1 border-l-2 pl-3 italic',
            isOwn ? 'border-primary-300 opacity-80' : 'border-surface-400',
          )}>{children}</blockquote>
        ),
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer"
            className={clsx('underline', isOwn ? 'text-primary-200 hover:text-white' : 'text-primary-600 hover:text-primary-800 dark:text-primary-400')}>
            {children}
          </a>
        ),
        hr: () => <hr className={clsx('my-1 border-t', isOwn ? 'border-primary-400' : 'border-surface-300 dark:border-surface-600')} />,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
