import { useState, useEffect, useCallback, useRef } from 'react';
import { X, Bookmark, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import * as api from '../api';
import Avatar from './Avatar';
import type { ChatTarget, Message } from '../types';

interface FlaggedMessagesPanelProps {
  chat: ChatTarget | null;
  onClose: () => void;
  onMessageClick?: (messageId: string, chat: ChatTarget, messageTime?: number) => void;
}

const PAGE_SIZE = 30;

const formatTime = (ts?: number) => {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
};

export default function FlaggedMessagesPanel({ chat, onClose, onMessageClick }: FlaggedMessagesPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [confirmUnflag, setConfirmUnflag] = useState<string | null>(null);
  const offsetRef = useRef(0);
  const chatIdRef = useRef<string | null>(null);

  const loadMessages = useCallback(async (reset = false) => {
    if (!chat) return;
    if (reset) {
      offsetRef.current = 0;
      setMessages([]);
    }
    setLoading(true);
    try {
      const offset = reset ? 0 : offsetRef.current;
      const raw = await api.getFlaggedMessages(chat.type, chat.id, PAGE_SIZE, offset);
      const msgs = raw as unknown as Message[];
      if (reset) {
        setMessages(msgs);
      } else {
        setMessages((prev) => {
          const ids = new Set(prev.map((m) => String(m.id)));
          const unique = msgs.filter((m) => !ids.has(String(m.id)));
          return [...prev, ...unique];
        });
      }
      offsetRef.current = (reset ? 0 : offsetRef.current) + msgs.length;
      setHasMore(msgs.length >= PAGE_SIZE);
    } catch (err) {
      console.error('Failed to load flagged messages:', err);
    } finally {
      setLoading(false);
    }
  }, [chat]);

  // Reload when chat changes
  useEffect(() => {
    if (chat && chat.id !== chatIdRef.current) {
      chatIdRef.current = chat.id;
      loadMessages(true);
    }
  }, [chat, loadMessages]);

  // Initial load
  useEffect(() => {
    if (chat) loadMessages(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleUnflag = useCallback(async (messageId: string) => {
    setConfirmUnflag(null);
    setMessages((prev) => prev.filter((m) => String(m.id) !== messageId));
    try {
      await api.unflagMessage(messageId);
    } catch {
      // Reload to restore state
      loadMessages(true);
    }
  }, [loadMessages]);

  const chatName = chat?.name ?? '';

  // Panel width from localStorage (same pattern as FileBrowserPanel)
  const [width, setWidth] = useState(() => {
    const saved = localStorage.getItem('schulchat_flagged_width');
    return saved ? Math.max(280, Math.min(600, Number(saved))) : 384;
  });
  const draggingRef = useRef(false);

  const onMouseDown = useCallback(() => {
    draggingRef.current = true;
    const onMove = (e: MouseEvent) => {
      if (!draggingRef.current) return;
      const newW = window.innerWidth - e.clientX;
      setWidth(Math.max(280, Math.min(600, newW)));
    };
    const onUp = () => {
      draggingRef.current = false;
      localStorage.setItem('schulchat_flagged_width', String(width));
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [width]);

  if (!chat) {
    return (
      <div style={{ width }} className="relative flex shrink-0 flex-col border-l border-surface-200 bg-white dark:border-surface-700 dark:bg-surface-900">
        <div className="flex items-center justify-between border-b border-surface-200 px-4 py-3 dark:border-surface-700">
          <h2 className="text-sm font-semibold">Markierte Nachrichten</h2>
          <button onClick={onClose} className="rounded-lg p-1 hover:bg-surface-200 dark:hover:bg-surface-800"><X size={18} /></button>
        </div>
        <div className="flex flex-1 items-center justify-center text-sm text-surface-500">
          Kein Chat ausgewählt
        </div>
      </div>
    );
  }

  return (
    <div style={{ width }} className="relative flex shrink-0 flex-col border-l border-surface-200 bg-white dark:border-surface-700 dark:bg-surface-900">
      {/* Resize handle */}
      <div
        onMouseDown={onMouseDown}
        className="absolute inset-y-0 left-0 z-20 w-1 cursor-col-resize hover:bg-primary-400/50"
      />

      {/* Header */}
      <div className="flex items-center justify-between border-b border-surface-200 px-4 py-3 dark:border-surface-700">
        <div className="flex items-center gap-2 overflow-hidden">
          <Bookmark size={16} className="shrink-0 text-amber-500" fill="currentColor" />
          <h2 className="truncate text-sm font-semibold">
            Markiert in {chatName}
          </h2>
        </div>
        <button onClick={onClose} className="shrink-0 rounded-lg p-1 hover:bg-surface-200 dark:hover:bg-surface-800">
          <X size={18} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading && messages.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 size={24} className="animate-spin text-surface-400" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-12 text-surface-500">
            <Bookmark size={32} className="text-surface-300 dark:text-surface-600" />
            <p className="text-sm">Keine markierten Nachrichten</p>
          </div>
        ) : (
          <>
            {messages.map((msg) => (
              <div
                key={String(msg.id)}
                className="group/entry border-b border-surface-100 px-4 py-3 hover:bg-surface-50 dark:border-surface-800 dark:hover:bg-surface-800/50"
              >
                <div className="flex items-start gap-2.5">
                  <Avatar
                    name={msg.sender ? `${msg.sender.first_name} ${msg.sender.last_name}` : '?'}
                    image={msg.sender?.image}
                    size="sm"
                  />
                  <button
                    onClick={() => { console.log('[flagged] click — msgId=', msg.id, 'msgTime=', msg.time, 'chat=', chat.id, chat.type); onMessageClick?.(String(msg.id), chat, msg.time); }}
                    className="min-w-0 flex-1 text-left"
                    title="Zur Nachricht springen"
                  >
                    <div className="flex items-center gap-2">
                      <span className="truncate text-xs font-medium text-surface-900 dark:text-surface-100">
                        {msg.sender ? `${msg.sender.first_name} ${msg.sender.last_name}` : 'Unbekannt'}
                      </span>
                      <span className="shrink-0 text-[10px] text-surface-500">
                        {formatTime(msg.time)}
                      </span>
                    </div>
                    <p className="mt-0.5 line-clamp-3 text-xs text-surface-700 dark:text-surface-300">
                      {msg.text || (msg.files?.length ? `${msg.files.length} Datei(en)` : '')}
                    </p>
                  </button>
                  <button
                    onClick={() => setConfirmUnflag(String(msg.id))}
                    title="Markierung entfernen"
                    className={clsx(
                      'shrink-0 rounded-md p-1 opacity-0 transition group-hover/entry:opacity-100',
                      'text-amber-500 hover:bg-amber-50 hover:text-amber-600 dark:hover:bg-amber-900/20',
                    )}
                  >
                    <Bookmark size={14} fill="currentColor" />
                  </button>
                </div>
              </div>
            ))}
            {hasMore && (
              <button
                onClick={() => loadMessages(false)}
                disabled={loading}
                className="flex w-full items-center justify-center gap-2 py-3 text-xs text-primary-600 hover:text-primary-700 disabled:opacity-50 dark:text-primary-400"
              >
                {loading ? <Loader2 size={14} className="animate-spin" /> : null}
                Mehr laden
              </button>
            )}
          </>
        )}
      </div>

      {/* Confirmation dialog for unflagging */}
      {confirmUnflag && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/30 backdrop-blur-[2px]">
          <div className="mx-4 w-full max-w-xs rounded-xl bg-white p-5 shadow-xl dark:bg-surface-800">
            <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-surface-900 dark:text-surface-100">
              <Bookmark size={16} className="text-amber-500" fill="currentColor" />
              Markierung entfernen?
            </div>
            <p className="mb-4 text-xs text-surface-600 dark:text-surface-400">
              Soll die Markierung dieser Nachricht wirklich entfernt werden?
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmUnflag(null)}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-surface-600 hover:bg-surface-100 dark:text-surface-400 dark:hover:bg-surface-700"
              >
                Abbrechen
              </button>
              <button
                onClick={() => handleUnflag(confirmUnflag)}
                className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600 dark:bg-amber-600 dark:hover:bg-amber-700"
              >
                Entfernen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
