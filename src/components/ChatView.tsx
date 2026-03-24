import { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { Hash, Users, FolderOpen, ArrowDown, Loader2, Trash2, Copy, Settings, ThumbsUp, X, ExternalLink, FileText, Pencil, Forward, Search } from 'lucide-react';
import { clsx } from 'clsx';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import * as api from '../api';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { useRealtimeEvents } from '../hooks/useRealtimeEvents';
import { fileIcon } from '../utils/fileIcon';
import Avatar from './Avatar';
import MessageInput from './MessageInput';
import ChannelMembersPanel from './ChannelMembersPanel';
import LinkPreviewCard from './LinkPreviewCard';
import ChannelDescriptionEditor from './ChannelDescriptionEditor';
import type { ChatTarget, ChannelMember, Message } from '../types';

interface ChatViewProps {
  chat: ChatTarget;
  onToggleSettings: () => void;
  onToggleFileBrowser: () => void;
  fileBrowserOpen: boolean;
}

interface TypingUser {
  userId: number;
  name?: string;
  at: number;
}

const PAGE_SIZE = 50;
const SYSTEM_KINDS = new Set(['joined', 'left', 'removed', 'call_start', 'call_end']);

export default function ChatView({ chat, onToggleSettings, onToggleFileBrowser, fileBrowserOpen }: ChatViewProps) {
  const { user } = useAuth();
  const settings = useSettings();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const [isManager, setIsManager] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [pdfView, setPdfView] = useState<{ fileId: string; viewUrl: string; name: string } | null>(null);
  const [descEditorOpen, setDescEditorOpen] = useState(false);
  const [chatDescription, setChatDescription] = useState(chat.description || '');
  const [forwardMsg, setForwardMsg] = useState<Message | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef(chat);
  chatRef.current = chat;
  const paginationOffsetRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const hasMoreRef = useRef(true);

  const userId = String((user as Record<string, unknown>)?.id || '');

  const loadMessages = useCallback(async () => {
    setLoading(true);
    setHasMore(true);
    hasMoreRef.current = true;
    paginationOffsetRef.current = 0;
    try {
      const res = await api.getMessages(chat.id, chat.type, PAGE_SIZE, 0);
      const msgs = res as unknown as Message[];
      setMessages(msgs);
      if (msgs.length < PAGE_SIZE) {
        setHasMore(false);
        hasMoreRef.current = false;
      }
      paginationOffsetRef.current = msgs.length;
      // Mark latest message as read
      const last = msgs[msgs.length - 1];
      if (last) api.markAsRead(chat.id, chat.type, String(last.id)).catch(() => {});
    } catch (err) {
      console.error('Failed to load messages:', err);
    } finally {
      setLoading(false);
    }
  }, [chat.id, chat.type]);

  const loadOlder = useCallback(async () => {
    if (loadingMoreRef.current || !hasMoreRef.current) return;
    const container = containerRef.current;
    if (!container) return;

    loadingMoreRef.current = true;
    setLoadingMore(true);
    const prevHeight = container.scrollHeight;

    try {
      const res = await api.getMessages(chat.id, chat.type, PAGE_SIZE, paginationOffsetRef.current);
      const older = res as unknown as Message[];

      if (older.length < PAGE_SIZE) {
        setHasMore(false);
        hasMoreRef.current = false;
      }

      if (older.length > 0) {
        paginationOffsetRef.current += older.length;
        setMessages((prev) => {
          const combined = [...older, ...prev];
          const deduped = combined.filter(
            (m, idx, arr) => arr.findIndex((x) => String(x.id) === String(m.id)) === idx
          );
          return deduped.sort((a, b) => (Number(a.time) || 0) - (Number(b.time) || 0));
        });
        // Preserve scroll position after prepend
        requestAnimationFrame(() => {
          if (container) container.scrollTop = container.scrollHeight - prevHeight;
        });
      }
    } catch (err) {
      console.error('Failed to load older messages:', err);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [chat.id, chat.type]);

  // Check manager status when entering a channel
  // The API returns { id, manager: boolean } — not { user_id, role }
  useEffect(() => {
    setIsManager(false);
    if (chat.type !== 'channel') return;
    api.getChannelMembers(chat.id)
      .then((members) => {
        const raw = members as Array<Record<string, unknown>>;
        const me = raw.find(
          (m) => String(m.user_id ?? m.id) === userId
        );
        // manager: true = moderator/owner, manager: false or role 'member' = regular
        const isMgr = me?.manager === true ||
          (me?.role !== undefined && me?.role !== 'member');
        setIsManager(!!me && isMgr);
      })
      .catch(() => {});
  }, [chat.id, chat.type, userId]);

  useEffect(() => {
    setMessages([]);
    setTypingUsers([]);
    setChatDescription(chat.description || '');
    loadMessages();
  }, [loadMessages, chat.description]);

  // Scroll to bottom after initial load
  useEffect(() => {
    if (!loading) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'instant' });
    }
  }, [loading]);

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

      const newMsg = payload as unknown as Message;
      setMessages((prev) => {
        if (prev.find((m) => String(m.id) === String(newMsg.id))) return prev;
        return [...prev, newMsg].sort((a, b) => (Number(a.time) || 0) - (Number(b.time) || 0));
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

  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    setShowScrollBtn(scrollHeight - scrollTop - clientHeight > 200);
    // Trigger load-more when near the top
    if (scrollTop < 80 && !loadingMoreRef.current && hasMoreRef.current) {
      loadOlder();
    }
  }, [loadOlder]);

  const handleDelete = useCallback(async (messageId: string) => {
    if (!confirm('Nachricht wirklich löschen?')) return;
    try {
      await api.deleteMessage(messageId);
      setMessages((prev) => prev.filter((m) => String(m.id) !== messageId));
    } catch (err) {
      alert(`Löschen fehlgeschlagen: ${err instanceof Error ? err.message : err}`);
    }
  }, []);

  const handleLike = useCallback(async (messageId: string, liked: boolean) => {
    try {
      if (liked) {
        await api.unlikeMessage(messageId);
      } else {
        await api.likeMessage(messageId);
      }
      setMessages((prev) => prev.map((m) =>
        String(m.id) === messageId
          ? { ...m, liked: !liked, likes: (m.likes ?? 0) + (liked ? -1 : 1) }
          : m
      ));
    } catch (err) {
      console.error('Like failed:', err);
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

  // Build a map of message IDs for reply lookups
  const messageMap = new Map(messages.map((m) => [Number(m.id), m]));

  // Separate system messages from regular ones; group regular by sender
  const groups: Array<{ sender: Message['sender']; isOwn: boolean; messages: Message[]; isSystem?: boolean }> = [];
  for (const msg of messages) {
    if (SYSTEM_KINDS.has(msg.kind ?? '')) {
      groups.push({ sender: msg.sender, isOwn: false, messages: [msg], isSystem: true });
      continue;
    }
    const isOwn = String(msg.sender?.id) === userId;
    const last = groups[groups.length - 1];
    if (last && !last.isSystem && String(last.sender?.id) === String(msg.sender?.id)) {
      last.messages.push(msg);
    } else {
      groups.push({ sender: msg.sender, isOwn, messages: [msg] });
    }
  }

  return (
    <div className="flex h-full flex-1 overflow-hidden">
      {/* Main chat area */}
      <div className="flex min-w-0 flex-1 flex-col bg-white dark:bg-surface-950">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-surface-200 px-6 py-3 dark:border-surface-700">
        {chat.type === 'channel' ? (
          chat.image
            ? <Avatar name={chat.name} image={chat.image} size="md" />
            : <Hash size={22} className="text-surface-400" />
        ) : (
          <Avatar name={chat.name} image={chat.image} size="md" />
        )}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-surface-900 dark:text-white">{chat.name}</h2>
          {chatDescription ? (
            <div className="flex items-center gap-1">
              <p className="min-w-0 truncate text-xs text-surface-500 dark:text-surface-400">
                <LinkifiedText text={chatDescription} />
              </p>
              {isManager && chat.type === 'channel' && (
                <button
                  onClick={() => setDescEditorOpen(true)}
                  className="shrink-0 rounded p-0.5 text-surface-300 transition hover:bg-surface-100 hover:text-surface-500 dark:text-surface-600 dark:hover:bg-surface-800 dark:hover:text-surface-400"
                  title="Beschreibung bearbeiten"
                >
                  <Pencil size={11} />
                </button>
              )}
            </div>
          ) : isManager && chat.type === 'channel' ? (
            <button
              onClick={() => setDescEditorOpen(true)}
              className="flex items-center gap-1 text-xs text-surface-400 transition hover:text-primary-500"
            >
              <Pencil size={11} /> Beschreibung hinzufügen
            </button>
          ) : null}
        </div>
        {chat.type === 'channel' && (
          <button
            onClick={() => setMembersOpen((o) => !o)}
            className={clsx(
              'rounded-lg p-2 transition',
              membersOpen
                ? 'bg-primary-100 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400'
                : 'text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800',
            )}
            title="Mitglieder"
          >
            <Users size={20} />
          </button>
        )}
        <button
          onClick={onToggleFileBrowser}
          className={clsx(
            'rounded-lg p-2 transition',
            fileBrowserOpen
              ? 'bg-primary-100 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400'
              : 'text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800',
          )}
          title="Dateiablage"
        >
          <FolderOpen size={20} />
        </button>
        <button
          onClick={onToggleSettings}
          className="rounded-lg p-2 text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800"
          title="Einstellungen"
        >
          <Settings size={20} />
        </button>
      </div>

      {/* Messages */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="relative flex-1 overflow-x-hidden overflow-y-auto px-4 py-4"
      >
        {/* Load-more spinner at top */}
        {loadingMore && (
          <div className="flex justify-center pb-3">
            <Loader2 size={20} className="animate-spin text-primary-400" />
          </div>
        )}
        {!loadingMore && !hasMore && messages.length > 0 && (
          <div className="pb-3 text-center text-xs text-surface-400">Anfang des Verlaufs</div>
        )}

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
        ) : settings.bubbleView ? (
          <div className="flex flex-col gap-4">
            {groups.map((group, gi) =>
              group.isSystem ? (
                <SystemMessage key={gi} msg={group.messages[0]} />
              ) : (
                <MessageGroup
                  key={gi}
                  group={group}
                  canDeleteAll={isManager && chat.type === 'channel'}
                  showImagesInline={settings.showImagesInline}
                  messageMap={messageMap}
                  onDelete={handleDelete}
                  onLike={handleLike}
                  onForward={setForwardMsg}
                  onImageClick={setLightboxUrl}
                  onPdfClick={(fid, vurl, name) => setPdfView({ fileId: fid, viewUrl: vurl, name })}
                />
              ),
            )}
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-surface-100 dark:divide-surface-800">
            {messages.map((msg) => {
              if (SYSTEM_KINDS.has(msg.kind ?? '')) {
                return <SystemMessage key={msg.id} msg={msg} />;
              }
              return (
                <PlainTextMessage
                  key={msg.id}
                  msg={msg}
                  isOwn={String(msg.sender?.id) === userId}
                  canDelete={String(msg.sender?.id) === userId || (isManager && chat.type === 'channel')}
                  showImagesInline={settings.showImagesInline}
                  messageMap={messageMap}
                  onDelete={handleDelete}
                  onLike={handleLike}
                  onForward={setForwardMsg}
                  onImageClick={setLightboxUrl}
                  onPdfClick={(fid, vurl, name) => setPdfView({ fileId: fid, viewUrl: vurl, name })}
                />
              );
            })}
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
      </div>{/* end main chat area */}

    {/* Channel member panel */}
    {membersOpen && chat.type === 'channel' && (
      <ChannelMembersPanel
        chat={chat}
        isManager={isManager}
        onClose={() => setMembersOpen(false)}
      />
    )}

    {/* Image lightbox */}
    {lightboxUrl && (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm"
        onClick={() => setLightboxUrl(null)}
      >
        <button
          className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
          onClick={() => setLightboxUrl(null)}
        >
          <X size={22} />
        </button>
        <img
          src={lightboxUrl}
          className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    )}

    {/* Channel description editor */}
    {descEditorOpen && chat.type === 'channel' && (
      <ChannelDescriptionEditor
        chat={{ ...chat, description: chatDescription }}
        onClose={() => setDescEditorOpen(false)}
        onSaved={(newDesc) => setChatDescription(newDesc)}
      />
    )}

    {/* Forward dialog */}
    {forwardMsg && (
      <ForwardDialog
        message={forwardMsg}
        onClose={() => setForwardMsg(null)}
      />
    )}

    {/* PDF viewer */}
    {pdfView && (
      <div
        className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/85 backdrop-blur-sm"
        onClick={() => setPdfView(null)}
      >
        <div
          className="relative flex h-[90vh] w-[90vw] max-w-4xl flex-col rounded-xl bg-surface-900 shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex shrink-0 items-center gap-3 border-b border-surface-700 px-4 py-2">
            <span className="flex-1 truncate text-sm font-medium text-white">{pdfView.name}</span>
            <a
              href={api.fileDownloadUrl(pdfView.fileId, pdfView.name)}
              download={pdfView.name}
              className="rounded-md p-1.5 text-surface-300 hover:bg-surface-700"
              title="Herunterladen"
            >
              <ExternalLink size={16} />
            </a>
            <button
              onClick={() => setPdfView(null)}
              className="rounded-md p-1.5 text-surface-300 hover:bg-surface-700"
            >
              <X size={16} />
            </button>
          </div>
          <iframe
            src={pdfView.viewUrl}
            className="flex-1 rounded-b-xl"
            title={pdfView.name}
          />
        </div>
      </div>
    )}
  </div>
  );
}

// ── Bubble view ────────────────────────────────────────────────────────────────

function MessageGroup({
  group,
  canDeleteAll,
  showImagesInline,
  messageMap,
  onDelete,
  onLike,
  onForward,
  onImageClick,
  onPdfClick,
}: {
  group: { sender: Message['sender']; isOwn: boolean; messages: Message[] };
  canDeleteAll: boolean;
  showImagesInline: boolean;
  messageMap: Map<number, Message>;
  onDelete: (messageId: string) => void;
  onLike: (messageId: string, liked: boolean) => void;
  onForward: (msg: Message) => void;
  onImageClick: (url: string) => void;
  onPdfClick: (fileId: string, viewUrl: string, name: string) => void;
}) {
  const { sender, isOwn, messages } = group;
  const senderName = sender ? `${sender.first_name} ${sender.last_name}` : 'Unbekannt';

  return (
    <div className={clsx('flex gap-2', isOwn ? 'flex-row-reverse' : 'flex-row')}>
      {!isOwn && (
        <div className="shrink-0 pt-0.5">
          <Avatar name={senderName} image={sender?.image} size="sm" />
        </div>
      )}

      <div className={clsx('flex min-w-0 max-w-[75%] flex-col gap-0.5', isOwn ? 'items-end' : 'items-start')}>
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
          const replyTo = msg.reply_to ? messageMap.get(msg.reply_to.message_id) : undefined;

          return (
            <div key={msg.id} className={clsx('group/msg relative flex flex-col gap-0.5', isOwn ? 'items-end' : 'items-start')}>
              {/* Action buttons — above the bubble to avoid horizontal scrollbar */}
              <div className={clsx(
                'absolute bottom-full mb-1 z-10 hidden group-hover/msg:flex items-center gap-0.5 rounded-lg bg-white/90 p-0.5 shadow-sm ring-1 ring-surface-200 backdrop-blur dark:bg-surface-800/90 dark:ring-surface-700',
                isOwn ? 'right-0' : 'left-0',
              )}>
                <button
                  onClick={() => onLike(String(msg.id), Boolean(msg.liked))}
                  title={msg.liked ? 'Like entfernen' : 'Gefällt mir'}
                  className={clsx(
                    'flex items-center justify-center rounded-md p-1 transition',
                    msg.liked
                      ? 'text-amber-500 dark:text-amber-400'
                      : 'text-surface-400 hover:bg-surface-200 hover:text-amber-500 dark:hover:bg-surface-700 dark:hover:text-amber-400',
                  )}
                >
                  <ThumbsUp size={13} />
                </button>
                <button
                  onClick={() => { if (msg.text) navigator.clipboard.writeText(msg.text).catch(() => {}); }}
                  title="Kopieren"
                  className="flex items-center justify-center rounded-md p-1 text-surface-400 hover:bg-surface-200 hover:text-surface-700 dark:hover:bg-surface-700 dark:hover:text-surface-200 transition"
                >
                  <Copy size={13} />
                </button>
                <button
                  onClick={() => onForward(msg)}
                  title="Weiterleiten"
                  className="flex items-center justify-center rounded-md p-1 text-surface-400 hover:bg-surface-200 hover:text-surface-700 dark:hover:bg-surface-700 dark:hover:text-surface-200 transition"
                >
                  <Forward size={13} />
                </button>
                {canDelete && (
                  <button
                    onClick={() => onDelete(String(msg.id))}
                    title="Löschen"
                    className="flex items-center justify-center rounded-md p-1 text-surface-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400 transition"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>

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
                {replyTo && <ReplyQuote msg={replyTo} isOwn={isOwn} />}
                {msg.is_forwarded && (
                  <div className={clsx('mb-1 flex items-center gap-1 text-[11px] italic', isOwn ? 'text-primary-200' : 'text-surface-400')}>
                    <Forward size={10} /> Weitergeleitet
                  </div>
                )}
                <MarkdownContent content={content} isOwn={isOwn} />
                <FileList files={msg.files} isOwn={isOwn} showImagesInline={showImagesInline} onImageClick={onImageClick} onPdfClick={onPdfClick} />
              </div>

              {(isLast || (msg.likes ?? 0) > 0) && (
                <div className={clsx('flex items-center gap-1.5 px-1', isOwn ? 'flex-row-reverse' : 'flex-row')}>
                  {isLast && <span className="text-xs text-surface-400">{time}</span>}
                  {(msg.likes ?? 0) > 0 && (
                    <LikeBadge
                      count={msg.likes ?? 0}
                      liked={Boolean(msg.liked)}
                      onToggle={() => onLike(String(msg.id), Boolean(msg.liked))}
                      messageId={String(msg.id)}
                    />
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

// ── Plain text view ────────────────────────────────────────────────────────────

function PlainTextMessage({
  msg,
  isOwn,
  canDelete,
  showImagesInline,
  messageMap,
  onDelete,
  onLike,
  onForward,
  onImageClick,
  onPdfClick,
}: {
  msg: Message;
  isOwn: boolean;
  canDelete: boolean;
  showImagesInline: boolean;
  messageMap: Map<number, Message>;
  onDelete: (messageId: string) => void;
  onLike: (messageId: string, liked: boolean) => void;
  onForward: (msg: Message) => void;
  onImageClick: (url: string) => void;
  onPdfClick: (fileId: string, viewUrl: string, name: string) => void;
}) {
  const senderName = msg.sender ? `${msg.sender.first_name} ${msg.sender.last_name}` : 'Unbekannt';
  const time = msg.time
    ? new Date(msg.time * 1000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    : '';
  const content = msg.text || (msg.encrypted ? '🔒 Verschlüsselte Nachricht' : '');
  const replyTo = msg.reply_to ? messageMap.get(msg.reply_to.message_id) : undefined;

  return (
    <div className="group/msg flex gap-3 px-2 py-2 hover:bg-surface-50 dark:hover:bg-surface-900/50">
      <Avatar name={senderName} image={msg.sender?.image} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className={clsx('text-sm font-semibold', isOwn ? 'text-primary-700 dark:text-primary-400' : 'text-surface-900 dark:text-surface-100')}>
            {senderName}
          </span>
          <span className="text-xs text-surface-400">{time}</span>
          {(msg.likes ?? 0) > 0 && (
            <LikeBadge
              count={msg.likes ?? 0}
              liked={Boolean(msg.liked)}
              onToggle={() => onLike(String(msg.id), Boolean(msg.liked))}
              messageId={String(msg.id)}
            />
          )}
        </div>
        {replyTo && <ReplyQuote msg={replyTo} isOwn={false} />}
        {msg.is_forwarded && (
          <div className="mb-1 flex items-center gap-1 text-[11px] italic text-surface-400">
            <Forward size={10} /> Weitergeleitet
          </div>
        )}
        <div className="text-sm text-surface-800 dark:text-surface-200">
          <MarkdownContent content={content} isOwn={false} />
        </div>
        <FileList files={msg.files} isOwn={false} showImagesInline={showImagesInline} onImageClick={onImageClick} onPdfClick={onPdfClick} />
      </div>
      <div className="hidden shrink-0 group-hover/msg:grid grid-cols-2 gap-0.5">
        <button
          onClick={() => onLike(String(msg.id), Boolean(msg.liked))}
          title={msg.liked ? 'Like entfernen' : 'Gefällt mir'}
          className={clsx(
            'flex items-center justify-center rounded-md p-1 transition',
            msg.liked ? 'text-amber-500' : 'text-surface-400 hover:bg-surface-200 hover:text-amber-500 dark:hover:bg-surface-700',
          )}
        >
          <ThumbsUp size={13} />
        </button>
        <button
          onClick={() => { if (msg.text) navigator.clipboard.writeText(msg.text).catch(() => {}); }}
          title="Kopieren"
          className="flex items-center justify-center rounded-md p-1 text-surface-400 hover:bg-surface-200 hover:text-surface-600 dark:hover:bg-surface-700 transition"
        >
          <Copy size={13} />
        </button>
        <button
          onClick={() => onForward(msg)}
          title="Weiterleiten"
          className="flex items-center justify-center rounded-md p-1 text-surface-400 hover:bg-surface-200 hover:text-surface-600 dark:hover:bg-surface-700 transition"
        >
          <Forward size={13} />
        </button>
        {canDelete && (
          <button
            onClick={() => onDelete(String(msg.id))}
            title="Löschen"
            className="flex items-center justify-center rounded-md p-1 text-surface-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400 transition"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

// ── System message ─────────────────────────────────────────────────────────────

function SystemMessage({ msg }: { msg: Message }) {
  const senderName = msg.sender ? `${msg.sender.first_name} ${msg.sender.last_name}`.trim() : 'Jemand';
  const time = msg.time
    ? new Date(msg.time * 1000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    : '';
  const date = msg.time
    ? new Date(msg.time * 1000).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' })
    : '';

  let text = '';
  switch (msg.kind) {
    case 'joined':
      text = `${senderName} ist dem Channel beigetreten.`;
      break;
    case 'left':
      text = `${senderName} hat den Channel verlassen.`;
      break;
    case 'removed':
      text = `${senderName} wurde aus dem Channel entfernt.`;
      break;
    case 'call_start':
      text = `${senderName} hat einen Anruf gestartet.`;
      break;
    case 'call_end':
      text = 'Der Anruf wurde beendet.';
      break;
    default:
      text = msg.text || `Systemnachricht (${msg.kind})`;
  }

  return (
    <div className="flex justify-center py-1">
      <div className="rounded-full bg-surface-100 px-4 py-1.5 text-xs text-surface-500 dark:bg-surface-800 dark:text-surface-400">
        <span className="font-medium">{text}</span>
        {time && <span className="ml-2 text-surface-400">{date}, {time}</span>}
      </div>
    </div>
  );
}

// ── Reply quote ────────────────────────────────────────────────────────────────

function ReplyQuote({ msg, isOwn }: { msg: Message; isOwn: boolean }) {
  const senderName = msg.sender ? `${msg.sender.first_name} ${msg.sender.last_name}`.trim() : 'Unbekannt';
  const preview = (msg.text || '').slice(0, 120) + ((msg.text || '').length > 120 ? '...' : '');

  return (
    <div className={clsx(
      'mb-1.5 rounded-lg border-l-3 px-2.5 py-1.5 text-xs',
      isOwn
        ? 'border-primary-300 bg-primary-700/50 text-primary-100'
        : 'border-surface-400 bg-surface-200/60 text-surface-600 dark:bg-surface-700/60 dark:text-surface-400',
    )}>
      <div className="font-semibold">{senderName}</div>
      <div className="line-clamp-2 opacity-80">{preview || 'Nachricht'}</div>
    </div>
  );
}

// ── Shared sub-components ──────────────────────────────────────────────────────

function FileList({
  files,
  isOwn,
  showImagesInline,
  onImageClick,
  onPdfClick,
}: {
  files?: Message['files'];
  isOwn: boolean;
  showImagesInline: boolean;
  onImageClick?: (url: string) => void;
  onPdfClick?: (fileId: string, viewUrl: string, name: string) => void;
}) {
  if (!files || files.length === 0) return null;

  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      {files.map((f) => {
        const isImage = f.mime?.startsWith('image/');
        const isPdf = f.mime === 'application/pdf' || f.ext?.toLowerCase() === 'pdf';
        const downloadUrl = api.fileDownloadUrl(f.id, f.name);
        const viewUrl = api.fileViewUrl(f.id, f.name);

        return (
          <div key={f.id}>
            {isImage && showImagesInline && (
              <button
                className="mb-1 block cursor-zoom-in"
                onClick={() => onImageClick?.(downloadUrl)}
                title="Vergrößern"
              >
                <img
                  src={downloadUrl}
                  alt={f.name}
                  className="max-h-60 max-w-xs rounded-lg object-contain transition hover:opacity-90"
                  loading="lazy"
                />
              </button>
            )}
            <div className="flex items-center gap-1.5">
              <a
                href={downloadUrl}
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
              {isPdf && onPdfClick && (
                <button
                  onClick={() => onPdfClick(f.id, viewUrl, f.name)}
                  title="PDF-Vorschau"
                  className={clsx(
                    'inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium transition',
                    isOwn
                      ? 'bg-primary-700 text-primary-100 hover:bg-primary-800'
                      : 'bg-surface-200 text-surface-600 hover:bg-surface-300 dark:bg-surface-700 dark:text-surface-300 dark:hover:bg-surface-600',
                  )}
                >
                  <FileText size={12} /> Vorschau
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Utilities ──────────────────────────────────────────────────────────────────

/** Renders plain text with clickable https?:// URLs */
function LinkifiedText({ text }: { text: string }) {
  const URL_RE = /https?:\/\/[^\s]+/g;
  const parts: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_RE.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const url = match[0];
    parts.push(
      <a
        key={match.index}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-0.5 text-primary-600 underline hover:text-primary-800 dark:text-primary-400 dark:hover:text-primary-200"
      >
        <ExternalLink size={11} className="shrink-0" />
        {url}
      </a>,
    );
    last = match.index + url.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

/** Extract all http(s) URLs from a text string */
function extractUrls(text: string): string[] {
  const re = /https?:\/\/[^\s)>\]]+/g;
  const matches: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    // Strip trailing punctuation that's likely not part of the URL
    let url = m[0];
    while (/[.,;:!?)>\]'"]$/.test(url)) url = url.slice(0, -1);
    if (!matches.includes(url)) matches.push(url);
  }
  return matches;
}

/** Convert plain URLs in text to markdown links so ReactMarkdown renders them */
function autoLinkify(text: string): string {
  // Don't touch URLs that are already inside markdown link syntax [text](url) or <url>
  return text.replace(
    /(?<!\]\()(?<!\()(?<!<)(https?:\/\/[^\s)>\]]+)/g,
    (url) => `[${url}](${url})`
  );
}

function MarkdownContent({ content, isOwn }: { content: string; isOwn: boolean }) {
  // Extract URLs for preview cards
  const urls = extractUrls(content);
  // Auto-linkify plain URLs in the content
  const linkedContent = autoLinkify(content);

  return (
    <>
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
              className={clsx(
                'inline-flex items-center gap-0.5 underline',
                isOwn ? 'text-primary-200 hover:text-white' : 'text-primary-600 hover:text-primary-800 dark:text-primary-400 dark:hover:text-primary-200',
              )}>
              <ExternalLink size={11} className="shrink-0" />
              {children}
            </a>
          ),
          hr: () => <hr className={clsx('my-1 border-t', isOwn ? 'border-primary-400' : 'border-surface-300 dark:border-surface-600')} />,
        }}
      >
        {linkedContent}
      </ReactMarkdown>
      {/* Link preview cards */}
      {urls.map((url) => (
        <LinkPreviewCard key={url} url={url} isOwn={isOwn} />
      ))}
    </>
  );
}

// ── Like badge with tooltip ────────────────────────────────────────────────────

function LikeBadge({ count, liked, onToggle, messageId }: { count: number; liked: boolean; onToggle: () => void; messageId: string }) {
  const [showPopup, setShowPopup] = useState(false);
  const [likers, setLikers] = useState<Array<{ name: string; image?: string }> | null>(null);
  const [loadingLikers, setLoadingLikers] = useState(false);
  const [likeError, setLikeError] = useState('');
  const popupRef = useRef<HTMLDivElement>(null);

  const loadLikers = async () => {
    if (showPopup) { setShowPopup(false); return; }
    setShowPopup(true);
    if (likers !== null) return;
    setLoadingLikers(true);
    setLikeError('');
    try {
      const data = await api.listLikes(messageId);
      if (!data || !Array.isArray(data)) {
        setLikers([]);
        setLikeError('Unerwartetes Format');
        return;
      }
      setLikers(data.map((l) => ({ name: `${l.user.first_name} ${l.user.last_name}`.trim(), image: l.user.image })));
    } catch (err) {
      console.error('Failed to load likers:', err);
      setLikeError(err instanceof Error ? err.message : 'Fehler beim Laden');
      setLikers([]);
    } finally {
      setLoadingLikers(false);
    }
  };

  // Close on outside click
  useEffect(() => {
    if (!showPopup) return;
    const handler = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) setShowPopup(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showPopup]);

  return (
    <span className="relative inline-flex" ref={popupRef}>
      <button
        onClick={loadLikers}
        className={clsx(
          'flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-medium transition cursor-pointer',
          liked
            ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400'
            : 'bg-surface-100 text-surface-500 hover:bg-amber-50 hover:text-amber-500 dark:bg-surface-800 dark:text-surface-400',
        )}
      >
        <ThumbsUp size={13} className={liked ? 'text-amber-500' : ''} />
        {count}
      </button>
      {showPopup && (
        <div className="absolute bottom-full left-1/2 z-20 mb-1.5 -translate-x-1/2 w-48 rounded-xl bg-white px-1 py-1.5 shadow-xl ring-1 ring-surface-200 dark:bg-surface-800 dark:ring-surface-700">
          <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-surface-400">
            Gefällt {count} {count === 1 ? 'Person' : 'Personen'}
          </div>
          {loadingLikers ? (
            <div className="flex justify-center py-2"><Loader2 size={14} className="animate-spin text-primary-400" /></div>
          ) : likers && likers.length > 0 ? (
            <div className="max-h-32 overflow-y-auto">
              {likers.map((l, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg px-2 py-1">
                  <Avatar name={l.name} image={l.image} size="xs" />
                  <span className="truncate text-xs text-surface-700 dark:text-surface-300">{l.name}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-2 py-1 text-xs text-surface-400">{likeError || 'Keine Daten'}</div>
          )}
          <div className="mt-1 border-t border-surface-100 px-1 pt-1 dark:border-surface-700">
            <button
              onClick={(e) => { e.stopPropagation(); onToggle(); setShowPopup(false); setLikers(null); }}
              className="flex w-full items-center justify-center gap-1 rounded-lg py-1 text-xs font-medium text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-900/20"
            >
              <ThumbsUp size={12} />
              {liked ? 'Like entfernen' : 'Gefällt mir'}
            </button>
          </div>
        </div>
      )}
    </span>
  );
}

// ── Forward dialog ─────────────────────────────────────────────────────────────

function ForwardDialog({ message, onClose }: { message: Message; onClose: () => void }) {
  const [targets, setTargets] = useState<Array<{ id: string; name: string; type: 'channel' | 'conversation'; image?: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [forwarding, setForwarding] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [companies, convos] = await Promise.all([
          api.getCompanies() as Promise<Array<Record<string, unknown>>>,
          api.getConversations() as Promise<Array<Record<string, unknown>>>,
        ]);
        const all: typeof targets = [];
        // Load channels
        if (companies.length > 0) {
          const chans = await api.getChannels(String(companies[0].id)) as Array<Record<string, unknown>>;
          for (const ch of chans) {
            all.push({ id: String(ch.id), name: String(ch.name ?? ''), type: 'channel', image: ch.image ? String(ch.image) : undefined });
          }
        }
        // Conversations
        for (const c of convos) {
          const members = c.members as Array<Record<string, unknown>> | undefined;
          const name = members?.map((m) => `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim()).join(', ') || `Konversation ${c.id}`;
          all.push({ id: String(c.id), name, type: 'conversation', image: undefined });
        }
        setTargets(all);
      } catch (err) {
        console.error('Failed to load forward targets:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = targets.filter((t) => {
    if (!filter) return true;
    return t.name.toLowerCase().includes(filter.toLowerCase());
  });

  const handleForward = async (target: typeof targets[0]) => {
    setForwarding(target.id);
    try {
      const text = message.text || '';
      await api.sendMessage(target.id, target.type, text, { is_forwarded: true });
      onClose();
    } catch (err) {
      alert(`Weiterleiten fehlgeschlagen: ${err instanceof Error ? err.message : err}`);
    } finally {
      setForwarding(null);
    }
  };

  const preview = (message.text || '').slice(0, 100) + ((message.text || '').length > 100 ? '...' : '');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="relative flex w-full max-w-sm flex-col rounded-2xl bg-white shadow-2xl dark:bg-surface-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-surface-200 px-5 py-4 dark:border-surface-700">
          <Forward size={18} className="shrink-0 text-primary-500" />
          <h2 className="flex-1 text-sm font-semibold text-surface-900 dark:text-white">Nachricht weiterleiten</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800">
            <X size={16} />
          </button>
        </div>

        {/* Message preview */}
        {preview && (
          <div className="border-b border-surface-200 px-5 py-3 dark:border-surface-700">
            <div className="rounded-lg bg-surface-50 px-3 py-2 text-xs text-surface-600 dark:bg-surface-800 dark:text-surface-400">
              {preview}
            </div>
          </div>
        )}

        {/* Search */}
        <div className="px-5 pt-3">
          <div className="flex items-center gap-2 rounded-lg bg-surface-100 px-3 py-2 dark:bg-surface-800">
            <Search size={14} className="shrink-0 text-surface-400" />
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Channel oder Konversation suchen..."
              autoFocus
              className="w-full bg-transparent text-sm text-surface-900 outline-none placeholder:text-surface-400 dark:text-white"
            />
          </div>
        </div>

        {/* Target list */}
        <div className="max-h-64 overflow-y-auto px-3 py-2">
          {loading ? (
            <div className="flex justify-center py-6"><Loader2 size={20} className="animate-spin text-primary-400" /></div>
          ) : filtered.length === 0 ? (
            <p className="py-4 text-center text-xs text-surface-400">Keine Ziele gefunden</p>
          ) : (
            filtered.map((t) => (
              <button
                key={`${t.type}-${t.id}`}
                onClick={() => handleForward(t)}
                disabled={forwarding === t.id}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 hover:bg-surface-100 disabled:opacity-50 dark:hover:bg-surface-800"
              >
                {t.type === 'channel' ? (
                  t.image ? <Avatar name={t.name} image={t.image} size="xs" /> : <Hash size={14} className="shrink-0 text-surface-400" />
                ) : (
                  <Avatar name={t.name} size="xs" />
                )}
                <span className="min-w-0 flex-1 truncate text-left text-sm text-surface-800 dark:text-surface-200">{t.name}</span>
                <span className="shrink-0 text-[10px] uppercase text-surface-400">{t.type === 'channel' ? 'Channel' : 'Chat'}</span>
                {forwarding === t.id && <Loader2 size={14} className="shrink-0 animate-spin text-primary-400" />}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
