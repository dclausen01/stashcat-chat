import React, { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { Hash, Users, FolderOpen, ArrowDown, Loader2, Trash2, Copy, Home, ThumbsUp, X, ExternalLink, FileText, Pencil, Forward, Search, Reply, Check, CheckCheck, Video, CalendarDays, ArrowLeft, GraduationCap, Bookmark } from 'lucide-react';
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
import ChannelDropdownMenu from './ChannelDropdownMenu';
import LinkPreviewCard from './LinkPreviewCard';
import ChannelDescriptionEditor from './ChannelDescriptionEditor';
import CreatePollModal from './CreatePollModal';
import CreateEventModal from './CreateEventModal';
import type { ChatTarget, Message } from '../types';

interface ChatViewProps {
  chat: ChatTarget;
  onGoHome: () => void;
  onToggleFileBrowser: () => void;
  fileBrowserOpen: boolean;
  onOpenPolls?: () => void;
  onOpenPoll?: (pollId: string) => void;
  onOpenCalendar?: () => void;
  onMarkRead?: (chatId: string, chatType: 'channel' | 'conversation') => void;
  onToggleFlagged?: () => void;
  flaggedOpen?: boolean;
  jumpToMessageId?: string | null;
  onJumpComplete?: () => void;
}

interface TypingUser {
  userId: number;
  name?: string;
  at: number;
}

const PAGE_SIZE = 50;
const SYSTEM_KINDS = new Set(['joined', 'left', 'removed', 'call_start', 'call_end']);

/** Poll invite system message kinds (stashcat may use any of these) */
const POLL_INVITE_KINDS = new Set([
  'channel_invited_to_survey', 'survey_invitation', 'poll_invite',
  'invited_to_poll', 'channel_survey_invite', 'survey_invite',
]);

function isPollInviteMessage(msg: Message): boolean {
  if (POLL_INVITE_KINDS.has(msg.kind ?? '')) return true;
  const text = msg.text ?? '';
  // Our embedded poll ID marker: [%poll:ID%]
  if (text.includes('[%poll:') && text.includes('%]')) return true;
  const lower = text.toLowerCase();
  // Also detect German poll invite text patterns
  if (lower.includes('neue umfrage') || lower.includes('umfrage eingeladen') ||
      lower.includes('teilnahme an einer umfrage') || lower.includes('survey')) return true;
  return false;
}

function isCalendarEventMessage(msg: Message): boolean {
  const text = msg.text ?? '';
  if (text.includes('[%event:') && text.includes('%]')) return true;
  return false;
}

/** Returns a day-key string (YYYY-M-D) for a Unix timestamp in seconds. */
function msgDayKey(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

/** Returns a German label for a date separator ("Heute", "Gestern", weekday, or dd.mm.yyyy). */
function formatDateLabel(ts: number): string {
  const date = new Date(ts * 1000);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const msgDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const diffDays = Math.round((today.getTime() - msgDay.getTime()) / 86400000);
  if (diffDays === 0) return 'Heute';
  if (diffDays === 1) return 'Gestern';
  if (diffDays < 7) return date.toLocaleDateString('de-DE', { weekday: 'long' });
  return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

interface ExternalServiceLink {
  type: 'moodle' | 'bbb' | 'taskcards';
  url: string;
  label: string;
}

/** Extract Moodle/BBB/TaskCards links from description and return cleaned text + link objects. */
function extractServiceLinks(description: string): { cleanDescription: string; links: ExternalServiceLink[] } {
  const links: ExternalServiceLink[] = [];
  // Match lines/segments containing the special URLs, capturing optional preceding text on the same segment
  const patterns: { regex: RegExp; type: ExternalServiceLink['type']; label: string }[] = [
    { regex: /(?:[^\n]*?\s)??(https?:\/\/moodle\.bbz[^\s)]*)/gi, type: 'moodle', label: 'Moodle' },
    { regex: /(?:[^\n]*?\s)??(https?:\/\/portal\.bbz[^\s)]*)/gi, type: 'moodle', label: 'Moodle' },
    { regex: /(?:[^\n]*?\s)??(https?:\/\/bbb\.bbz[^\s)]*)/gi, type: 'bbb', label: 'BBB' },
    { regex: /(?:[^\n]*?\s)??(https?:\/\/bbzrdeck\.taskcards[^\s)]*)/gi, type: 'taskcards', label: 'TaskCards' },
  ];

  let cleaned = description;
  for (const { regex, type, label } of patterns) {
    let match;
    while ((match = regex.exec(description)) !== null) {
      links.push({ type, url: match[1], label });
    }
    // Remove the full match (line with the URL) from description
    cleaned = cleaned.replace(new RegExp(`[^\\n]*https?:\\/\\/(${type === 'moodle' ? 'moodle\\.bbz|portal\\.bbz' : type === 'bbb' ? 'bbb\\.bbz' : 'bbzrdeck\\.taskcards'})[^\\s)]*`, 'gi'), '');
  }
  // Clean up leftover blank lines
  cleaned = cleaned.replace(/\n{2,}/g, '\n').trim();
  return { cleanDescription: cleaned, links };
}

export default function ChatView({ chat, onGoHome, onToggleFileBrowser, fileBrowserOpen, onOpenPolls, onOpenPoll, onOpenCalendar, onToggleFlagged, flaggedOpen, jumpToMessageId, onJumpComplete }: ChatViewProps) {
  const { user } = useAuth();
  const settings = useSettings();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const [isManager, setIsManager] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState<File[]>([]);
  const [membersOpen, setMembersOpen] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [pdfView, setPdfView] = useState<{ fileId: string; viewUrl: string; name: string } | null>(null);
  const [descEditorOpen, setDescEditorOpen] = useState(false);
  const [chatDescription, setChatDescription] = useState(chat.description || '');
  const [forwardMsg, setForwardMsg] = useState<Message | null>(null);
  const [meetingLoading, setMeetingLoading] = useState(false);
  const [showPollModal, setShowPollModal] = useState(false);
  const [showEventModal, setShowEventModal] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchMatchIdx, setSearchMatchIdx] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchMatchRefs = useRef<(HTMLDivElement | null)[]>([]);
  // Date-range search state
  const [dateSearchMode, setDateSearchMode] = useState(false);
  const [dateStart, setDateStart] = useState('');
  const [dateEnd, setDateEnd] = useState('');
  const [dateSearchResults, setDateSearchResults] = useState<Message[] | null>(null);
  const [dateSearchLoading, setDateSearchLoading] = useState(false);
  const [viewingDateResults, setViewingDateResults] = useState(false);
  const savedMessagesRef = useRef<{ messages: Message[]; hasMore: boolean; offset: number } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  // Store the first unread message ID when opening the chat
  const [firstUnreadMsgId, setFirstUnreadMsgId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const chatRef = useRef(chat);
  chatRef.current = chat;
  const paginationOffsetRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const hasMoreRef = useRef(true);

  const userId = user?.id ?? '';

  // Extract service links (Moodle, BBB, TaskCards) from channel description
  const { cleanDescription, links: serviceLinks } = chatDescription
    ? extractServiceLinks(chatDescription)
    : { cleanDescription: '', links: [] };

  // Search: IDs of messages matching the query (always search in currently displayed messages)
  const searchMatches: string[] = searchQuery.trim().length >= 2
    ? messages
        .filter((m) => m.text?.toLowerCase().includes(searchQuery.toLowerCase()))
        .map((m) => String(m.id))
    : [];

  // Scroll to current match when index or matches change
  useEffect(() => {
    if (searchMatches.length === 0) return;
    const idx = ((searchMatchIdx % searchMatches.length) + searchMatches.length) % searchMatches.length;
    searchMatchRefs.current[idx]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [searchMatchIdx, searchMatches.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset match index when query changes or chat switches
  useEffect(() => { setSearchMatchIdx(0); }, [searchQuery, chat.id]);
  useEffect(() => {
    setSearchOpen(false); setSearchQuery('');
    setDateSearchMode(false); setDateStart(''); setDateEnd('');
    setDateSearchResults(null); setViewingDateResults(false);
    savedMessagesRef.current = null;
  }, [chat.id]);

  // Focus search input when opened
  useEffect(() => {
    if (searchOpen) setTimeout(() => searchInputRef.current?.focus(), 50);
  }, [searchOpen]);

  // Ctrl+F / Cmd+F → toggle in-chat search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  const loadMessages = useCallback(async () => {
    setLoading(true);
    setHasMore(true);
    hasMoreRef.current = true;
    paginationOffsetRef.current = 0;
    try {
      const res = await api.getMessages(chat.id, chat.type, PAGE_SIZE, 0);
      const msgs = res as unknown as Message[];
      
      // Determine first unread message BEFORE we mark them as read
      let firstUnreadId = null;
      const firstUnreadMsg = msgs.find(m => m.unread === true && String(m.sender?.id) !== userId);
      if (firstUnreadMsg) {
        firstUnreadId = String(firstUnreadMsg.id);
      } else {
        const unreadCount = Number(chat.unread_count ?? 0);
        if (unreadCount > 0 && msgs.length > 0) {
          let foundUnread = 0;
          for (let i = msgs.length - 1; i >= 0; i--) {
            const m = msgs[i];
            if (String(m.sender?.id) !== userId) {
              foundUnread++;
              firstUnreadId = String(m.id);
              if (foundUnread === unreadCount) break;
            }
          }
        }
      }
      setFirstUnreadMsgId(firstUnreadId);

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
      const debug = (err as unknown as Record<string, unknown>)?.debug;
      if (debug) console.error('Debug info:', debug);
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

  // Date-range search: call server endpoint
  const runDateSearch = useCallback(async () => {
    if (!dateStart || !dateEnd) return;
    setDateSearchLoading(true);
    setDateSearchResults(null);
    try {
      const startTs = Math.floor(new Date(dateStart).getTime() / 1000);
      const endTs = Math.floor(new Date(dateEnd + 'T23:59:59').getTime() / 1000);
      const res = await api.searchMessages(chat.id, chat.type, startTs, endTs, searchQuery || undefined);
      setDateSearchResults(res.messages as unknown as Message[]);
    } catch (err) {
      console.error('Date search failed:', err);
      setDateSearchResults([]);
    } finally {
      setDateSearchLoading(false);
    }
  }, [chat.id, chat.type, dateStart, dateEnd, searchQuery]);

  // Jump to a date-search result: replace messages with search results
  const jumpToDateResult = useCallback((msgId: string) => {
    if (!dateSearchResults) return;
    // Save current state so we can restore later
    if (!savedMessagesRef.current) {
      savedMessagesRef.current = {
        messages: [...messages],
        hasMore,
        offset: paginationOffsetRef.current,
      };
    }
    setMessages(dateSearchResults);
    setHasMore(false);
    hasMoreRef.current = false;
    setViewingDateResults(true);
    // Scroll to the clicked message after render
    requestAnimationFrame(() => {
      const el = document.getElementById(`msg-${msgId}`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, [dateSearchResults, messages, hasMore]);

  // Restore normal message view
  const restoreMessages = useCallback(() => {
    if (savedMessagesRef.current) {
      setMessages(savedMessagesRef.current.messages);
      setHasMore(savedMessagesRef.current.hasMore);
      hasMoreRef.current = savedMessagesRef.current.hasMore;
      paginationOffsetRef.current = savedMessagesRef.current.offset;
      savedMessagesRef.current = null;
    } else {
      loadMessages();
    }
    setViewingDateResults(false);
    setDateSearchResults(null);
  }, [loadMessages]);

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

  // Jump to specific message (from flagged messages panel)
  const isJumpingRef = useRef(false);
  useEffect(() => {
    if (!jumpToMessageId || isJumpingRef.current) return;
    // Wait for initial load to complete before attempting to jump
    if (loading) return;
    
    const tryScrollToMessage = async () => {
      isJumpingRef.current = true;
      const maxAttempts = 20; // Prevent infinite loops
      let attempts = 0;
      
      while (attempts < maxAttempts) {
        // Check if message is already loaded
        const msgElement = document.getElementById(`msg-${jumpToMessageId}`);
        
        if (msgElement) {
          // Message found, scroll to it and highlight
          msgElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
          msgElement.classList.add('ring-2', 'ring-primary-400', 'rounded-xl');
          setTimeout(() => {
            msgElement.classList.remove('ring-2', 'ring-primary-400', 'rounded-xl');
          }, 3000);
          onJumpComplete?.();
          isJumpingRef.current = false;
          return;
        }
        
        // Message not found, check if we can load more
        if (!hasMoreRef.current || loadingMoreRef.current) {
          // No more messages to load
          console.warn(`Message ${jumpToMessageId} not found in chat history`);
          onJumpComplete?.();
          isJumpingRef.current = false;
          return;
        }
        
        // Load more messages and try again
        await loadOlder();
        attempts++;
        
        // Small delay to allow React to render the new messages
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      // Max attempts reached
      console.warn(`Could not find message ${jumpToMessageId} after ${maxAttempts} attempts`);
      onJumpComplete?.();
      isJumpingRef.current = false;
    };
    
    tryScrollToMessage();
  }, [jumpToMessageId, loadOlder, onJumpComplete, loading]);

  // Clear stale typing indicators after 4 s
  useEffect(() => {
    if (typingUsers.length === 0) return;
    const id = setInterval(() => {
      const cutoff = Date.now() - 4000;
      setTypingUsers((prev) => prev.filter((t) => t.at > cutoff));
    }, 1000);
    return () => clearInterval(id);
  }, [typingUsers.length]);

  // Mark messages as read after 3 seconds when visible in viewport
  const markReadTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const chatRefForMarkRead = useRef(chat);
  chatRefForMarkRead.current = chat;

  // Clear all pending mark-read timers
  useEffect(() => {
    return () => {
      markReadTimersRef.current.forEach((timer) => clearTimeout(timer));
      markReadTimersRef.current.clear();
    };
  }, []);

  // Track the latest visible message ID to avoid redundant markAsRead calls
  const lastMarkedMsgIdRef = useRef<string | null>(null);

  // IntersectionObserver for marking messages as read after 3 seconds visibility
  useEffect(() => {
    const container = containerRef.current;
    if (!container || loading) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const msgId = entry.target.getAttribute('data-msg-id');
          if (!msgId) return;

          // Skip own messages — they don't need to be marked as read
          const senderId = entry.target.getAttribute('data-sender-id');
          if (senderId && senderId === userId) return;

          const existingTimer = markReadTimersRef.current.get(msgId);

          if (entry.isIntersecting) {
            // Start 3 second timer only for the latest visible message
            if (!existingTimer) {
              const timer = setTimeout(() => {
                // Only call API if this message hasn't been marked yet
                if (lastMarkedMsgIdRef.current !== msgId) {
                  lastMarkedMsgIdRef.current = msgId;
                  // Mark the latest visible message as read (server marks all prior as read too)
                  api.markAsRead(chatRefForMarkRead.current.id, chatRefForMarkRead.current.type, msgId).catch(() => {});
                  // Notify sidebar to clear unread count via custom event
                  window.dispatchEvent(new CustomEvent('chat-mark-read', {
                    detail: { chatId: chatRefForMarkRead.current.id, chatType: chatRefForMarkRead.current.type }
                  }));
                }
                markReadTimersRef.current.delete(msgId);
              }, 3000);
              markReadTimersRef.current.set(msgId, timer);
            }
          } else {
            // Message not visible - cancel timer
            if (existingTimer) {
              clearTimeout(existingTimer);
              markReadTimersRef.current.delete(msgId);
            }
          }
        });
      },
      { threshold: 0.5, root: container }
    );

    // Observe all message elements
    const msgElements = container.querySelectorAll('[data-msg-id]');
    msgElements.forEach((el) => observer.observe(el));

    return () => {
      observer.disconnect();
    };
  }, [chat.id, chat.type, loading, messages.length, userId]);

  // Reset last marked message when switching chats
  useEffect(() => {
    lastMarkedMsgIdRef.current = null;
  }, [chat.id]);

  // Track the currently active chat ID to prevent stale refreshes from
  // triggering API calls for the wrong chat after a quick chat switch.
  const activeChatIdRef = useRef(chat.id);
  activeChatIdRef.current = chat.id;

  // Guard to prevent parallel silentRefresh calls (e.g., when visibilitychange
  // and focus fire nearly simultaneously, or staggered timers overlap).
  const refreshingRef = useRef(false);

  // Silent refresh: reload messages without showing a loading spinner or
  // resetting scroll position. Used when the tab becomes visible again,
  // after SSE reconnection, or periodically as a fallback.
  // Merges new messages into the existing list rather than replacing it,
  // preserving any older messages loaded via loadOlder().
  const silentRefresh = useCallback(async () => {
    // Skip if we're already refreshing or the chat has changed
    if (refreshingRef.current) return;
    if (chat.id !== activeChatIdRef.current) return;

    refreshingRef.current = true;
    try {
      const res = await api.getMessages(chat.id, chat.type, PAGE_SIZE, 0);
      const msgs = res as unknown as Message[];
      setMessages((prev) => {
        const prevMap = new Map(prev.map(m => [String(m.id), m]));
        let changed = false;

        for (const msg of msgs) {
          const id = String(msg.id);
          const existing = prevMap.get(id);
          if (!existing) {
            // New message
            prevMap.set(id, msg);
            changed = true;
          } else if (
            existing.text !== msg.text ||
            existing.likes !== msg.likes ||
            existing.liked !== msg.liked ||
            existing.deleted !== msg.deleted ||
            existing.flagged !== msg.flagged ||
            existing.edited !== msg.edited
          ) {
            // Existing message with changed content — update it
            prevMap.set(id, { ...existing, ...msg });
            changed = true;
          }
        }

        if (!changed) return prev; // No change — don't trigger re-render

        const merged = Array.from(prevMap.values()).sort((a, b) => (Number(a.time) || 0) - (Number(b.time) || 0));
        // Mark latest message as read — but only if it's not our own message
        const last = merged[merged.length - 1];
        if (last && String(last.sender?.id) !== userId) {
          api.markAsRead(chat.id, chat.type, String(last.id)).catch(() => {});
        }
        return merged;
      });
      // Auto-scroll to bottom if new messages arrived and user was near bottom
      if (containerRef.current) {
        const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
        if (scrollHeight - scrollTop - clientHeight < 150) {
          requestAnimationFrame(() => {
            if (messagesEndRef.current) {
              messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
            }
          });
        }
      }
    } catch {
      // Ignore — the SSE + periodic fallback will catch it
    } finally {
      refreshingRef.current = false;
    }
  }, [chat.id, chat.type, userId]);

  // Keep a ref to the latest silentRefresh so timers always call the current version
  const silentRefreshRef = useRef(silentRefresh);
  silentRefreshRef.current = silentRefresh;

  // Reload messages when tab becomes visible after being hidden.
  // While minimized, SSE events may be silently dropped by the browser
  // even if the connection appears "open" (heartbeats still arrive).
  // Uses staggered checks to catch messages arriving at different speeds
  // after SSE reconnection.
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];

    const scheduleRefresh = (delay: number) => {
      timers.push(setTimeout(() => {
        if (!document.hidden) {
          silentRefreshRef.current();
        }
      }, delay));
    };

    const onVisible = () => {
      if (!document.hidden) {
        // Staggered checks: SSE may take varying time to reconnect
        scheduleRefresh(500);   // Quick check — SSE may already be connected
        scheduleRefresh(2500);  // Medium — SSE reconnecting
        scheduleRefresh(6000);  // Final check — slow reconnects
      }
    };

    const onFocus = () => {
      // window.focus fires in some cases where visibilitychange doesn't
      // (e.g., window minimized then restored on some desktop environments)
      scheduleRefresh(300);
    };

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
      timers.forEach(clearTimeout);
    };
  }, []); // Empty deps — uses ref to always call latest silentRefresh

  // Periodic polling fallback: every 30 seconds, silently check for new
  // messages when the tab is visible. This catches messages that were
  // silently dropped by SSE (browser may drop events while keeping the
  // connection technically "open" with heartbeats still arriving).
  useEffect(() => {
    const POLL_INTERVAL = 30_000;
    // Add random jitter (0–10 s) to prevent thundering-herd when many tabs are open
    const jitter = Math.random() * 10_000;
    const intervalId = setInterval(() => {
      if (!document.hidden) {
        silentRefreshRef.current();
      }
    }, POLL_INTERVAL + jitter);
    return () => clearInterval(intervalId);
  }, []); // Empty deps — uses ref

  // Stable handler refs for useRealtimeEvents — prevents handler replacement on every render
  const handleMessageSync = useCallback((data: unknown) => {
    const payload = data as Record<string, unknown>;
    const currentChat = chatRef.current;
    const belongsHere =
      (currentChat.type === 'channel' && String(payload.channel_id) === currentChat.id) ||
      (currentChat.type === 'conversation' && String(payload.conversation_id) === currentChat.id);
    if (!belongsHere) return;

    const newMsg = payload as unknown as Message;
    setMessages((prev) => {
      const existingById = prev.findIndex((m) => String(m.id) === String(newMsg.id));
      if (existingById >= 0) {
        // Update existing message (e.g. when deleted)
        // Preserve reply_to and reply_to_id if server returns null/undefined (happens for own messages)
        const existingMsg = prev[existingById];
        const merged = { ...existingMsg, ...newMsg };
        if (!merged.reply_to && existingMsg.reply_to) {
          merged.reply_to = existingMsg.reply_to;
        }
        if (!merged.reply_to_id && existingMsg.reply_to_id) {
          merged.reply_to_id = existingMsg.reply_to_id;
        }
        const updated = [...prev];
        updated[existingById] = merged;
        return updated;
      }

      // No match — new message, just add it
      return [...prev, newMsg].sort((a, b) => (Number(a.time) || 0) - (Number(b.time) || 0));
    });
    // Auto-scroll if already at bottom
    if (containerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
      if (scrollHeight - scrollTop - clientHeight < 150) {
        requestAnimationFrame(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }));
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTypingEvent = useCallback((data: unknown) => {
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
  }, [userId]);

  const handleReconnect = useCallback(() => {
    // Silently re-fetch messages after SSE reconnection to catch any missed during disconnect.
    // Uses silentRefresh instead of loadMessages to avoid loading spinner and scroll reset.
    silentRefreshRef.current();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Realtime: new messages + typing indicators
  useRealtimeEvents({
    message_sync: handleMessageSync,
    typing: handleTypingEvent,
    reconnect: handleReconnect,
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

  const handleFlag = useCallback(async (messageId: string, currentlyFlagged: boolean) => {
    setMessages((prev) => prev.map((m) =>
      String(m.id) === messageId ? { ...m, flagged: !currentlyFlagged } : m
    ));
    try {
      if (currentlyFlagged) {
        await api.unflagMessage(messageId);
      } else {
        await api.flagMessage(messageId);
      }
    } catch {
      setMessages((prev) => prev.map((m) =>
        String(m.id) === messageId ? { ...m, flagged: currentlyFlagged } : m
      ));
    }
  }, []);

  const handleSend = async (text: string) => {
    const opts = replyTo ? { reply_to_id: String(replyTo.id) } : undefined;
    setReplyTo(null);
    requestAnimationFrame(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }));
    try {
      await api.sendMessage(chat.id, chat.type, text, opts);
      // SSE will deliver the real message back — no optimistic needed
    } catch {
      setSendError('Nachricht konnte nicht gesendet werden.');
      setTimeout(() => setSendError(null), 5000);
    }
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
  // Poll invites and video meetings are always standalone (not grouped)
  const groups: Array<{ sender: Message['sender']; isOwn: boolean; messages: Message[]; isSystem?: boolean; isStandalone?: boolean }> = [];
  for (const msg of messages) {
    if (SYSTEM_KINDS.has(msg.kind ?? '')) {
      groups.push({ sender: msg.sender, isOwn: false, messages: [msg], isSystem: true });
      continue;
    }
    // Poll invites, calendar events, and video meetings are always standalone
    const isPoll = isPollInviteMessage(msg);
    const isVideo = isVideoMeetingMessage(msg);
    const isEvent = isCalendarEventMessage(msg);
    if (isPoll || isVideo || isEvent) {
      groups.push({ sender: msg.sender, isOwn: false, messages: [msg], isStandalone: true });
      continue;
    }
    const isOwn = String(msg.sender?.id) === userId;
    const last = groups[groups.length - 1];
    // Don't add to system groups or standalone groups (poll/video)
    // Also don't group messages from different days together
    const lastMsg = last?.messages[last.messages.length - 1];
    const lastDay = lastMsg ? msgDayKey(Number(lastMsg.time)) : '';
    const thisDay = msg.time ? msgDayKey(msg.time) : '';
    const sameDay = lastDay === thisDay;
    if (last && !last.isSystem && !last.isStandalone && String(last.sender?.id) === String(msg.sender?.id) && sameDay) {
      last.messages.push(msg);
    } else {
      groups.push({ sender: msg.sender, isOwn, messages: [msg] });
    }
  }

  return (
    <div className="flex h-full flex-1 overflow-hidden">
      {/* Main chat area */}
      <div
        className="relative flex min-w-0 flex-1 flex-col bg-ci-blue-50 dark:bg-surface-950"
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={(e) => { if (e.currentTarget.contains(e.relatedTarget as Node)) return; setDragOver(false); }}
        onDrop={async (e) => {
          e.preventDefault();
          setDragOver(false);
          // Check for file-id from sidebar drag (forward existing file)
          const fileId = e.dataTransfer.getData('text/file-id');
          if (fileId) {
            try {
              await api.sendMessage(chat.id, chat.type, '', { files: [fileId] });
              await loadMessages();
            } catch (err) {
              alert(`Datei weiterleiten fehlgeschlagen: ${err instanceof Error ? err.message : err}`);
            }
            return;
          }
          const files = Array.from(e.dataTransfer.files ?? []);
          if (files.length > 0) {
            setDroppedFiles(files);
          }
        }}
      >
      {/* Drop overlay */}
      {dragOver && (
        <div className="absolute inset-0 z-40 flex items-center justify-center rounded-xl border-2 border-dashed border-primary-400 bg-primary-50/80 dark:bg-primary-950/80">
          <div className="flex flex-col items-center gap-2 text-primary-600 dark:text-primary-400">
            <ArrowDown size={32} />
            <span className="text-sm font-medium">Datei hier ablegen</span>
          </div>
        </div>
      )}
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-surface-200 px-6 py-3 dark:border-surface-700">
        {chat.type === 'channel' ? (
          chat.image
            ? <Avatar name={chat.name} image={chat.image} size="md" />
            : <Hash size={22} className="text-surface-600" />
        ) : (
          <Avatar name={chat.name} image={chat.image} size="md" />
        )}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-surface-900 dark:text-white">{chat.name}</h2>
          {cleanDescription ? (
            <div className="flex items-center gap-1">
              <p className="min-w-0 truncate text-xs text-surface-600 dark:text-surface-400">
                <LinkifiedText text={cleanDescription} />
              </p>
              {isManager && chat.type === 'channel' && (
                <button
                  onClick={() => setDescEditorOpen(true)}
                  className="shrink-0 rounded p-0.5 text-surface-400 transition hover:bg-surface-200 hover:text-surface-600 dark:text-surface-400 dark:hover:bg-surface-800 dark:hover:text-surface-600"
                  title="Beschreibung bearbeiten"
                >
                  <Pencil size={11} />
                </button>
              )}
            </div>
          ) : isManager && chat.type === 'channel' && !chatDescription ? (
            <button
              onClick={() => setDescEditorOpen(true)}
              className="flex items-center gap-1 text-xs text-surface-600 transition hover:text-primary-500"
            >
              <Pencil size={11} /> Beschreibung hinzufügen
            </button>
          ) : null}
        </div>
        {/* Video meeting button */}
        <button
          onClick={async () => {
            if (meetingLoading) return;
            setMeetingLoading(true);
            // Open blank tab NOW (direct user gesture) — browsers block window.open() after async awaits
            const moderatorTab = window.open('', '_blank');
            if (moderatorTab) {
              moderatorTab.document.write(`<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><title>Videokonferenz wird geladen…</title><style>*{margin:0;padding:0;box-sizing:border-box}body{display:flex;align-items:center;justify-content:center;min-height:100vh;background:#1e293b;font-family:system-ui,sans-serif;color:#e2e8f0}.card{text-align:center;padding:2.5rem 3rem;background:#0f172a;border-radius:1.5rem;border:1px solid #334155;box-shadow:0 25px 50px #0006}.spinner{width:48px;height:48px;border:4px solid #334155;border-top-color:#6366f1;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 1.5rem}.emoji{font-size:3rem;margin-bottom:1rem}h1{font-size:1.25rem;font-weight:600;color:#f1f5f9;margin-bottom:.5rem}p{font-size:.9rem;color:#94a3b8}@keyframes spin{to{transform:rotate(360deg)}}</style></head><body><div class="card"><div class="emoji">📹</div><div class="spinner"></div><h1>Videokonferenz wird geladen…</h1><p>Bitte einen Moment warten.</p></div></body></html>`);
              moderatorTab.document.close();
            }
            try {
              const result = await api.startVideoMeeting(chat.id, chat.type);
              // Navigate the pre-opened tab to the moderator link (fallback: invite link)
              const tabLink = result.moderatorLink ?? result.inviteLink;
              if (tabLink && moderatorTab) {
                moderatorTab.location.href = tabLink;
              } else if (moderatorTab) {
                moderatorTab.close();
              }
              // Post invite link as formatted message in current chat
              if (result.inviteLink) {
                const now = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
                const text = `📹 Videokonferenz gestartet um ${now} Uhr\nJetzt beitreten: ${result.inviteLink}`;
                await api.sendMessage(chat.id, chat.type, text);
                await loadMessages();
              }
            } catch (err) {
              moderatorTab?.close();
              console.error('Failed to start meeting:', err);
              alert(err instanceof Error ? err.message : 'Videokonferenz konnte nicht erstellt werden');
            } finally {
              setMeetingLoading(false);
            }
          }}
          disabled={meetingLoading}
          className={clsx(
            'rounded-lg p-2 transition',
            meetingLoading
              ? 'animate-pulse text-primary-500'
              : 'text-surface-600 hover:bg-surface-200 dark:hover:bg-surface-800',
          )}
          title="Videokonferenz starten"
        >
          {meetingLoading ? <Loader2 size={20} className="animate-spin" /> : <Video size={20} />}
        </button>
        {/* Service link buttons (Moodle, BBB, TaskCards) extracted from channel description */}
        {serviceLinks.map((link, i) => (
          <a
            key={`${link.type}-${i}`}
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            title={`${link.label} öffnen`}
            className={clsx(
              'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:opacity-90',
              link.type === 'moodle' && 'bg-orange-500 hover:bg-orange-600',
              link.type === 'bbb' && 'bg-blue-500 hover:bg-blue-600',
              link.type === 'taskcards' && 'bg-teal-500 hover:bg-teal-600',
            )}
          >
            {link.type === 'moodle' && <GraduationCap size={16} />}
            {link.type === 'bbb' && <span className="text-sm">📹</span>}
            {link.type === 'taskcards' && <span className="text-sm">📋</span>}
            {link.label}
          </a>
        ))}
        {chat.type === 'channel' && isManager && (
          <ChannelDropdownMenu
            chat={chat}
            isManager={isManager}
            onOpenMembers={() => setMembersOpen(true)}
            onOpenDescriptionEditor={() => setDescEditorOpen(true)}
          />
        )}
        {chat.type === 'channel' && (
          <button
            onClick={() => setMembersOpen((o) => !o)}
            className={clsx(
              'rounded-lg p-2 transition',
              membersOpen
                ? 'bg-primary-100 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400'
                : 'text-surface-600 hover:bg-surface-200 dark:hover:bg-surface-800',
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
              : 'text-surface-600 hover:bg-surface-200 dark:hover:bg-surface-800',
          )}
          title="Dateiablage"
        >
          <FolderOpen size={20} />
        </button>
        {onToggleFlagged && (
          <button
            onClick={onToggleFlagged}
            className={clsx(
              'rounded-lg p-2 transition',
              flaggedOpen
                ? 'bg-primary-100 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400'
                : 'text-surface-600 hover:bg-surface-200 dark:hover:bg-surface-800',
            )}
            title="Markierte Nachrichten"
          >
            <Bookmark size={20} />
          </button>
        )}
        <button
          onClick={() => setSearchOpen((o) => !o)}
          className={clsx(
            'rounded-lg p-2 transition',
            searchOpen
              ? 'bg-primary-100 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400'
              : 'text-surface-600 hover:bg-surface-200 dark:hover:bg-surface-800',
          )}
          title="Suche (Ctrl+F)"
        >
          <Search size={20} />
        </button>
        <button
          onClick={onGoHome}
          className="rounded-lg p-2 text-surface-600 hover:bg-surface-200 dark:hover:bg-surface-800"
          title="Zur Startseite"
        >
          <Home size={20} />
        </button>
      </div>

      {/* In-chat search bar */}
      {searchOpen && (
        <div className="shrink-0 border-b border-surface-200 bg-surface-50 dark:border-surface-700 dark:bg-surface-900/50">
          {/* Row 1: text search + date toggle */}
          <div className="flex items-center gap-2 px-4 py-2">
            <Search size={15} className="shrink-0 text-surface-600" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { setSearchOpen(false); setSearchQuery(''); setDateSearchMode(false); setDateSearchResults(null); }
                if (e.key === 'Enter' && !dateSearchMode) setSearchMatchIdx((i) => i + (e.shiftKey ? -1 : 1));
                if (e.key === 'Enter' && dateSearchMode && !e.shiftKey && dateStart && dateEnd) runDateSearch();
                if (e.key === 'Enter' && dateSearchMode && searchMatches.length > 0) setSearchMatchIdx((i) => i + (e.shiftKey ? -1 : 1));
              }}
              placeholder={dateSearchMode ? 'Textfilter (optional)…' : 'In Nachrichten suchen…'}
              className="min-w-0 flex-1 bg-transparent text-sm text-surface-900 outline-none placeholder:text-surface-600 dark:text-white"
            />
            {searchQuery.trim().length >= 2 && (
              <span className="shrink-0 text-xs text-surface-600">
                {searchMatches.length === 0
                  ? viewingDateResults ? 'Keine Treffer' : hasMore ? 'Keine Treffer (in geladenen Nachrichten)' : 'Keine Treffer'
                  : `${((searchMatchIdx % searchMatches.length) + searchMatches.length) % searchMatches.length + 1} / ${searchMatches.length}${!viewingDateResults && hasMore ? ' (in geladenen Nachrichten)' : ''}`}
              </span>
            )}
            {searchMatches.length > 0 && (
              <>
                <button onClick={() => setSearchMatchIdx((i) => i - 1)} className="rounded p-1 text-surface-600 hover:bg-surface-200 dark:hover:bg-surface-700" title="Vorheriger Treffer (Shift+Enter)">
                  <ArrowDown size={14} className="rotate-180" />
                </button>
                <button onClick={() => setSearchMatchIdx((i) => i + 1)} className="rounded p-1 text-surface-600 hover:bg-surface-200 dark:hover:bg-surface-700" title="Nächster Treffer (Enter)">
                  <ArrowDown size={14} />
                </button>
              </>
            )}
            <button
              onClick={() => { setDateSearchMode((m) => !m); setDateSearchResults(null); }}
              className={clsx(
                'rounded p-1 transition',
                dateSearchMode
                  ? 'bg-primary-100 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400'
                  : 'text-surface-600 hover:bg-surface-200 dark:hover:bg-surface-700',
              )}
              title="Datumsbereich-Suche"
            >
              <CalendarDays size={15} />
            </button>
            <button onClick={() => { setSearchOpen(false); setSearchQuery(''); setDateSearchMode(false); setDateSearchResults(null); }} className="rounded p-1 text-surface-600 hover:bg-surface-200 dark:hover:bg-surface-700">
              <X size={15} />
            </button>
          </div>

          {/* Row 2: date inputs (only when dateSearchMode) */}
          {dateSearchMode && (
            <div className="flex items-center gap-2 border-t border-surface-200 px-4 py-2 dark:border-surface-700">
              <span className="text-xs text-surface-600">Von</span>
              <input
                type="date"
                value={dateStart}
                onChange={(e) => setDateStart(e.target.value)}
                className="rounded border border-surface-300 bg-white px-2 py-1 text-xs text-surface-900 dark:border-surface-600 dark:bg-surface-800 dark:text-white"
              />
              <span className="text-xs text-surface-600">Bis</span>
              <input
                type="date"
                value={dateEnd}
                onChange={(e) => setDateEnd(e.target.value)}
                className="rounded border border-surface-300 bg-white px-2 py-1 text-xs text-surface-900 dark:border-surface-600 dark:bg-surface-800 dark:text-white"
              />
              <button
                onClick={runDateSearch}
                disabled={!dateStart || !dateEnd || dateSearchLoading}
                className="flex items-center gap-1 rounded bg-primary-500 px-3 py-1 text-xs font-medium text-white transition hover:bg-primary-600 disabled:opacity-50"
              >
                {dateSearchLoading ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
                Suchen
              </button>
              {dateSearchResults !== null && (
                <span className="text-xs text-surface-600">
                  {dateSearchResults.length === 0 ? 'Keine Treffer' : `${dateSearchResults.length} Treffer`}
                </span>
              )}
            </div>
          )}

          {/* Row 3: date search results list */}
          {dateSearchMode && dateSearchResults && dateSearchResults.length > 0 && (
            <div className="max-h-48 overflow-y-auto border-t border-surface-200 dark:border-surface-700">
              {dateSearchResults.map((msg) => {
                const time = new Date((Number(msg.time) || 0) * 1000);
                const sender = msg.sender
                  ? `${msg.sender.first_name ?? ''} ${msg.sender.last_name ?? ''}`.trim()
                  : '';
                const preview = (msg.text ?? '').slice(0, 80) + ((msg.text ?? '').length > 80 ? '…' : '');
                return (
                  <button
                    key={String(msg.id)}
                    onClick={() => jumpToDateResult(String(msg.id))}
                    className="flex w-full items-start gap-2 px-4 py-2 text-left text-xs transition hover:bg-surface-100 dark:hover:bg-surface-800"
                  >
                    <span className="shrink-0 font-medium text-surface-500">
                      {time.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })} {time.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    {sender && <span className="shrink-0 font-semibold text-surface-700 dark:text-surface-300">{sender}</span>}
                    <span className="min-w-0 flex-1 truncate text-surface-600 dark:text-surface-400">{preview}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Date results banner */}
      {viewingDateResults && (
        <div className="flex shrink-0 items-center gap-2 border-b border-primary-200 bg-primary-50 px-4 py-2 dark:border-primary-800 dark:bg-primary-950/30">
          <CalendarDays size={14} className="text-primary-500" />
          <span className="flex-1 text-xs text-primary-700 dark:text-primary-300">
            Suchergebnisse{dateStart && dateEnd ? ` vom ${new Date(dateStart).toLocaleDateString('de-DE')} bis ${new Date(dateEnd).toLocaleDateString('de-DE')}` : ''}
            {dateSearchResults ? ` (${dateSearchResults.length} Nachrichten)` : ''}
          </span>
          <button
            onClick={restoreMessages}
            className="flex items-center gap-1 rounded bg-primary-500 px-3 py-1 text-xs font-medium text-white transition hover:bg-primary-600"
          >
            <ArrowLeft size={12} />
            Zurück zur aktuellen Ansicht
          </button>
        </div>
      )}

      {/* Messages */}
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="relative flex-1 overflow-x-hidden overflow-y-auto px-4 py-4"
      >
        {/* Load-more area at top */}
        {loadingMore && (
          <div className="flex justify-center pb-3">
            <Loader2 size={20} className="animate-spin text-primary-400" />
          </div>
        )}
        {!loadingMore && hasMore && messages.length > 0 && (
          <div className="flex justify-center pb-3">
            <button
              onClick={loadOlder}
              className="flex items-center gap-1.5 rounded-full border border-surface-200 bg-white px-4 py-1.5 text-xs font-medium text-surface-600 shadow-sm transition hover:border-primary-300 hover:text-primary-600 dark:border-surface-700 dark:bg-surface-900 dark:text-surface-400 dark:hover:border-primary-600 dark:hover:text-primary-400"
            >
              <ArrowDown size={12} className="rotate-180" />
              Ältere Nachrichten laden
            </button>
          </div>
        )}
        {!loadingMore && !hasMore && messages.length > 0 && (
          <div className="pb-3 text-center text-xs text-surface-600">Anfang des Verlaufs</div>
        )}

        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 size={32} className="animate-spin text-primary-500" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center text-surface-600">
            <Hash size={48} className="mb-3" />
            <p className="text-lg font-medium">Noch keine Nachrichten</p>
            <p className="text-sm">Schreibe die erste Nachricht!</p>
          </div>
        ) : settings.bubbleView ? (
          <div className="flex flex-col gap-8">
            {(() => {
              const currentNormalizedIdx = searchMatches.length > 0
                ? ((searchMatchIdx % searchMatches.length) + searchMatches.length) % searchMatches.length
                : -1;
              const currentMatchMsgId = currentNormalizedIdx >= 0 ? searchMatches[currentNormalizedIdx] : null;
              const searchMatchSet = new Set(searchMatches);
              let lastDayKey = '';
              return groups.flatMap((group, gi) => {
                const firstTs = Number(group.messages[0].time);
                const dayKey = firstTs ? msgDayKey(firstTs) : '';
                const elements: ReactNode[] = [];
                if (dayKey && dayKey !== lastDayKey) {
                  lastDayKey = dayKey;
                  elements.push(<DateSeparator key={`sep-${gi}`} label={formatDateLabel(firstTs)} />);
                }
                if (group.isSystem) {
                  const sysMsg = group.messages[0];
                  if (isPollInviteMessage(sysMsg)) {
                    elements.push(<PollInviteMessage key={gi} msg={sysMsg} onOpenPolls={onOpenPolls} onOpenPoll={onOpenPoll} />);
                  } else if (isCalendarEventMessage(sysMsg)) {
                    elements.push(<CalendarEventCard key={gi} msg={sysMsg} onOpenCalendar={onOpenCalendar} />);
                  } else {
                    elements.push(<SystemMessage key={gi} msg={sysMsg} />);
                  }
                } else if (group.messages.length === 1 && isPollInviteMessage(group.messages[0])) {
                  elements.push(<PollInviteMessage key={gi} msg={group.messages[0]} onOpenPolls={onOpenPolls} onOpenPoll={onOpenPoll} />);
                } else if (group.messages.length === 1 && isCalendarEventMessage(group.messages[0])) {
                  elements.push(<CalendarEventCard key={gi} msg={group.messages[0]} onOpenCalendar={onOpenCalendar} />);
                } else if (group.messages.length === 1 && isVideoMeetingMessage(group.messages[0])) {
                  elements.push(<VideoMeetingCard key={gi} msg={group.messages[0]} />);
                } else {
                  elements.push(
                    <MessageGroup
                      key={gi}
                      group={group}
                      canDeleteAll={isManager && chat.type === 'channel'}
                      showImagesInline={settings.showImagesInline}
                      ownBubbleColor={settings.ownBubbleColor}
                      otherBubbleColor={settings.otherBubbleColor}
                      messageMap={messageMap}
                      onDelete={handleDelete}
                      onLike={handleLike}
                      onFlag={handleFlag}
                      onReply={setReplyTo}
                      onForward={setForwardMsg}
                      onImageClick={setLightboxUrl}
                      onPdfClick={(fid, vurl, name) => setPdfView({ fileId: fid, viewUrl: vurl, name })}
                      searchQuery={searchQuery}
                      searchMatchSet={searchMatchSet}
                      currentMatchMsgId={currentMatchMsgId}
                      onMatchRef={(msgId, el) => {
                        const idx = searchMatches.indexOf(msgId);
                        if (idx >= 0) searchMatchRefs.current[idx] = el;
                      }}
                      firstUnreadMsgId={firstUnreadMsgId}
                    />,
                  );
                }
                return elements;
              });
            })()}
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-surface-100 dark:divide-surface-800">
            {(() => {
              let lastDayKey = '';
              return messages.flatMap((msg) => {
                const ts = Number(msg.time);
                const dayKey = ts ? msgDayKey(ts) : '';
                const elements: ReactNode[] = [];
                if (String(msg.id) === firstUnreadMsgId) {
                  elements.push(
                    <div key={`unread-${msg.id}`} className="my-2 flex items-center justify-center gap-4 w-full px-4">
                      <div className="h-px flex-1 bg-red-400/50 dark:bg-red-500/50" />
                      <span className="text-[11px] font-bold uppercase tracking-wider text-red-500 dark:text-red-400">Neu</span>
                      <div className="h-px flex-1 bg-red-400/50 dark:bg-red-500/50" />
                    </div>
                  );
                }
                if (dayKey && dayKey !== lastDayKey) {
                  lastDayKey = dayKey;
                  elements.push(<DateSeparator key={`sep-${msg.id}`} label={formatDateLabel(ts)} />);
                }
                if (SYSTEM_KINDS.has(msg.kind ?? '')) {
                  elements.push(<SystemMessage key={msg.id} msg={msg} />);
                  return elements;
                }
                if (isPollInviteMessage(msg)) {
                  elements.push(<PollInviteMessage key={msg.id} msg={msg} onOpenPolls={onOpenPolls} onOpenPoll={onOpenPoll} />);
                  return elements;
                }
                if (isCalendarEventMessage(msg)) {
                  elements.push(<CalendarEventCard key={msg.id} msg={msg} onOpenCalendar={onOpenCalendar} />);
                  return elements;
                }
                if (isVideoMeetingMessage(msg)) {
                  elements.push(<VideoMeetingCard key={msg.id} msg={msg} />);
                  return elements;
                }
                const globalMatchIdx = searchMatches.indexOf(String(msg.id));
                const isCurrentMatch = globalMatchIdx >= 0 && ((searchMatchIdx % searchMatches.length + searchMatches.length) % searchMatches.length) === globalMatchIdx;
                elements.push(
                  <div
                    key={msg.id}
                    id={`msg-${msg.id}`}
                    data-msg-id={String(msg.id)}
                    data-sender-id={String(msg.sender?.id ?? '')}
                    data-msg-time={String(msg.time ?? 0)}
                    ref={globalMatchIdx >= 0 ? (el) => { searchMatchRefs.current[globalMatchIdx] = el; } : undefined}
                    className={clsx(globalMatchIdx >= 0 && 'ring-inset ring-2', isCurrentMatch ? 'ring-yellow-400 dark:ring-yellow-500' : globalMatchIdx >= 0 ? 'ring-yellow-200 dark:ring-yellow-800' : undefined)}
                  >
                    <PlainTextMessage
                      msg={msg}
                      isOwn={String(msg.sender?.id) === userId}
                      canDelete={String(msg.sender?.id) === userId || (isManager && chat.type === 'channel')}
                      showImagesInline={settings.showImagesInline}
                      messageMap={messageMap}
                      onDelete={handleDelete}
                      onLike={handleLike}
                      onFlag={handleFlag}
                      onReply={setReplyTo}
                      onForward={setForwardMsg}
                      onImageClick={setLightboxUrl}
                      onPdfClick={(fid, vurl, name) => setPdfView({ fileId: fid, viewUrl: vurl, name })}
                      searchQuery={searchQuery}
                    />
                  </div>,
                );
                return elements;
              });
            })()}
          </div>
        )}
        <div ref={messagesEndRef} />

        {showScrollBtn && (
          <button
            onClick={() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })}
            className="absolute bottom-4 right-6 rounded-full bg-ci-red-500 p-2 text-white shadow-lg transition hover:bg-ci-red-600"
          >
            <ArrowDown size={20} />
          </button>
        )}
      </div>

      {/* Typing indicator */}
      {typingUsers.length > 0 && (
        <div className="shrink-0 px-6 pb-1 text-xs text-surface-600 italic">
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

      {sendError && (
        <div className="mx-4 mb-1 rounded bg-red-100 px-3 py-1.5 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">
          {sendError}
        </div>
      )}
      <MessageInput onSend={handleSend} onUpload={handleUpload} onTyping={handleTyping} chatId={chat.id} chatName={chat.name} replyTo={replyTo} onCancelReply={() => setReplyTo(null)} onCreatePoll={() => setShowPollModal(true)} onCreateEvent={() => setShowEventModal(true)} droppedFiles={droppedFiles} onDroppedFilesConsumed={() => setDroppedFiles([])} />
      {showPollModal && (
        <CreatePollModal
          preselectedChat={chat}
          onClose={() => setShowPollModal(false)}
          onCreated={() => setShowPollModal(false)}
        />
      )}
      {showEventModal && (
        <CreateEventModal
          initialDate={null}
          preselectedChat={chat}
          onClose={() => setShowEventModal(false)}
          onCreated={() => setShowEventModal(false)}
        />
      )}
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
              className="rounded-md p-1.5 text-surface-400 hover:bg-surface-700"
              title="Herunterladen"
            >
              <ExternalLink size={16} />
            </a>
            <button
              onClick={() => setPdfView(null)}
              className="rounded-md p-1.5 text-surface-400 hover:bg-surface-700"
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
  ownBubbleColor,
  otherBubbleColor,
  messageMap,
  onDelete,
  onLike,
  onFlag,
  onReply,
  onForward,
  onImageClick,
  onPdfClick,
  searchQuery = '',
  searchMatchSet = new Set(),
  currentMatchMsgId = null,
  onMatchRef,
  firstUnreadMsgId,
}: {
  group: { sender: Message['sender']; isOwn: boolean; messages: Message[] };
  canDeleteAll: boolean;
  showImagesInline: boolean;
  ownBubbleColor: string;
  otherBubbleColor: string;
  messageMap: Map<number, Message>;
  onDelete: (messageId: string) => void;
  onLike: (messageId: string, liked: boolean) => void;
  onFlag: (messageId: string, flagged: boolean) => void;
  onReply: (msg: Message) => void;
  onForward: (msg: Message) => void;
  onImageClick: (url: string) => void;
  onPdfClick: (fileId: string, viewUrl: string, name: string) => void;
  searchQuery?: string;
  searchMatchSet?: Set<string>;
  currentMatchMsgId?: string | null;
  onMatchRef?: (msgId: string, el: HTMLDivElement | null) => void;
  firstUnreadMsgId?: string | null;
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

      <div className={clsx('flex min-w-0 max-w-[75%] flex-col gap-1', isOwn ? 'items-end' : 'items-start')}>
        {!isOwn && (
          <span className="mb-0.5 pl-1 text-xs font-semibold text-surface-600 dark:text-surface-400">
            {senderName}
          </span>
        )}

        {messages.map((msg, i) => {
          const isFirstUnread = String(msg.id) === firstUnreadMsgId;
          const timeDate = msg.time ? new Date(msg.time * 1000) : null;
          const time = timeDate ? timeDate.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '';
          const isToday = timeDate ? msgDayKey(msg.time!) === msgDayKey(Date.now() / 1000) : true;
          const timeDisplay = (!isToday && timeDate)
            ? timeDate.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) + ' · ' + time
            : time;
          const isFirst = i === 0;
          const isLast = i === messages.length - 1;
          const content = msg.deleted || msg.is_deleted_by_manager
            ? '*`Nachricht wurde gelöscht`*'
            : msg.text || (msg.encrypted ? '🔒 *Verschlüsselte Nachricht*' : (msg.files?.length ? '' : '*`Nachricht wurde gelöscht`*'));
          const canDelete = isOwn || canDeleteAll;
          // Try msg.reply_to first, fall back to reply_to_id if available
          let replyTo: Message | undefined;
          if (msg.reply_to && msg.reply_to.message_id) {
            replyTo = messageMap.get(msg.reply_to.message_id);
          } else if (msg.reply_to_id) {
            // Server may only return reply_to_id without the full reply_to object
            replyTo = messageMap.get(Number(msg.reply_to_id));
          }

          const isBubbleMatch = searchMatchSet.has(String(msg.id));
          const isBubbleCurrent = currentMatchMsgId === String(msg.id);
          return (
            <React.Fragment key={msg.id}>
              {isFirstUnread && (
                <div className="my-2 flex items-center justify-center gap-4 w-full self-center px-4">
                  <div className="h-px flex-1 bg-red-400/50 dark:bg-red-500/50" />
                  <span className="text-[11px] font-bold uppercase tracking-wider text-red-500 dark:text-red-400">Neu</span>
                  <div className="h-px flex-1 bg-red-400/50 dark:bg-red-500/50" />
                </div>
              )}
            <div
              id={`msg-${msg.id}`}
              data-msg-id={String(msg.id)}
              data-sender-id={String(msg.sender?.id ?? '')}
              data-msg-time={String(msg.time ?? 0)}
              ref={isBubbleMatch ? (el) => onMatchRef?.(String(msg.id), el) : undefined}
              className={clsx(
                'group/msg relative flex flex-col gap-1 before:pointer-events-auto before:absolute before:-top-8 before:left-0 before:right-0 before:h-8',
                isOwn ? 'items-end' : 'items-start',
                isBubbleMatch && 'rounded-xl ring-2',
                isBubbleCurrent ? 'ring-yellow-400 dark:ring-yellow-500' : isBubbleMatch ? 'ring-yellow-200 dark:ring-yellow-800' : undefined,
              )}
            >
              {/* Action buttons — above the bubble; ::before extends hover zone so buttons don't vanish */}
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
                      : 'text-surface-600 hover:bg-surface-200 hover:text-amber-500 dark:hover:bg-surface-700 dark:hover:text-amber-400',
                  )}
                >
                  <ThumbsUp size={13} />
                </button>
                <button
                  onClick={() => onReply(msg)}
                  title="Antworten"
                  className="flex items-center justify-center rounded-md p-1 text-surface-600 hover:bg-surface-200 hover:text-primary-600 dark:hover:bg-surface-700 dark:hover:text-primary-400 transition"
                >
                  <Reply size={13} />
                </button>
                <button
                  onClick={() => { if (msg.text) navigator.clipboard.writeText(msg.text).catch(() => {}); }}
                  title="Kopieren"
                  className="flex items-center justify-center rounded-md p-1 text-surface-600 hover:bg-surface-200 hover:text-surface-700 dark:hover:bg-surface-700 dark:hover:text-surface-200 transition"
                >
                  <Copy size={13} />
                </button>
                <button
                  onClick={() => onForward(msg)}
                  title="Weiterleiten"
                  className="flex items-center justify-center rounded-md p-1 text-surface-600 hover:bg-surface-200 hover:text-surface-700 dark:hover:bg-surface-700 dark:hover:text-surface-200 transition"
                >
                  <Forward size={13} />
                </button>
                <button
                  onClick={() => onFlag(String(msg.id), Boolean(msg.flagged))}
                  title={msg.flagged ? 'Markierung entfernen' : 'Markieren'}
                  className={clsx(
                    'flex items-center justify-center rounded-md p-1 transition',
                    msg.flagged
                      ? 'text-amber-500 dark:text-amber-400'
                      : 'text-surface-600 hover:bg-surface-200 hover:text-amber-500 dark:hover:bg-surface-700 dark:hover:text-amber-400',
                  )}
                >
                  <Bookmark size={13} fill={msg.flagged ? 'currentColor' : 'none'} />
                </button>
                {canDelete && (
                  <button
                    onClick={() => onDelete(String(msg.id))}
                    title="Löschen"
                    className="flex items-center justify-center rounded-md p-1 text-surface-600 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400 transition"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>

              {/* Bookmark indicator for flagged messages */}
              {msg.flagged && (
                <div className={clsx('absolute -top-1.5 z-10', isOwn ? '-left-1' : '-right-1')}>
                  <Bookmark size={14} className="text-amber-500 dark:text-amber-400" fill="currentColor" />
                </div>
              )}

              <div
                className={clsx(
                  'relative max-w-full rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed',
                  isOwn && !isFirst && 'rounded-tr-md',
                  isOwn && !isLast && 'rounded-br-md',
                  !isOwn && !isFirst && 'rounded-tl-md',
                  !isOwn && !isLast && 'rounded-bl-md',
                )}
                style={{
                  backgroundColor: isOwn ? ownBubbleColor : otherBubbleColor,
                  color: isOwn ? '#fff' : undefined,
                }}
              >
                {replyTo && <ReplyQuote msg={replyTo} isOwn={isOwn} />}
                {msg.is_forwarded && (
                  <div className={clsx('mb-1 flex items-center gap-1 text-[11px] italic', isOwn ? 'text-primary-200' : 'text-surface-600')}>
                    <Forward size={10} /> Weitergeleitet
                  </div>
                )}
                {/* Scrollable content area for long text without spaces */}
                <div className="overflow-x-auto">
                  {searchQuery && content.toLowerCase().includes(searchQuery.toLowerCase())
                    ? <p className="whitespace-pre"><HighlightedText text={content} query={searchQuery} /></p>
                    : <MarkdownContent content={content} isOwn={isOwn} />}
                  <FileList files={msg.files} isOwn={isOwn} showImagesInline={showImagesInline} onImageClick={onImageClick} onPdfClick={onPdfClick} />
                </div>
              </div>

              {(isLast || (msg.likes ?? 0) > 0) && (
                <div className={clsx('relative z-10 flex items-center gap-1.5 px-1', isOwn ? 'flex-row-reverse' : 'flex-row')}>
                  {isLast && (
                    <span className="flex items-center gap-0.5 text-xs text-surface-600">
                      {timeDisplay}
                      {isOwn && (
                        msg.seen_by_others
                          ? <CheckCheck size={13} className="text-primary-500" />
                          : <Check size={13} />
                      )}
                    </span>
                  )}
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
            </React.Fragment>
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
  onFlag,
  onReply,
  onForward,
  onImageClick,
  onPdfClick,
  searchQuery = '',
}: {
  msg: Message;
  isOwn: boolean;
  canDelete: boolean;
  showImagesInline: boolean;
  messageMap: Map<number, Message>;
  onDelete: (messageId: string) => void;
  onLike: (messageId: string, liked: boolean) => void;
  onFlag: (messageId: string, flagged: boolean) => void;
  onReply: (msg: Message) => void;
  onForward: (msg: Message) => void;
  onImageClick: (url: string) => void;
  onPdfClick: (fileId: string, viewUrl: string, name: string) => void;
  searchQuery?: string;
}) {
  const senderName = msg.sender ? `${msg.sender.first_name} ${msg.sender.last_name}` : 'Unbekannt';
  const timeDate = msg.time ? new Date(msg.time * 1000) : null;
  const time = timeDate ? timeDate.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '';
  const isToday = timeDate ? msgDayKey(msg.time!) === msgDayKey(Date.now() / 1000) : true;
  const timeDisplay = (!isToday && timeDate)
    ? timeDate.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) + ' · ' + time
    : time;
  const content = msg.deleted || msg.is_deleted_by_manager
    ? 'Nachricht wurde gelöscht'
    : msg.text || (msg.encrypted ? '🔒 Verschlüsselte Nachricht' : (msg.files?.length ? '' : 'Nachricht wurde gelöscht'));
  // Try msg.reply_to first, fall back to reply_to_id if available
  let replyTo: Message | undefined;
  if (msg.reply_to && msg.reply_to.message_id) {
    replyTo = messageMap.get(msg.reply_to.message_id);
  } else if (msg.reply_to_id) {
    replyTo = messageMap.get(Number(msg.reply_to_id));
  }

  return (
    <div className="group/msg flex gap-3 px-2 py-2 hover:bg-surface-50 dark:hover:bg-surface-900/50">
      <Avatar name={senderName} image={msg.sender?.image} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className={clsx('text-sm font-semibold', isOwn ? 'text-primary-700 dark:text-primary-400' : 'text-surface-900 dark:text-surface-100')}>
            {senderName}
          </span>
          <span className="flex items-center gap-0.5 text-xs text-surface-600">
            {timeDisplay}
            {isOwn && (
              msg.seen_by_others
                ? <CheckCheck size={13} className="text-primary-500" />
                : <Check size={13} />
            )}
          </span>
          {msg.flagged && (
            <Bookmark size={12} className="text-amber-500 dark:text-amber-400" fill="currentColor" />
          )}
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
          <div className="mb-1 flex items-center gap-1 text-[11px] italic text-surface-600">
            <Forward size={10} /> Weitergeleitet
          </div>
        )}
        {/* Scrollable content area for long text without spaces */}
        <div className="overflow-x-auto">
          <div className="text-sm text-surface-800 dark:text-surface-200">
            {searchQuery && content.toLowerCase().includes(searchQuery.toLowerCase())
              ? <p className="whitespace-pre"><HighlightedText text={content} query={searchQuery} /></p>
              : <MarkdownContent content={content} isOwn={false} />}
          </div>
          <FileList files={msg.files} isOwn={false} showImagesInline={showImagesInline} onImageClick={onImageClick} onPdfClick={onPdfClick} />
        </div>
      </div>
      <div className="hidden shrink-0 group-hover/msg:flex items-center gap-0.5">
        <button
          onClick={() => onLike(String(msg.id), Boolean(msg.liked))}
          title={msg.liked ? 'Like entfernen' : 'Gefällt mir'}
          className={clsx(
            'flex items-center justify-center rounded-md p-1 transition',
            msg.liked ? 'text-amber-500' : 'text-surface-600 hover:bg-surface-200 hover:text-amber-500 dark:hover:bg-surface-700',
          )}
        >
          <ThumbsUp size={13} />
        </button>
        <button
          onClick={() => onReply(msg)}
          title="Antworten"
          className="flex items-center justify-center rounded-md p-1 text-surface-600 hover:bg-surface-200 hover:text-primary-600 dark:hover:bg-surface-700 dark:hover:text-primary-400 transition"
        >
          <Reply size={13} />
        </button>
        <button
          onClick={() => { if (msg.text) navigator.clipboard.writeText(msg.text).catch(() => {}); }}
          title="Kopieren"
          className="flex items-center justify-center rounded-md p-1 text-surface-600 hover:bg-surface-200 hover:text-surface-600 dark:hover:bg-surface-700 transition"
        >
          <Copy size={13} />
        </button>
        <button
          onClick={() => onForward(msg)}
          title="Weiterleiten"
          className="flex items-center justify-center rounded-md p-1 text-surface-600 hover:bg-surface-200 hover:text-surface-600 dark:hover:bg-surface-700 transition"
        >
          <Forward size={13} />
        </button>
        <button
          onClick={() => onFlag(String(msg.id), Boolean(msg.flagged))}
          title={msg.flagged ? 'Markierung entfernen' : 'Markieren'}
          className={clsx(
            'flex items-center justify-center rounded-md p-1 transition',
            msg.flagged
              ? 'text-amber-500 dark:text-amber-400'
              : 'text-surface-600 hover:bg-surface-200 hover:text-amber-500 dark:hover:bg-surface-700 dark:hover:text-amber-400',
          )}
        >
          <Bookmark size={13} fill={msg.flagged ? 'currentColor' : 'none'} />
        </button>
        {canDelete && (
          <button
            onClick={() => onDelete(String(msg.id))}
            title="Löschen"
            className="flex items-center justify-center rounded-md p-1 text-surface-600 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400 transition"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Video meeting card ────────────────────────────────────────────────────────

const VIDEO_MSG_RE = /^📹 Videokonferenz gestartet um (\d{2}:\d{2}) Uhr\nJetzt beitreten: (https?:\/\/stash\.cat\/l\/[a-zA-Z0-9_-]+)$/;

function isVideoMeetingMessage(msg: Message): boolean {
  return VIDEO_MSG_RE.test(msg.text || '');
}

function VideoMeetingCard({ msg }: { msg: Message }) {
  const match = (msg.text || '').match(VIDEO_MSG_RE);
  if (!match) return null;
  const [, startTime, link] = match;
  const senderName = msg.sender ? `${msg.sender.first_name} ${msg.sender.last_name}`.trim() : 'Jemand';
  const date = msg.time
    ? new Date(msg.time * 1000).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : '';

  return (
    <div className="flex justify-center py-3">
      <div className="w-full max-w-sm overflow-hidden rounded-2xl border-2 border-primary-300 bg-gradient-to-br from-primary-500 to-primary-700 shadow-lg dark:border-primary-600">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/20 text-2xl">
            📹
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-base font-bold text-white">Videokonferenz läuft!</p>
            <p className="text-xs text-primary-100">
              Gestartet von {senderName} · {date && `${date}, `}{startTime} Uhr
            </p>
          </div>
        </div>
        {/* Join button */}
        <div className="px-5 pb-4">
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-primary-700 shadow transition hover:bg-primary-50 active:scale-95"
          >
            <Video size={16} />
            🎙️ Jetzt beitreten
          </a>
          <p className="mt-2 text-center text-xs text-primary-200">
            Link ist 2 Stunden gültig
          </p>
        </div>
      </div>
    </div>
  );
}

// ── System message ─────────────────────────────────────────────────────────────

// ── Date separator ─────────────────────────────────────────────────────────────

function DateSeparator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-2 px-4">
      <div className="h-px flex-1 bg-surface-200 dark:bg-surface-700" />
      <span className="rounded-full bg-surface-100 px-3 py-0.5 text-xs font-medium text-surface-600 dark:bg-surface-800 dark:text-surface-400 select-none">
        {label}
      </span>
      <div className="h-px flex-1 bg-surface-200 dark:bg-surface-700" />
    </div>
  );
}

// ── Poll invite system message ────────────────────────────────────────────────

/** Extract poll ID from message text format: [... [%poll:ID%]] */
function extractPollId(msg: Message): string | undefined {
  // Try structured fields first
  const raw = msg as unknown as Record<string, unknown>;
  if (raw.poll_id) return String(raw.poll_id);
  if (raw.target_id) return String(raw.target_id);
  if (raw.survey_id) return String(raw.survey_id);
  // Parse from text format: "[%poll:ID%]"
  const match = (msg.text ?? '').match(/\[%poll:([^%]+)%\]$/);
  return match?.[1];
}

/** Convert message text to React spans, stripping poll markers and bold markers */
function renderPollText(text: string): ReactNode[] {
  if (!text) return [];

  // Strip poll marker and "Klicke hier" line
  let clean = text
    .replace(/\s*\[%poll:[^%]+%\]\s*$/, '')
    .replace(/\s*Klicke hier,? um teilzunehmen\.?\s*$/gim, '')
    .trim();

  // If no bold markers left, return plain text
  if (!clean.includes('**')) return [clean];

  // Split on **bold** patterns, handling German quotes around bold text
  const parts: ReactNode[] = [];
  const regex = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  while ((match = regex.exec(clean)) !== null) {
    if (match.index > lastIndex) {
      const slice = clean.slice(lastIndex, match.index);
      // Strip any stray ** from the slice
      parts.push(slice.replace(/\*\*/g, ''));
    }
    parts.push(
      <span key={key++} className="font-semibold">{match[1]}</span>
    );
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < clean.length) {
    parts.push(clean.slice(lastIndex).replace(/\*\*/g, ''));
  }
  return parts.length > 0 ? parts : [clean];
}

function PollInviteMessage({ msg, onOpenPolls, onOpenPoll }: { msg: Message; onOpenPolls?: () => void; onOpenPoll?: (pollId: string) => void }) {
  const time = msg.time
    ? new Date(msg.time * 1000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    : '';

  const pollId = extractPollId(msg);

  const handleClick = () => {
    if (pollId && onOpenPoll) {
      onOpenPoll(pollId);
    } else if (onOpenPolls) {
      onOpenPolls();
    }
  };

  return (
    <div className="flex justify-center py-2 px-4">
      <div className="rounded-xl bg-surface-700 px-5 py-3 text-center dark:bg-surface-800 max-w-xs shadow">
        <p className="text-sm text-surface-100 dark:text-surface-200 whitespace-pre-wrap">
          {renderPollText(msg.text ?? '')}
        </p>
        {(onOpenPolls || onOpenPoll) && (
          <button
            onClick={handleClick}
            className="mt-1 block text-sm font-semibold text-yellow-400 hover:text-yellow-300 dark:text-yellow-400 dark:hover:text-yellow-300 transition"
          >
            Klicke hier
          </button>
        )}
        {time && <p className="mt-1 text-xs text-surface-600">{time}</p>}
      </div>
    </div>
  );
}

// ── Calendar event notification card ─────────────────────────────────────────

function renderEventText(text: string): ReactNode[] {
  if (!text) return [];
  let clean = text
    .replace(/\s*\[%event:[^%]+%\]\s*$/, '')
    .replace(/\s*Details im Kalender ansehen\.?\s*$/gim, '')
    .trim();
  if (!clean.includes('**')) return [clean];
  const parts: ReactNode[] = [];
  const regex = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = regex.exec(clean)) !== null) {
    if (match.index > lastIndex) parts.push(clean.slice(lastIndex, match.index).replace(/\*\*/g, ''));
    parts.push(<span key={key++} className="font-semibold">{match[1]}</span>);
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < clean.length) parts.push(clean.slice(lastIndex).replace(/\*\*/g, ''));
  return parts.length > 0 ? parts : [clean];
}

function CalendarEventCard({ msg, onOpenCalendar }: { msg: Message; onOpenCalendar?: () => void }) {
  const time = msg.time
    ? new Date(msg.time * 1000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <div className="flex justify-center py-2 px-4">
      <div className="rounded-xl bg-surface-700 px-5 py-3 text-center dark:bg-surface-800 max-w-xs shadow">
        <p className="text-sm text-surface-100 dark:text-surface-200 whitespace-pre-wrap">
          {renderEventText(msg.text ?? '')}
        </p>
        {onOpenCalendar && (
          <button
            onClick={onOpenCalendar}
            className="mt-1 block text-sm font-semibold text-green-400 hover:text-green-300 dark:text-green-400 dark:hover:text-green-300 transition"
          >
            Im Kalender ansehen
          </button>
        )}
        {time && <p className="mt-1 text-xs text-surface-600">{time}</p>}
      </div>
    </div>
  );
}

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
      <div className="rounded-full bg-surface-100 px-4 py-1.5 text-xs text-surface-600 dark:bg-surface-800 dark:text-surface-400">
        <span className="font-medium">{text}</span>
        {time && <span className="ml-2 text-surface-600">{date}, {time}</span>}
      </div>
    </div>
  );
}

// ── Reply quote ────────────────────────────────────────────────────────────────

function ReplyQuote({ msg, isOwn }: { msg: Message; isOwn: boolean }) {
  const senderName = msg.sender ? `${msg.sender.first_name} ${msg.sender.last_name}`.trim() : 'Unbekannt';
  const isDeleted = msg.deleted || msg.is_deleted_by_manager;
  const text = isDeleted ? 'Nachricht wurde gelöscht' : (msg.text || (msg.files?.length ? '' : 'Nachricht wurde gelöscht'));
  const preview = text.slice(0, 120) + (text.length > 120 ? '...' : '');

  const handleClick = () => {
    const el = document.getElementById(`msg-${msg.id}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ring-2', 'ring-primary-400', 'rounded-xl');
      setTimeout(() => el.classList.remove('ring-2', 'ring-primary-400', 'rounded-xl'), 1500);
    }
  };

  return (
    <div
      onClick={handleClick}
      className={clsx(
        'mb-1.5 cursor-pointer rounded-lg border-l-3 px-2.5 py-1.5 text-xs transition hover:opacity-80',
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
                    : 'bg-surface-200 text-surface-600 hover:bg-surface-300 dark:bg-surface-700 dark:text-surface-400 dark:hover:bg-surface-600',
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
                      : 'bg-surface-200 text-surface-600 hover:bg-surface-300 dark:bg-surface-700 dark:text-surface-400 dark:hover:bg-surface-600',
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

/** Highlight search query occurrences in text */
function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query || query.trim().length < 2) return <>{text}</>;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase()
          ? <mark key={i} className="rounded bg-yellow-300 px-0.5 text-yellow-900 dark:bg-yellow-500 dark:text-yellow-950">{part}</mark>
          : part,
      )}
    </>
  );
}

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
          'flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold transition cursor-pointer shadow-sm',
          liked
            ? 'bg-amber-400 text-white dark:bg-amber-500 dark:text-white'
            : 'bg-surface-100 text-surface-600 hover:bg-amber-100 hover:text-amber-600 dark:bg-surface-700 dark:text-surface-400 dark:hover:bg-amber-900/40 dark:hover:text-amber-400',
        )}
      >
        <ThumbsUp size={13} fill={liked ? 'currentColor' : 'none'} />
        {count}
      </button>
      {showPopup && (
        <div className="absolute bottom-full left-1/2 z-20 mb-1.5 -translate-x-1/2 w-48 rounded-xl bg-white px-1 py-1.5 shadow-xl ring-1 ring-surface-200 dark:bg-surface-800 dark:ring-surface-700">
          <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-surface-600">
            Gefällt {count} {count === 1 ? 'Person' : 'Personen'}
          </div>
          {loadingLikers ? (
            <div className="flex justify-center py-2"><Loader2 size={14} className="animate-spin text-primary-400" /></div>
          ) : likers && likers.length > 0 ? (
            <div className="max-h-32 overflow-y-auto">
              {likers.map((l, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg px-2 py-1">
                  <Avatar name={l.name} image={l.image} size="xs" />
                  <span className="truncate text-xs text-surface-700 dark:text-surface-400">{l.name}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-2 py-1 text-xs text-surface-600">{likeError || 'Keine Daten'}</div>
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
          api.getCompanies(),
          api.getConversations(),
        ]);
        const all: typeof targets = [];
        // Load channels
        if (companies.length > 0) {
          const chans = await api.getChannels(String(companies[0].id));
          for (const ch of chans) {
            all.push({ id: String(ch.id), name: String(ch.name ?? ''), type: 'channel', image: ch.image ? String(ch.image) : undefined });
          }
        }
        // Conversations
        for (const c of convos) {
          const members = c.members;
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
      const fileIds = message.files?.map((f) => String(f.id)).filter(Boolean);
      const opts: { is_forwarded?: boolean; files?: string[] } = { is_forwarded: true };
      if (fileIds && fileIds.length > 0) {
        opts.files = fileIds;
      }
      await api.sendMessage(target.id, target.type, text, opts);
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
          <button onClick={onClose} className="rounded-lg p-1.5 text-surface-600 hover:bg-surface-200 dark:hover:bg-surface-800">
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
            <Search size={14} className="shrink-0 text-surface-600" />
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Channel oder Konversation suchen..."
              autoFocus
              className="w-full bg-transparent text-sm text-surface-900 outline-none placeholder:text-surface-600 dark:text-white"
            />
          </div>
        </div>

        {/* Target list */}
        <div className="max-h-64 overflow-y-auto px-3 py-2">
          {loading ? (
            <div className="flex justify-center py-6"><Loader2 size={20} className="animate-spin text-primary-400" /></div>
          ) : filtered.length === 0 ? (
            <p className="py-4 text-center text-xs text-surface-600">Keine Ziele gefunden</p>
          ) : (
            filtered.map((t) => (
              <button
                key={`${t.type}-${t.id}`}
                onClick={() => handleForward(t)}
                disabled={forwarding === t.id}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 hover:bg-surface-200 disabled:opacity-50 dark:hover:bg-surface-800"
              >
                {t.type === 'channel' ? (
                  t.image ? <Avatar name={t.name} image={t.image} size="xs" /> : <Hash size={14} className="shrink-0 text-surface-600" />
                ) : (
                  <Avatar name={t.name} size="xs" />
                )}
                <span className="min-w-0 flex-1 truncate text-left text-sm text-surface-800 dark:text-surface-200">{t.name}</span>
                <span className="shrink-0 text-[10px] uppercase text-surface-600">{t.type === 'channel' ? 'Channel' : 'Chat'}</span>
                {forwarding === t.id && <Loader2 size={14} className="shrink-0 animate-spin text-primary-400" />}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
