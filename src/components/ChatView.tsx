import React, { useState, useEffect, useRef, useCallback, type ReactNode } from 'react';
import { Hash, Users, FolderOpen, ArrowDown, Loader2, Trash2, Copy, ThumbsUp, X, ExternalLink, FileText, Pencil, Forward, Search, Reply, Check, CheckCheck, Clock, Video, CalendarDays, ArrowLeft, GraduationCap, Bookmark, Phone, TvMinimalPlay, Cloud, BookOpen, Eye, Star, Bell, BellOff, ChevronDown, MoreHorizontal } from 'lucide-react';
import { clsx } from 'clsx';
import * as api from '../api';
import { useAuth } from '../context/AuthContext';
import { useSettings } from '../context/SettingsContext';
import { useTheme } from '../context/ThemeContext';
import { useConfirm } from '../context/ConfirmContext';
import { useAnnouncer } from '../context/AnnouncerContext';
import { useRealtimeEvents } from '../hooks/useRealtimeEvents';
import { fileIcon } from '../utils/fileIcon';
import Avatar from './Avatar';
import MessageInput from './MessageInput';
import ChannelMembersPanel from './ChannelMembersPanel';
import ChannelDropdownMenu from './ChannelDropdownMenu';
import MarkdownContent from './MarkdownContent';
import ChannelDescriptionEditor from './ChannelDescriptionEditor';
import ChannelImageEditor from './ChannelImageEditor';
import CreatePollModal from './CreatePollModal';
import CreateEventModal from './CreateEventModal';
import CreateWhiteboardModal from './CreateWhiteboardModal';
import CreateNCDocumentModal from './CreateNCDocumentModal';
import NCShareChoiceModal from './NCShareChoiceModal';
import type { ChatTarget, Message } from '../types';
import type { CallParty } from '../api/calls';

interface ChatViewProps {
  chat: ChatTarget;
  onGoHome: () => void;
  onToggleFileBrowser: () => void;
  fileBrowserOpen: boolean;
  onOpenPolls?: () => void;
  onOpenPoll?: (pollId: string) => void;
  onOpenCalendar?: () => void;
  onOpenEvent?: (eventId: string) => void;
  onMarkRead?: (chatId: string, chatType: 'channel' | 'conversation') => void;
  onToggleFlagged?: () => void;
  flaggedOpen?: boolean;
  jumpToMessageId?: string | null;
  jumpToMessageTime?: number | null;
  jumpKey?: number;
  onJumpComplete?: () => void;
  onStartCall?: (calleeId: string, targetId: string, callee: CallParty) => void;
  onToggleFavorite?: (chat: ChatTarget) => void;
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
  type: 'moodle' | 'bbb' | 'taskcards' | 'nextcloud' | 'onenote' | 'link';
  url: string;
  label: string;
}

const EMOJI_TO_TYPE: Partial<Record<string, ExternalServiceLink['type']>> = {
  '📹': 'bbb',
  '📚': 'moodle',
  '📌': 'taskcards',
  '📝': 'nextcloud',
  '📊': 'nextcloud',
  '📓': 'onenote',
  '📂': 'nextcloud',
  '🔗': 'link',
};

const SERVICE_LINK_DEFAULTS: Record<ExternalServiceLink['type'], string> = {
  moodle: 'Moodle',
  bbb: 'BBB',
  taskcards: 'TaskCards',
  nextcloud: 'Nextcloud',
  onenote: 'OneNote',
  link: 'Link',
};

function detectLinkType(url: string, emoji?: string): ExternalServiceLink['type'] {
  if (emoji) {
    const fromEmoji = EMOJI_TO_TYPE[emoji];
    if (fromEmoji) return fromEmoji;
  }
  if (/moodle\.bbz|portal\.bbz/i.test(url)) return 'moodle';
  if (/bbb\.bbz/i.test(url)) return 'bbb';
  if (/taskcards/i.test(url)) return 'taskcards';
  if (/cloud\.bbz/i.test(url)) return 'nextcloud';
  if (/onenote\.com/i.test(url)) return 'onenote';
  return 'link';
}

/** Extract service links from description and return cleaned text + link objects. */
function extractServiceLinks(description: string): { cleanDescription: string; links: ExternalServiceLink[] } {
  const links: ExternalServiceLink[] = [];
  const removedLines = new Set<string>();

  for (const line of description.split('\n')) {
    // Emoji-prefixed link lines (e.g. "📹 BBB: https://..." or "📹 https://...")
    const emojiMatch = line.match(/^([^\w\s])\s*(?:(?!https?:\/\/)([^:]+?):\s*)?(https?:\/\/\S+)\s*$/u);
    if (emojiMatch) {
      const [, emoji, rawLabel, url] = emojiMatch;
      links.push({
        type: detectLinkType(url, emoji),
        url,
        label: rawLabel?.replace(/:?\s*$/, '').trim() ?? '',
      });
      removedLines.add(line);
      continue;
    }
    // Legacy: bare known-domain URLs without emoji prefix (backward compat)
    const LEGACY_PATTERNS: [RegExp, ExternalServiceLink['type']][] = [
      [/https?:\/\/moodle\.bbz[^\s)]*/gi, 'moodle'],
      [/https?:\/\/portal\.bbz[^\s)]*/gi, 'moodle'],
      [/https?:\/\/bbb\.bbz[^\s)]*/gi, 'bbb'],
      [/https?:\/\/bbzrdeck\.taskcards[^\s)]*/gi, 'taskcards'],
    ];
    let legacyMatched = false;
    for (const [regex, type] of LEGACY_PATTERNS) {
      let m: RegExpExecArray | null;
      while ((m = regex.exec(line)) !== null) {
        links.push({ type, url: m[0], label: '' });
        legacyMatched = true;
      }
    }
    if (legacyMatched) removedLines.add(line);
  }

  const cleanDescription = description
    .split('\n')
    .filter(line => !removedLines.has(line))
    .join('\n')
    .replace(/\n{2,}/g, '\n')
    .trim();

  return { cleanDescription, links };
}

interface PendingMessage { text: string; replyTo: Message | null; time: number }

export default function ChatView({ chat, onGoHome, onToggleFileBrowser, fileBrowserOpen, onOpenPolls, onOpenPoll, onOpenCalendar, onOpenEvent, onToggleFlagged, flaggedOpen, jumpToMessageId, jumpToMessageTime, jumpKey, onJumpComplete, onStartCall, onToggleFavorite }: ChatViewProps) {
  const { user } = useAuth();
  const settings = useSettings();
  const { theme } = useTheme();
  const confirmAsync = useConfirm();
  const announce = useAnnouncer();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const [isManager, setIsManager] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [fileSentToast, setFileSentToast] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState<File[]>([]);
  const [ncShareChoice, setNcShareChoice] = useState<{ path: string; file?: File } | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [pdfView, setPdfView] = useState<{ fileId: string; viewUrl: string; name: string } | null>(null);
  const [descEditorOpen, setDescEditorOpen] = useState(false);
  const [chatDescription, setChatDescription] = useState(chat.description || '');
  const [chatImage, setChatImage] = useState(chat.image || '');
  const [imageEditorOpen, setImageEditorOpen] = useState(false);
  const [forwardMsg, setForwardMsg] = useState<Message | null>(null);
  const [meetingLoading, setMeetingLoading] = useState(false);
  const [notificationsMuted, setNotificationsMuted] = useState(chat.muted === true);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [muteMenuOpen, setMuteMenuOpen] = useState(false);

  const [showPollModal, setShowPollModal] = useState(false);
  const [showEventModal, setShowEventModal] = useState(false);
  const [showWhiteboardModal, setShowWhiteboardModal] = useState(false);
  const [showNCDocumentModal, setShowNCDocumentModal] = useState(false);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
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
  const announceRef = useRef(announce);
  announceRef.current = announce;
  const paginationOffsetRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const hasMoreRef = useRef(true);

  // Track messages that are currently being sent (between sendMessage and SSE delivery).
  // Each entry is pure UI state — never inserted into messages[]. This prevents duplicates.
  const [pendingMessages, setPendingMessages] = useState<PendingMessage[]>([]);
  const pendingMessagesRef = useRef<Map<string, PendingMessage>>(new Map());

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
  // Sync muted state when chat changes
  useEffect(() => {
    setNotificationsMuted(chat.muted === true);
  }, [chat.muted, chat.id]);

  // Sync chat image when channel changes
  useEffect(() => {
    setChatImage(chat.image || '');
  }, [chat.image, chat.id]);

  // Clear pending message indicators when switching chats
  useEffect(() => {
    pendingMessagesRef.current.clear();
    setPendingMessages([]);
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
      // Update user name cache from loaded messages
      for (const m of msgs) {
        if (m.sender?.id && m.sender?.first_name) {
          userNameCacheRef.current.set(
            Number(m.sender.id),
            `${m.sender.first_name} ${m.sender.last_name ?? ''}`.trim()
          );
        }
      }
      if (msgs.length < PAGE_SIZE) {
        setHasMore(false);
        hasMoreRef.current = false;
      }
      paginationOffsetRef.current = msgs.length;
      // Mark latest message as read
      const last = msgs[msgs.length - 1];
      if (last) api.markAsRead(chat.id, chat.type, String(last.id)).catch(() => {});
    } catch {
      // errors are silently ignored
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
        // Update user name cache
        for (const m of older) {
          if (m.sender?.id && m.sender?.first_name) {
            userNameCacheRef.current.set(
              Number(m.sender.id),
              `${m.sender.first_name} ${m.sender.last_name ?? ''}`.trim()
            );
          }
        }
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
    setViewingJumpedMessage(false);
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

  // Scroll to bottom after initial load and after chat switch.
  // Staggered re-scrolls catch layout shifts from lazy-loaded images and
  // link previews that increase the container's scroll height after the
  // initial paint.
  useEffect(() => {
    if (!loading && containerRef.current) {
      const container = containerRef.current;
      const scrollToEnd = () => { container.scrollTop = container.scrollHeight; };
      scrollToEnd();
      const t1 = setTimeout(scrollToEnd, 100);
      const t2 = setTimeout(scrollToEnd, 400);
      const t3 = setTimeout(scrollToEnd, 1000);
      return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
    }
  }, [loading]);

  // Jump to specific message (from flagged messages panel)
  // Track whether we're viewing jumped-to results (separate from date search)
  const [viewingJumpedMessage, setViewingJumpedMessage] = useState(false);

  // Ref to block silentRefresh/handleMessageSync while viewing alternate messages
  const viewingAlternateRef = useRef(false);
  useEffect(() => {
    viewingAlternateRef.current = viewingJumpedMessage || viewingDateResults;
  }, [viewingJumpedMessage, viewingDateResults]);

  // Reset jump state when chat changes
  useEffect(() => {
    setViewingJumpedMessage(false);
  }, [chat.id]);

  const scrollAndHighlight = useCallback((el: HTMLElement) => {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('ring-2', 'ring-primary-400', 'rounded-xl');
    setTimeout(() => {
      el.classList.remove('ring-2', 'ring-primary-400', 'rounded-xl');
    }, 3000);
  }, []);

  // Refs for values needed inside the jump effect without triggering re-runs
  const jumpDepsRef = useRef({ messages, hasMore, jumpToMessageId, jumpToMessageTime });
  jumpDepsRef.current = { messages, hasMore, jumpToMessageId, jumpToMessageTime };

  // jumpKey changes on every click, guaranteeing the effect re-runs
  useEffect(() => {
    const { jumpToMessageId: targetId, jumpToMessageTime: targetTime } = jumpDepsRef.current;
    if (!targetId) return;
    if (loading) return;

    // Fast path: message is already in the current view
    const existingEl = document.getElementById(`msg-${targetId}`);
    if (existingEl) {
      scrollAndHighlight(existingEl);
      onJumpComplete?.();
      return;
    }

    if (!targetTime) { onJumpComplete?.(); return; }

    // Slow path: binary search by time to find the right offset, then load a window
    let cancelled = false;
    (async () => {
      try {
        // Phase 1: Probe offsets in steps of 500 to find the upper bound
        let upperBound = 0;
        const PROBE_STEP = 500;
        for (let probe = PROBE_STEP; probe <= 50000; probe += PROBE_STEP) {
          if (cancelled) return;
          const res = await api.getMessages(chat.id, chat.type, 1, probe);
          const msgs = res as unknown as Message[];
          if (msgs.length === 0) { upperBound = probe; break; }
          const t = Number(msgs[0].time) || 0;
          if (t <= targetTime) { upperBound = probe; break; }
          upperBound = probe + PROBE_STEP;
        }
        if (cancelled) return;

        // Phase 2: Binary search within [0, upperBound] to find offset near targetTime
        let low = 0;
        let high = upperBound;
        while (high - low > PAGE_SIZE) {
          if (cancelled) return;
          const mid = Math.floor((low + high) / 2);
          const res = await api.getMessages(chat.id, chat.type, 1, mid);
          const msgs = res as unknown as Message[];
          if (msgs.length === 0) { high = mid; continue; }
          const t = Number(msgs[0].time) || 0;
          if (t > targetTime) { low = mid; } else { high = mid; }
        }
        if (cancelled) return;

        // Phase 3: Load a window of messages around the found offset
        const loadOffset = Math.max(0, low - PAGE_SIZE);
        const res = await api.getMessages(chat.id, chat.type, PAGE_SIZE * 3, loadOffset);
        if (cancelled) return;
        const windowMsgs = (res as unknown as Message[]).sort(
          (a, b) => (Number(a.time) || 0) - (Number(b.time) || 0),
        );

        if (!windowMsgs.some((m) => String(m.id) === targetId)) return;

        if (!savedMessagesRef.current) {
          const snap = jumpDepsRef.current;
          savedMessagesRef.current = {
            messages: snap.messages,
            hasMore: snap.hasMore,
            offset: paginationOffsetRef.current,
          };
        }
        setMessages(windowMsgs);
        setHasMore(false);
        hasMoreRef.current = false;
        setViewingJumpedMessage(true);

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            if (cancelled) return;
            const el = document.getElementById(`msg-${targetId}`);
            if (el) scrollAndHighlight(el);
          });
        });
      } catch {
        // silently fail — user can retry
      } finally {
        if (!cancelled) onJumpComplete?.();
      }
    })();

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jumpKey, loading, chat.id, chat.type, scrollAndHighlight, onJumpComplete]);

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
                  // Remove the "NEU" divider — all visible messages have been read
                  setFirstUnreadMsgId(null);
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
      // Cancel in-flight 3s timers so they don't fire against the next chat
      // (the separate unmount-only cleanup at line ~654 covers full unmount).
      markReadTimersRef.current.forEach((timer) => clearTimeout(timer));
      markReadTimersRef.current.clear();
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
    if (viewingAlternateRef.current) return;

    refreshingRef.current = true;
    try {
      const res = await api.getMessages(chat.id, chat.type, PAGE_SIZE, 0);
      const msgs = res as unknown as Message[];
      let hadNewOwnMessages = false;
      setMessages((prev) => {
        const prevMap = new Map(prev.map(m => [String(m.id), m]));
        let changed = false;

        for (const msg of msgs) {
          const id = String(msg.id);
          const existing = prevMap.get(id);
          if (!existing) {
            prevMap.set(id, msg);
            changed = true;
            if (String(msg.sender?.id) === userId) hadNewOwnMessages = true;
          } else if (
            existing.text !== msg.text ||
            existing.likes !== msg.likes ||
            existing.liked !== msg.liked ||
            existing.deleted !== msg.deleted ||
            existing.flagged !== msg.flagged ||
            existing.edited !== msg.edited
          ) {
            prevMap.set(id, { ...existing, ...msg });
            changed = true;
          }
        }

        if (!changed) return prev;

        const merged = Array.from(prevMap.values()).sort((a, b) => (Number(a.time) || 0) - (Number(b.time) || 0));
        for (const m of merged) {
          if (m.sender?.id && m.sender?.first_name) {
            userNameCacheRef.current.set(
              Number(m.sender.id),
              `${m.sender.first_name} ${m.sender.last_name ?? ''}`.trim()
            );
          }
        }
        const last = merged[merged.length - 1];
        if (last && String(last.sender?.id) !== userId) {
          api.markAsRead(chat.id, chat.type, String(last.id)).catch(() => {});
        }
        return merged;
      });
      // Clear pending bubbles when our own messages arrived via REST
      if (hadNewOwnMessages && pendingMessagesRef.current.size > 0) {
        const ownMsgs = msgs.filter(m => String(m.sender?.id) === userId);
        for (const msg of ownMsgs) {
          const text = String(msg.text ?? '');
          for (const [key, pm] of pendingMessagesRef.current) {
            if (text && pm.text === text) {
              pendingMessagesRef.current.delete(key);
              break;
            }
          }
        }
        setPendingMessages([...pendingMessagesRef.current.values()]);
      }
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

  // Periodic polling fallback: every 5 seconds, silently check for new
  // messages when the tab is visible. This catches messages that were
  // silently dropped by SSE (browser may drop events while keeping the
  // connection technically "open" with heartbeats still arriving).
  // Short interval ensures the message appears quickly if SSE misses it,
  // keeping it in sync with the sidebar badge which can update via API poll.
  // silentRefresh is a no-op when no new messages are found, so overhead is low.
  useEffect(() => {
    const POLL_INTERVAL = 5_000;
    // Add random jitter (0–2 s) to prevent thundering-herd when many tabs are open
    const jitter = Math.random() * 2_000;
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
    if (viewingAlternateRef.current) return;

    const newMsg = payload as unknown as Message;

    // If this is our own message arriving via SSE, clear the matching pending bubble
    const senderId = String(((newMsg.sender as unknown) as Record<string, unknown>)?.id ?? '');
    if (senderId === userId && pendingMessagesRef.current.size > 0) {
      const text = String(newMsg.text ?? '');
      let matched = false;
      // Try exact text match first
      for (const [key, pm] of pendingMessagesRef.current) {
        if (text && pm.text === text) {
          pendingMessagesRef.current.delete(key);
          matched = true;
          break;
        }
      }
      // No exact match — remove the oldest pending entry (handles formatting diffs)
      if (!matched) {
        const firstKey = pendingMessagesRef.current.keys().next().value;
        if (firstKey !== undefined) pendingMessagesRef.current.delete(firstKey);
      }
      setPendingMessages([...pendingMessagesRef.current.values()]);
    }

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

      // Announce only foreign incoming messages (own ones are announced by handleSend)
      if (senderId && senderId !== userId) {
        const senderObj = newMsg.sender as { first_name?: string; last_name?: string } | undefined;
        const name = senderObj
          ? `${senderObj.first_name ?? ''} ${senderObj.last_name ?? ''}`.trim() || 'Unbekannt'
          : 'Unbekannt';
        announceRef.current(`Neue Nachricht von ${name}`);
      }
      // No match — new message, just add it
      return [...prev, newMsg].sort((a, b) => (Number(a.time) || 0) - (Number(b.time) || 0));
    });
    // Always scroll to bottom when a new message arrives in the open chat
    requestAnimationFrame(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Cache for user names: userId -> full name
  const userNameCacheRef = useRef<Map<number, string>>(new Map());

  const handleTypingEvent = useCallback((data: unknown) => {
    const { chatType, chatId, userId: typingUserId } = data as { chatType: string; chatId: number; userId: number };
    const currentChat = chatRef.current;
    if (
      chatType !== currentChat.type ||
      String(chatId) !== currentChat.id ||
      String(typingUserId) === userId
    ) return;
    // Try to get the user's name from the cache
    const name = userNameCacheRef.current.get(typingUserId);
    setTypingUsers((prev) => {
      const filtered = prev.filter((t) => t.userId !== typingUserId);
      return [...filtered, { userId: typingUserId, name, at: Date.now() }];
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
    if (!await confirmAsync('Nachricht wirklich löschen?')) return;
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
    const pendingReply = replyTo;
    setReplyTo(null);
    requestAnimationFrame(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }));

    // Show an optimistic bubble immediately. This is pure UI state — never
    // inserted into messages[], so it cannot cause duplicates.
    const pendingKey = `p-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const pending: PendingMessage = { text, replyTo: pendingReply, time: Date.now() / 1000 };
    pendingMessagesRef.current.set(pendingKey, pending);
    setPendingMessages([...pendingMessagesRef.current.values()]);

    // Three-tier fallback: proactive silentRefresh if SSE is slow/broken
    const stillPending = () => pendingMessagesRef.current.has(pendingKey);
    const fastFallbackId = setTimeout(() => { if (stillPending()) silentRefreshRef.current(); }, 2_000);
    const midFallbackId = setTimeout(() => { if (stillPending()) silentRefreshRef.current(); }, 5_000);
    const hardTimeoutId = setTimeout(() => {
      if (stillPending()) {
        pendingMessagesRef.current.delete(pendingKey);
        setPendingMessages([...pendingMessagesRef.current.values()]);
        silentRefreshRef.current();
      }
    }, 10_000);

    try {
      await api.sendMessage(chat.id, chat.type, text, opts);
      announce('Nachricht gesendet');
    } catch {
      clearTimeout(fastFallbackId);
      clearTimeout(midFallbackId);
      clearTimeout(hardTimeoutId);
      pendingMessagesRef.current.delete(pendingKey);
      setPendingMessages([...pendingMessagesRef.current.values()]);
      setSendError('Nachricht konnte nicht gesendet werden.');
      setTimeout(() => setSendError(null), 5000);
    }
  };

  const handleUpload = async (file: File, text: string) => {
    await api.uploadFile(chat.type, chat.id, file, text);
    await loadMessages();
  };

  const handleCreateWhiteboard = useCallback(async (title: string) => {
    setShowWhiteboardModal(false);
    try {
      const roomBytes = window.crypto.getRandomValues(new Uint8Array(10));
      const room = Array.from(roomBytes).map((b) => b.toString(16).padStart(2, '0')).join('');
      const aesKey = await window.crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 128 },
        true,
        ['encrypt', 'decrypt'],
      );
      const jwk = await window.crypto.subtle.exportKey('jwk', aesKey);
      if (!jwk.k) throw new Error('Key export failed');
      const link = `https://excalidraw.com/#room=${room},${jwk.k}`;
      window.open(link, '_blank', 'noopener,noreferrer');
      const heading = title ? `## 🎨 ${title}` : '## 🎨 Kollaboratives Whiteboard';
      const text = [
        heading,
        '',
        'Ich habe ein neues **Excalidraw**-Whiteboard erstellt – klickt auf den Link, um gemeinsam zu zeichnen:',
        '',
        `🔗 **[Whiteboard öffnen](${link})**`,
      ].join('\n');
      await api.sendMessage(chat.id, chat.type, text);
    } catch {
      setSendError('Whiteboard konnte nicht erstellt werden.');
      setTimeout(() => setSendError(null), 5000);
    }
  }, [chat.id, chat.type]);

  const handleTyping = useCallback(() => {
    api.sendTyping(chat.type, chat.id).catch(() => {});
  }, [chat.type, chat.id]);

  // Build a map of message IDs for reply lookups
  const messageMap = new Map(messages.map((m) => [Number(m.id), m]));

  // Separate system messages from regular ones; group regular by sender
  // Poll invites and video meetings are always standalone (not grouped)
  const groups: Array<{ sender: Message['sender']; isOwn: boolean; messages: Message[]; isSystem?: boolean; isStandalone?: boolean }> = [];
  for (const msg of messages) {
    // Skip completely empty messages that have no visible content
    const hasVisibleContent = msg.text?.trim() || msg.files?.length || msg.deleted || msg.is_deleted_by_manager || msg.is_forwarded || msg.reply_to_id;
    const isSpecialKind = SYSTEM_KINDS.has(msg.kind ?? '') || isPollInviteMessage(msg) || isVideoMeetingMessage(msg) || isCalendarEventMessage(msg);
    if (!hasVisibleContent && !isSpecialKind) continue;
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
    <div className="flex h-full min-w-0 flex-1 overflow-hidden">
      {/* Main chat area */}
      <div
        className="relative flex min-w-0 flex-1 flex-col bg-[var(--theme-bg)]"
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={(e) => { if (e.currentTarget.contains(e.relatedTarget as Node)) return; setDragOver(false); }}
        onDrop={async (e) => {
          e.preventDefault();
          setDragOver(false);
          // Check for file-id from sidebar drag (forward existing file)
          const fileId = e.dataTransfer.getData('text/file-id');
          if (fileId) {
            // Nextcloud files have path-like IDs starting with "/"
            if (fileId.startsWith('/')) {
              // Show choice modal: public link vs. direct attach
              setNcShareChoice({ path: fileId });
              return;
            }
            try {
              await api.sendMessage(chat.id, chat.type, '', { files: [fileId] });
              await loadMessages();
              setFileSentToast(true);
              setTimeout(() => setFileSentToast(false), 2500);
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
      {/* File-sent toast */}
      {fileSentToast && (
        <div className="absolute bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-surface-800 px-4 py-2 text-sm text-white shadow-lg dark:bg-surface-700">
          Datei gesendet
        </div>
      )}
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
      <div className="relative flex shrink-0 items-center gap-3 overflow-visible border-b border-surface-200 px-4 py-3 sm:px-6 dark:border-surface-700">
        {/* Mobile: Back button */}
        <button
          onClick={onGoHome}
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-surface-600 hover:bg-surface-200 dark:text-surface-300 dark:hover:bg-surface-700 md:hidden"
          aria-label="Zurück zur Übersicht"
        >
          <ArrowLeft size={20} />
        </button>

        {chat.type === 'channel' ? (
          chatImage
            ? <Avatar name={chat.name} image={chatImage} size="md" />
            : <Hash size={22} className="text-surface-600" />
        ) : (
          <Avatar name={chat.name} image={chat.image} size="md" />
        )}
        <div className="min-w-0 flex-1">
          <div className="relative flex min-w-0 items-center gap-2">
            {/* Mobile: title opens menu, Desktop: just text */}
            <button
              onClick={() => setMobileMenuOpen((v) => !v)}
              className="flex min-w-0 items-center gap-1.5 text-left text-base font-semibold text-surface-900 dark:text-white md:cursor-default md:bg-transparent md:hover:bg-transparent"
              title="Menü öffnen"
            >
              <span className="min-w-0 truncate">{chat.name}</span>
              {/* Mobile: small chevron indicator */}
              <ChevronDown size={14} className="shrink-0 text-surface-400 md:hidden" />
            </button>
            {/* Favorite toggle — desktop only (mobile has it in the more menu) */}
            {onToggleFavorite && (
              <button
                onClick={() => onToggleFavorite(chat)}
                className={clsx(
                  'hidden shrink-0 rounded p-0.5 transition md:block',
                  chat.favorite
                    ? 'text-yellow-400 hover:text-yellow-500'
                    : 'text-surface-400 hover:bg-surface-200 hover:text-surface-600 dark:text-surface-500 dark:hover:bg-surface-800 dark:hover:text-surface-300',
                )}
                title={chat.favorite ? 'Favorit entfernen' : 'Als Favorit markieren'}
                aria-label={chat.favorite ? 'Favorit entfernen' : 'Als Favorit markieren'}
                aria-pressed={chat.favorite}
              >
                <Star size={14} className={chat.favorite ? 'fill-yellow-400' : ''} />
              </button>
            )}
            {/* Notifications bell — desktop only (mobile has it in the more menu) */}
            <button
              onClick={async () => {
                if (notificationsLoading) return;
                if (notificationsMuted) {
                  setNotificationsLoading(true);
                  try {
                    await api.setChannelNotifications(chat.id, true);
                    setNotificationsMuted(false);
                  } catch (err) {
                    console.error('Failed to enable notifications:', err);
                    alert(err instanceof Error ? err.message : 'Fehler beim Aktivieren der Benachrichtigungen');
                  } finally {
                    setNotificationsLoading(false);
                  }
                } else {
                  setMuteMenuOpen((v) => !v);
                }
              }}
              disabled={notificationsLoading}
              className={clsx(
                'hidden shrink-0 rounded p-0.5 transition md:block',
                notificationsLoading && 'opacity-50 cursor-not-allowed',
                notificationsMuted
                  ? 'text-surface-400 hover:bg-surface-200 hover:text-surface-600 dark:text-surface-500 dark:hover:bg-surface-800 dark:hover:text-surface-300'
                  : 'text-primary-500 hover:text-primary-600',
              )}
              title={notificationsMuted ? 'Benachrichtigungen aktivieren' : 'Benachrichtigungen stummschalten'}
              aria-label={notificationsMuted ? 'Benachrichtigungen aktivieren' : 'Benachrichtigungen stummschalten'}
            >
              {notificationsLoading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : notificationsMuted ? (
                <BellOff size={14} />
              ) : (
                <Bell size={14} />
              )}
            </button>
            {/* Desktop mute duration menu */}
            {muteMenuOpen && (
              <div className="absolute left-0 top-full z-50 mt-1 w-40 rounded-lg border border-surface-200 bg-white py-1 shadow-lg dark:border-surface-700 dark:bg-surface-800">
                {[
                  { label: '2 Stunden', duration: 7200 },
                  { label: '1 Tag', duration: 86400 },
                  { label: '7 Tage', duration: 604800 },
                  { label: 'Für immer', duration: 2147483647 },
                ].map((opt) => (
                  <button
                    key={opt.duration}
                    onClick={async () => {
                      setMuteMenuOpen(false);
                      setNotificationsLoading(true);
                      try {
                        await api.setChannelNotifications(chat.id, false, opt.duration);
                        setNotificationsMuted(true);
                      } catch (err) {
                        console.error('Failed to mute notifications:', err);
                        alert(err instanceof Error ? err.message : 'Fehler beim Stummschalten');
                      } finally {
                        setNotificationsLoading(false);
                      }
                    }}
                    className="block w-full px-3 py-1.5 text-left text-sm text-surface-700 transition hover:bg-surface-100 dark:text-surface-200 dark:hover:bg-surface-700"
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          {cleanDescription ? (
            <div className="flex items-center gap-1">
              <p className="min-w-0 truncate text-xs text-surface-600 dark:text-surface-300">
                <LinkifiedText text={cleanDescription} />
              </p>
              {isManager && chat.type === 'channel' && (
                <button
                  onClick={() => setDescEditorOpen(true)}
                  className="shrink-0 rounded p-0.5 text-surface-400 transition hover:bg-surface-200 hover:text-surface-600 dark:text-surface-300 dark:hover:bg-surface-800 dark:hover:text-surface-500"
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
        {/* Desktop: Action buttons inline */}
        <div className="hidden md:flex md:items-center md:gap-1">
          {/* Video meeting button */}
          <button
            onClick={async () => {
              if (meetingLoading) return;
              setMeetingLoading(true);
              const moderatorTab = window.open('', '_blank');
              if (moderatorTab) {
                moderatorTab.document.write(`<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><title>Videokonferenz wird geladen…</title><style>*{margin:0;padding:0;box-sizing:border-box}body{display:flex;align-items:center;justify-content:center;min-height:100vh;background:#1e293b;font-family:system-ui,sans-serif;color:#e2e8f0}.card{text-align:center;padding:2.5rem 3rem;background:#0f172a;border-radius:1.5rem;border:1px solid #334155;box-shadow:0 25px 50px #0006}.spinner{width:48px;height:48px;border:4px solid #334155;border-top-color:#6366f1;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 1.5rem}.emoji{font-size:3rem;margin-bottom:1rem}h1{font-size:1.25rem;font-weight:600;color:#f1f5f9;margin-bottom:.5rem}p{font-size:.9rem;color:#94a3b8}@keyframes spin{to{transform:rotate(360deg)}}</style></head><body><div class="card"><div class="emoji">📹</div><div class="spinner"></div><h1>Videokonferenz wird geladen…</h1><p>Bitte einen Moment warten.</p></div></body></html>`);
                moderatorTab.document.close();
              }
              try {
                const result = await api.startVideoMeeting(chat.id, chat.type);
                const tabLink = result.moderatorLink ?? result.inviteLink;
                if (tabLink && moderatorTab) {
                  moderatorTab.location.href = tabLink;
                } else if (moderatorTab) {
                  moderatorTab.close();
                }
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
                : 'text-surface-600 hover:bg-surface-200 dark:text-surface-300 dark:hover:bg-surface-800',
            )}
            title="Videokonferenz starten"
          >
            {meetingLoading ? <Loader2 size={20} className="animate-spin" /> : <TvMinimalPlay size={20} />}
          </button>
          {/* Audio call button — only for 1:1 conversations */}
          {chat.type === 'conversation' && chat.userId && onStartCall && (
            <button
              onClick={() => {
                const callee = {
                  id: chat.userId!,
                  first_name: chat.name.split(' ')[0] ?? chat.name,
                  last_name: chat.name.split(' ').slice(1).join(' '),
                  image: chat.image,
                };
                onStartCall(chat.userId!, chat.id, callee);
              }}
              className="rounded-lg p-2 text-surface-600 hover:bg-surface-200 dark:text-surface-300 dark:hover:bg-surface-800"
              title="Audioanruf starten"
            >
              <Phone size={20} />
            </button>
          )}
          {/* Service link buttons */}
          {serviceLinks.map((link, i) => (
            <a
              key={`${link.type}-${i}`}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              title={`${link.label || SERVICE_LINK_DEFAULTS[link.type]} öffnen`}
              className={clsx(
                'flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-white shadow-sm transition hover:opacity-90',
                link.type === 'moodle' && 'bg-orange-500 hover:bg-orange-600',
                link.type === 'bbb' && 'bg-blue-500 hover:bg-blue-600',
                link.type === 'taskcards' && 'bg-teal-500 hover:bg-teal-600',
                link.type === 'nextcloud' && 'bg-indigo-500 hover:bg-indigo-600',
                link.type === 'onenote' && 'bg-purple-500 hover:bg-purple-600',
                link.type === 'link' && 'bg-surface-600 hover:bg-surface-700',
              )}
            >
              {link.type === 'moodle' && <GraduationCap size={14} />}
              {link.type === 'bbb' && <Video size={14} />}
              {link.type === 'taskcards' && <span className="font-bold leading-none">T</span>}
              {link.type === 'nextcloud' && <Cloud size={14} />}
              {link.type === 'onenote' && <BookOpen size={14} />}
              {link.type === 'link' && <ExternalLink size={14} />}
              {link.label || SERVICE_LINK_DEFAULTS[link.type]}
            </a>
          ))}
          {chat.type === 'channel' && isManager && (
            <ChannelDropdownMenu
              chat={chat}
              isManager={isManager}
              onOpenMembers={() => setMembersOpen(true)}
              onOpenDescriptionEditor={() => setDescEditorOpen(true)}
              onOpenImageEditor={() => setImageEditorOpen(true)}
              onDeleted={onGoHome}
            />
          )}
          {chat.type === 'channel' && (
            <button
              onClick={() => setMembersOpen((o) => !o)}
              className={clsx(
                'rounded-lg p-2 transition',
                membersOpen
                  ? 'bg-primary-100 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400'
                  : 'text-surface-600 hover:bg-surface-200 dark:text-surface-300 dark:hover:bg-surface-800',
              )}
              title="Mitglieder"
            >
              <Users size={20} />
            </button>
          )}
        </div>

        {/* Desktop-only: File browser */}
        <button
          onClick={onToggleFileBrowser}
          className={clsx(
            'hidden rounded-lg p-2 transition md:inline-flex',
            fileBrowserOpen
              ? 'bg-primary-100 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400'
              : 'text-surface-600 hover:bg-surface-200 dark:text-surface-300 dark:hover:bg-surface-800',
          )}
          title="Dateiablage"
        >
          <FolderOpen size={20} />
        </button>
        {/* Desktop-only: Flagged */}
        {onToggleFlagged && (
          <button
            onClick={onToggleFlagged}
            className={clsx(
              'hidden rounded-lg p-2 transition md:inline-flex',
              flaggedOpen
                ? 'bg-primary-100 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400'
                : 'text-surface-600 hover:bg-surface-200 dark:text-surface-300 dark:hover:bg-surface-800',
            )}
            title="Markierte Nachrichten"
          >
            <Bookmark size={20} />
          </button>
        )}
        {/* Desktop-only: Search */}
        <button
          onClick={() => setSearchOpen((o) => !o)}
          className={clsx(
            'hidden rounded-lg p-2 transition md:inline-flex',
            searchOpen
              ? 'bg-primary-100 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400'
              : 'text-surface-600 hover:bg-surface-200 dark:text-surface-300 dark:hover:bg-surface-800',
          )}
          title="Suche (Ctrl+F)"
        >
          <Search size={20} />
        </button>

        {/* Mobile: More menu dropdown — opens from the title button */}
        {mobileMenuOpen && (
          <>
            <div className="pointer-events-none fixed inset-0 z-40 bg-black/50 md:hidden" onClick={() => { setMobileMenuOpen(false); setMuteMenuOpen(false); }} />
            <div className="pointer-events-auto fixed left-4 right-4 top-20 z-50 mx-auto w-full max-w-sm rounded-lg border border-surface-200 bg-white py-1 shadow-lg dark:border-surface-700 dark:bg-surface-800 md:hidden">
              {/* Favorite toggle */}
              {onToggleFavorite && (
                <button
                  onClick={() => { onToggleFavorite(chat); setMobileMenuOpen(false); }}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-surface-700 transition hover:bg-surface-100 dark:text-surface-200 dark:hover:bg-surface-700"
                >
                  <Star size={18} className={chat.favorite ? 'fill-yellow-400 text-yellow-400' : 'text-surface-400'} />
                  {chat.favorite ? 'Aus Favoriten entfernen' : 'Zu Favoriten hinzufügen'}
                </button>
              )}
              {/* Notifications */}
              <button
                onClick={async () => {
                  if (notificationsLoading) return;
                  if (notificationsMuted) {
                    setNotificationsLoading(true);
                    try {
                      await api.setChannelNotifications(chat.id, true);
                      setNotificationsMuted(false);
                    } catch (err) {
                      alert(err instanceof Error ? err.message : 'Fehler');
                    } finally {
                      setNotificationsLoading(false);
                    }
                  } else {
                    // Open mute options in a sub-menu
                    setMuteMenuOpen((v) => !v);
                  }
                }}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-surface-700 transition hover:bg-surface-100 dark:text-surface-200 dark:hover:bg-surface-700"
              >
                {notificationsLoading ? (
                  <Loader2 size={18} className="animate-spin text-surface-400" />
                ) : notificationsMuted ? (
                  <BellOff size={18} className="text-surface-400" />
                ) : (
                  <Bell size={18} className="text-primary-500" />
                )}
                {notificationsMuted ? 'Benachrichtigungen aktivieren' : 'Benachrichtigungen stummschalten'}
              </button>
              {/* Mute duration options — shown inline when not muted */}
              {!notificationsMuted && muteMenuOpen && (
                <div className="border-t border-surface-200 dark:border-surface-700">
                  {[2, 24, 168, -1].map((hours) => {
                    const label = hours === -1 ? 'Für immer' : hours === 1 ? '1 Stunde' : `${hours} Stunden`;
                    const duration = hours === -1 ? 2147483647 : hours * 3600;
                    return (
                      <button
                        key={hours}
                        onClick={async () => {
                          setMuteMenuOpen(false);
                          setMobileMenuOpen(false);
                          setNotificationsLoading(true);
                          try {
                            await api.setChannelNotifications(chat.id, false, duration);
                            setNotificationsMuted(true);
                          } catch (err) {
                            alert(err instanceof Error ? err.message : 'Fehler beim Stummschalten');
                          } finally {
                            setNotificationsLoading(false);
                          }
                        }}
                        className="flex w-full items-center gap-3 px-4 py-2 pl-10 text-left text-sm text-surface-600 transition hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-700"
                      >
                        {label}
                      </button>
                    );
                  })}
                </div>
              )}
              {/* Search */}
              <button
                onClick={() => { setSearchOpen((o) => !o); setMobileMenuOpen(false); }}
                className={clsx(
                  'flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition',
                  searchOpen
                    ? 'bg-primary-100 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400'
                    : 'text-surface-700 hover:bg-surface-100 dark:text-surface-200 dark:hover:bg-surface-700',
                )}
              >
                <Search size={18} className={searchOpen ? 'text-primary-500' : 'text-surface-400'} />
                Suche
              </button>
              {/* File browser */}
              <button
                onClick={() => { onToggleFileBrowser(); setMobileMenuOpen(false); }}
                className={clsx(
                  'flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition',
                  fileBrowserOpen
                    ? 'bg-primary-100 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400'
                    : 'text-surface-700 hover:bg-surface-100 dark:text-surface-200 dark:hover:bg-surface-700',
                )}
              >
                <FolderOpen size={18} className={fileBrowserOpen ? 'text-primary-500' : 'text-surface-400'} />
                Dateiablage
              </button>
              {/* Flagged messages */}
              {onToggleFlagged && (
                <button
                  onClick={() => { onToggleFlagged(); setMobileMenuOpen(false); }}
                  className={clsx(
                    'flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm transition',
                    flaggedOpen
                      ? 'bg-primary-100 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400'
                      : 'text-surface-700 hover:bg-surface-100 dark:text-surface-200 dark:hover:bg-surface-700',
                  )}
                >
                  <Bookmark size={18} className={flaggedOpen ? 'text-primary-500' : 'text-surface-400'} />
                  Markierte Nachrichten
                </button>
              )}
              {/* Video meeting */}
              <button
                onClick={async () => {
                  setMobileMenuOpen(false);
                  if (meetingLoading) return;
                  setMeetingLoading(true);
                  const moderatorTab = window.open('', '_blank');
                  if (moderatorTab) {
                    moderatorTab.document.write(`<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><title>Videokonferenz wird geladen…</title><style>*{margin:0;padding:0;box-sizing:border-box}body{display:flex;align-items:center;justify-content:center;min-height:100vh;background:#1e293b;font-family:system-ui,sans-serif;color:#e2e8f0}.card{text-align:center;padding:2.5rem 3rem;background:#0f172a;border-radius:1.5rem;border:1px solid #334155;box-shadow:0 25px 50px #0006}.spinner{width:48px;height:48px;border:4px solid #334155;border-top-color:#6366f1;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 1.5rem}.emoji{font-size:3rem;margin-bottom:1rem}h1{font-size:1.25rem;font-weight:600;color:#f1f5f9;margin-bottom:.5rem}p{font-size:.9rem;color:#94a3b8}@keyframes spin{to{transform:rotate(360deg)}}</style></head><body><div class="card"><div class="emoji">📹</div><div class="spinner"></div><h1>Videokonferenz wird geladen…</h1><p>Bitte einen Moment warten.</p></div></body></html>`);
                    moderatorTab.document.close();
                  }
                  try {
                    const result = await api.startVideoMeeting(chat.id, chat.type);
                    const tabLink = result.moderatorLink ?? result.inviteLink;
                    if (tabLink && moderatorTab) moderatorTab.location.href = tabLink;
                    else if (moderatorTab) moderatorTab.close();
                    if (result.inviteLink) {
                      const now = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
                      await api.sendMessage(chat.id, chat.type, `📹 Videokonferenz gestartet um ${now} Uhr\nJetzt beitreten: ${result.inviteLink}`);
                      await loadMessages();
                    }
                  } catch (err) {
                    moderatorTab?.close();
                    alert(err instanceof Error ? err.message : 'Fehler');
                  } finally {
                    setMeetingLoading(false);
                  }
                }}
                className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-surface-700 transition hover:bg-surface-100 dark:text-surface-200 dark:hover:bg-surface-700"
              >
                <TvMinimalPlay size={18} className="text-surface-400" />
                Videokonferenz starten
              </button>
              {/* Phone (conversations only) */}
              {chat.type === 'conversation' && chat.userId && onStartCall && (
                <button
                  onClick={() => {
                    setMobileMenuOpen(false);
                    const callee = {
                      id: chat.userId!,
                      first_name: chat.name.split(' ')[0] ?? chat.name,
                      last_name: chat.name.split(' ').slice(1).join(' '),
                      image: chat.image,
                    };
                    onStartCall(chat.userId!, chat.id, callee);
                  }}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-surface-700 transition hover:bg-surface-100 dark:text-surface-200 dark:hover:bg-surface-700"
                >
                  <Phone size={18} className="text-surface-400" />
                  Audioanruf starten
                </button>
              )}
              {/* Service links */}
              {serviceLinks.map((link, i) => (
                <a
                  key={`${link.type}-${i}`}
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 px-4 py-2.5 text-sm text-surface-700 transition hover:bg-surface-100 dark:text-surface-200 dark:hover:bg-surface-700"
                  onClick={() => setMobileMenuOpen(false)}
                >
                  {link.type === 'moodle' && <GraduationCap size={18} className="text-orange-500" />}
                  {link.type === 'bbb' && <Video size={18} className="text-blue-500" />}
                  {link.type === 'taskcards' && <span className="font-bold text-teal-500">T</span>}
                  {link.type === 'nextcloud' && <Cloud size={18} className="text-indigo-500" />}
                  {link.type === 'onenote' && <BookOpen size={18} className="text-purple-500" />}
                  {link.type === 'link' && <ExternalLink size={18} className="text-surface-400" />}
                  {link.label || SERVICE_LINK_DEFAULTS[link.type]}
                </a>
              ))}
              {/* Members (channels) */}
              {chat.type === 'channel' && (
                <button
                  onClick={() => { setMembersOpen(true); setMobileMenuOpen(false); }}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-surface-700 transition hover:bg-surface-100 dark:text-surface-200 dark:hover:bg-surface-700"
                >
                  <Users size={18} className="text-surface-400" />
                  Mitglieder
                </button>
              )}
              {/* Channel settings (managers) */}
              {chat.type === 'channel' && isManager && (
                <button
                  onClick={() => { setDescEditorOpen(true); setMobileMenuOpen(false); }}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm text-surface-700 transition hover:bg-surface-100 dark:text-surface-200 dark:hover:bg-surface-700"
                >
                  <Pencil size={18} className="text-surface-400" />
                  Kanal bearbeiten
                </button>
              )}
            </div>
          </>
        )}
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
                  ? (viewingDateResults || viewingJumpedMessage) ? 'Keine Treffer' : hasMore ? 'Keine Treffer (in geladenen Nachrichten)' : 'Keine Treffer'
                  : `${((searchMatchIdx % searchMatches.length) + searchMatches.length) % searchMatches.length + 1} / ${searchMatches.length}${!(viewingDateResults || viewingJumpedMessage) && hasMore ? ' (in geladenen Nachrichten)' : ''}`}
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

      {/* Jumped-to-message banner */}
      {viewingJumpedMessage && !viewingDateResults && (
        <div className="flex shrink-0 items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 dark:border-amber-800 dark:bg-amber-950/30">
          <Bookmark size={14} className="text-amber-500" fill="currentColor" />
          <span className="flex-1 text-xs text-amber-700 dark:text-amber-300">
            Markierte Nachricht — älterer Nachrichtenverlauf
          </span>
          <button
            onClick={restoreMessages}
            className="flex items-center gap-1 rounded bg-amber-500 px-3 py-1 text-xs font-medium text-white transition hover:bg-amber-600"
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
        className="relative min-w-0 flex-1 overflow-x-hidden overflow-y-auto px-4 py-4"
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
                    elements.push(<CalendarEventCard key={gi} msg={sysMsg} onOpenCalendar={onOpenCalendar} onOpenEvent={onOpenEvent} />);
                  } else {
                    elements.push(<SystemMessage key={gi} msg={sysMsg} />);
                  }
                } else if (group.messages.length === 1 && isPollInviteMessage(group.messages[0])) {
                  elements.push(<PollInviteMessage key={gi} msg={group.messages[0]} onOpenPolls={onOpenPolls} onOpenPoll={onOpenPoll} />);
                } else if (group.messages.length === 1 && isCalendarEventMessage(group.messages[0])) {
                  elements.push(<CalendarEventCard key={gi} msg={group.messages[0]} onOpenCalendar={onOpenCalendar} onOpenEvent={onOpenEvent} />);
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
                      otherBubbleColor={theme === 'dark' ? settings.otherBubbleColorDark : settings.otherBubbleColor}
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
                  elements.push(<CalendarEventCard key={msg.id} msg={msg} onOpenCalendar={onOpenCalendar} onOpenEvent={onOpenEvent} />);
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

        {/* Pending message bubbles — real-looking own-message bubbles with a clock icon */}
        {pendingMessages.map((pm, i) => (
          <div key={`pending-${i}`} className="flex flex-row-reverse gap-2">
            <div className="flex min-w-0 max-w-[75%] flex-col items-end gap-1">
              <div
                className="relative max-w-full rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed opacity-80"
                style={{ backgroundColor: settings.ownBubbleColor, color: '#fff' }}
              >
                {pm.replyTo && <ReplyQuote msg={pm.replyTo} isOwn />}
                <div className="overflow-x-auto">
                  <MarkdownContent content={pm.text} isOwn isEmojiOnly={false} />
                </div>
              </div>
              <span className="flex items-center gap-0.5 px-1 text-xs text-surface-600">
                <Clock size={12} className="text-surface-400" />
              </span>
            </div>
          </div>
        ))}

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
            ? typingUsers[0].name
              ? `${typingUsers[0].name} tippt…`
              : 'Jemand tippt…'
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
      <MessageInput onSend={handleSend} onUpload={handleUpload} onTyping={handleTyping} chatId={chat.id} chatName={chat.name} replyTo={replyTo} onCancelReply={() => setReplyTo(null)} onCreatePoll={() => setShowPollModal(true)} onCreateEvent={() => setShowEventModal(true)} onCreateWhiteboard={() => setShowWhiteboardModal(true)} onCreateNCDocument={() => setShowNCDocumentModal(true)} droppedFiles={droppedFiles} onDroppedFilesConsumed={() => setDroppedFiles([])} />
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
      {showWhiteboardModal && (
        <CreateWhiteboardModal
          onConfirm={handleCreateWhiteboard}
          onClose={() => setShowWhiteboardModal(false)}
        />
      )}
      {showNCDocumentModal && (
        <CreateNCDocumentModal
          chatId={chat.id}
          chatType={chat.type}
          onClose={() => setShowNCDocumentModal(false)}
          onCreated={() => setShowNCDocumentModal(false)}
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

    {/* Channel image editor */}
    {imageEditorOpen && chat.type === 'channel' && (
      <ChannelImageEditor
        chat={{ ...chat, image: chatImage }}
        onClose={() => setImageEditorOpen(false)}
        onSaved={(newImage) => setChatImage(newImage)}
      />
    )}

    {/* Forward dialog */}
    {forwardMsg && (
      <ForwardDialog
        message={forwardMsg}
        onClose={() => setForwardMsg(null)}
      />
    )}

    {/* Nextcloud file share choice */}
    {ncShareChoice && (
      <NCShareChoiceModal
        fileName={ncShareChoice.path.split('/').pop() || ncShareChoice.path}
        ncPath={ncShareChoice.path}
        file={ncShareChoice.file}
        chatId={chat.id}
        chatType={chat.type}
        onClose={() => setNcShareChoice(null)}
        onSent={async () => {
          await loadMessages();
          setFileSentToast(true);
          setTimeout(() => setFileSentToast(false), 2500);
        }}
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
  const { theme } = useTheme();
  const senderName = sender ? `${sender.first_name ?? ''} ${sender.last_name ?? ''}`.trim() || 'Unbekannt' : 'Unbekannt';
  const [mobileActionMsgId, setMobileActionMsgId] = useState<string | null>(null);

  return (
    <>
    {/* Backdrop: tap anywhere outside to close mobile action menu */}
    {mobileActionMsgId !== null && (
      <div className="fixed inset-0 z-[9] md:hidden" onClick={() => setMobileActionMsgId(null)} />
    )}
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
            : msg.text || (msg.encrypted ? '🔒 *Verschlüsselte Nachricht*' : '');
          const canDelete = isOwn || canDeleteAll;
          // Try msg.reply_to first, fall back to reply_to_id if available
          let replyTo: Message | undefined;
          if (msg.reply_to && msg.reply_to.message_id) {
            replyTo = messageMap.get(msg.reply_to.message_id);
          } else if (msg.reply_to_id) {
            // Server may only return reply_to_id without the full reply_to object
            replyTo = messageMap.get(Number(msg.reply_to_id));
          }
          // Check if this message is emoji-only (no files, no reply, no forward, only emoji text)
          const msgIsEmojiOnly = Boolean(
            msg.text && !msg.deleted && !msg.is_deleted_by_manager &&
            !msg.encrypted && !replyTo && !msg.is_forwarded &&
            !msg.files?.length && isOnlyEmoji(msg.text)
          );

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
              {/* Action buttons — above the bubble on desktop (hover), inline panel on mobile */}
              <div className={clsx(
                'absolute bottom-full mb-1 z-10 items-center gap-0.5 rounded-lg bg-white/90 p-1 shadow-sm ring-1 ring-surface-200 backdrop-blur dark:bg-surface-800/90 dark:ring-surface-700',
                isOwn ? 'right-0' : 'left-0',
                mobileActionMsgId === String(msg.id) ? 'flex' : 'hidden group-hover/msg:flex',
              )}>
                <button
                  onClick={() => onLike(String(msg.id), Boolean(msg.liked))}
                  title={msg.liked ? 'Like entfernen' : 'Gefällt mir'}
                  className={clsx(
                    'flex items-center justify-center rounded-md p-1.5 transition min-h-9 min-w-9 sm:min-h-7 sm:min-w-7 sm:p-1',
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
                  className="flex items-center justify-center rounded-md p-1.5 text-surface-600 hover:bg-surface-200 hover:text-primary-600 dark:hover:bg-surface-700 dark:hover:text-primary-400 transition min-h-9 min-w-9 sm:min-h-7 sm:min-w-7 sm:p-1"
                >
                  <Reply size={13} />
                </button>
                <button
                  onClick={() => { if (msg.text) navigator.clipboard.writeText(msg.text).catch(() => {}); }}
                  title="Kopieren"
                  className="flex items-center justify-center rounded-md p-1.5 text-surface-600 hover:bg-surface-200 hover:text-surface-700 dark:hover:bg-surface-700 dark:hover:text-surface-200 transition min-h-9 min-w-9 sm:min-h-7 sm:min-w-7 sm:p-1"
                >
                  <Copy size={13} />
                </button>
                <button
                  onClick={() => onForward(msg)}
                  title="Weiterleiten"
                  className="flex items-center justify-center rounded-md p-1.5 text-surface-600 hover:bg-surface-200 hover:text-surface-700 dark:hover:bg-surface-700 dark:hover:text-surface-200 transition min-h-9 min-w-9 sm:min-h-7 sm:min-w-7 sm:p-1"
                >
                  <Forward size={13} />
                </button>
                <button
                  onClick={() => onFlag(String(msg.id), Boolean(msg.flagged))}
                  title={msg.flagged ? 'Markierung entfernen' : 'Markieren'}
                  className={clsx(
                    'flex items-center justify-center rounded-md p-1.5 transition min-h-9 min-w-9 sm:min-h-7 sm:min-w-7 sm:p-1',
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
                    className="flex items-center justify-center rounded-md p-1.5 text-surface-600 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400 transition min-h-9 min-w-9 sm:min-h-7 sm:min-w-7 sm:p-1"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>

              {/* Bookmark indicator for flagged messages */}
              {msg.flagged && (
                <div className={clsx('flex items-center gap-1 text-amber-500 dark:text-amber-400', isOwn ? 'flex-row-reverse' : 'flex-row')}>
                  <Bookmark size={12} fill="currentColor" />
                  <span className="text-[10px] font-medium">Markiert</span>
                </div>
              )}

              {/* Bubble row: bubble + mobile ⋯ trigger */}
              <div className={clsx('flex items-end gap-1', isOwn ? 'flex-row-reverse' : 'flex-row')}>
                <div
                  className={clsx(
                    'relative max-w-full rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed select-text',
                    isOwn && !isFirst && 'rounded-tr-md',
                    isOwn && !isLast && 'rounded-br-md',
                    !isOwn && !isFirst && 'rounded-tl-md',
                    !isOwn && !isLast && 'rounded-bl-md',
                    msg.flagged && (isOwn ? 'ring-2 ring-amber-400/40 dark:ring-amber-500/30' : 'ring-2 ring-amber-400/40 dark:ring-amber-500/30'),
                  )}
                  style={{
                    backgroundColor: isOwn ? ownBubbleColor : otherBubbleColor,
                    color: isOwn || theme === 'dark' ? '#fff' : undefined,
                  }}
                >
                  {replyTo && <ReplyQuote msg={replyTo} isOwn={isOwn} />}
                  {msg.is_forwarded && (
                    <div className={clsx('mb-1 flex items-center gap-1 text-[11px] italic', isOwn ? 'text-primary-200' : 'text-surface-600')}>
                      <Forward size={10} /> Weitergeleitet
                    </div>
                  )}
                  {/* Scrollable content area for long text without spaces */}
                  <div className="min-w-0 overflow-x-auto">
                    {searchQuery && content.toLowerCase().includes(searchQuery.toLowerCase())
                      ? <p className="whitespace-pre-wrap break-words"><HighlightedText text={content} query={searchQuery} /></p>
                      : <MarkdownContent content={content} isOwn={isOwn} isEmojiOnly={msgIsEmojiOnly} />}
                    <FileList files={msg.files} isOwn={isOwn} showImagesInline={showImagesInline} onImageClick={onImageClick} onPdfClick={onPdfClick} />
                  </div>
                </div>
                {/* Mobile-only ⋯ button — toggles action panel */}
                <button
                  className="relative z-10 flex shrink-0 items-center justify-center rounded-full p-2 text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 md:hidden"
                  onClick={() => setMobileActionMsgId(mobileActionMsgId === String(msg.id) ? null : String(msg.id))}
                  aria-label="Nachrichtenaktionen"
                >
                  <MoreHorizontal size={16} />
                </button>
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
    </>
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
  const senderName = msg.sender ? `${msg.sender.first_name ?? ''} ${msg.sender.last_name ?? ''}`.trim() || 'Unbekannt' : 'Unbekannt';
  const timeDate = msg.time ? new Date(msg.time * 1000) : null;
  const time = timeDate ? timeDate.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '';
  const isToday = timeDate ? msgDayKey(msg.time!) === msgDayKey(Date.now() / 1000) : true;
  const timeDisplay = (!isToday && timeDate)
    ? timeDate.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) + ' · ' + time
    : time;
  const content = msg.deleted || msg.is_deleted_by_manager
    ? 'Nachricht wurde gelöscht'
    : msg.text || (msg.encrypted ? '🔒 Verschlüsselte Nachricht' : '');
  // Try msg.reply_to first, fall back to reply_to_id if available
  let replyTo: Message | undefined;
  if (msg.reply_to && msg.reply_to.message_id) {
    replyTo = messageMap.get(msg.reply_to.message_id);
  } else if (msg.reply_to_id) {
    replyTo = messageMap.get(Number(msg.reply_to_id));
  }
  // Check if this message is emoji-only (no files, no reply, no forward, only emoji text)
  const msgIsEmojiOnly = Boolean(
    msg.text && !msg.deleted && !msg.is_deleted_by_manager &&
    !msg.encrypted && !replyTo && !msg.is_forwarded &&
    !msg.files?.length && isOnlyEmoji(msg.text)
  );
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);

  return (
    <>
    {mobileActionsOpen && <div className="fixed inset-0 z-[9] md:hidden" onClick={() => setMobileActionsOpen(false)} />}
    <div className="group/msg flex gap-3 px-2 py-2 hover:bg-surface-50 dark:hover:bg-surface-900/50">
      <Avatar name={senderName} image={msg.sender?.image} size="sm" />
      <div className="min-w-0 flex-1 select-text">
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
        <div className="min-w-0 overflow-x-auto">
          <div className={clsx('text-sm text-surface-800 dark:text-surface-200', msgIsEmojiOnly && 'text-5xl leading-tight')}>
            {searchQuery && content.toLowerCase().includes(searchQuery.toLowerCase())
              ? <p className="whitespace-pre-wrap break-words"><HighlightedText text={content} query={searchQuery} /></p>
              : <MarkdownContent content={content} isOwn={false} isEmojiOnly={msgIsEmojiOnly} />}
          </div>
          <FileList files={msg.files} isOwn={false} showImagesInline={showImagesInline} onImageClick={onImageClick} onPdfClick={onPdfClick} />
        </div>
      </div>
      {/* Desktop: hover-revealed action panel */}
      <div className="hidden shrink-0 items-center gap-0.5 group-hover/msg:flex">
        <button onClick={() => onLike(String(msg.id), Boolean(msg.liked))} title={msg.liked ? 'Like entfernen' : 'Gefällt mir'}
          className={clsx('flex items-center justify-center rounded-md p-1 transition', msg.liked ? 'text-amber-500' : 'text-surface-600 hover:bg-surface-200 hover:text-amber-500 dark:hover:bg-surface-700')}>
          <ThumbsUp size={13} />
        </button>
        <button onClick={() => onReply(msg)} title="Antworten" className="flex items-center justify-center rounded-md p-1 text-surface-600 hover:bg-surface-200 hover:text-primary-600 dark:hover:bg-surface-700 dark:hover:text-primary-400 transition">
          <Reply size={13} />
        </button>
        <button onClick={() => { if (msg.text) navigator.clipboard.writeText(msg.text).catch(() => {}); }} title="Kopieren" className="flex items-center justify-center rounded-md p-1 text-surface-600 hover:bg-surface-200 dark:hover:bg-surface-700 transition">
          <Copy size={13} />
        </button>
        <button onClick={() => onForward(msg)} title="Weiterleiten" className="flex items-center justify-center rounded-md p-1 text-surface-600 hover:bg-surface-200 dark:hover:bg-surface-700 transition">
          <Forward size={13} />
        </button>
        <button onClick={() => onFlag(String(msg.id), Boolean(msg.flagged))} title={msg.flagged ? 'Markierung entfernen' : 'Markieren'}
          className={clsx('flex items-center justify-center rounded-md p-1 transition', msg.flagged ? 'text-amber-500 dark:text-amber-400' : 'text-surface-600 hover:bg-surface-200 hover:text-amber-500 dark:hover:bg-surface-700 dark:hover:text-amber-400')}>
          <Bookmark size={13} fill={msg.flagged ? 'currentColor' : 'none'} />
        </button>
        {canDelete && (
          <button onClick={() => onDelete(String(msg.id))} title="Löschen" className="flex items-center justify-center rounded-md p-1 text-surface-600 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400 transition">
            <Trash2 size={13} />
          </button>
        )}
      </div>
      {/* Mobile: permanent ⋯ button + popup */}
      <div className="relative shrink-0 md:hidden">
        <button
          onClick={() => setMobileActionsOpen((v) => !v)}
          aria-label="Nachrichtenaktionen"
          className="flex h-9 w-9 items-center justify-center rounded-full text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700"
        >
          <MoreHorizontal size={16} />
        </button>
        {mobileActionsOpen && (
          <div className="absolute right-0 top-10 z-20 flex flex-col rounded-lg bg-white py-1 shadow-lg ring-1 ring-surface-200 dark:bg-surface-800 dark:ring-surface-700">
            <button onClick={() => { onLike(String(msg.id), Boolean(msg.liked)); setMobileActionsOpen(false); }} className={clsx('flex items-center gap-2 px-4 py-2.5 text-sm', msg.liked ? 'text-amber-500' : 'text-surface-700 dark:text-surface-300')}>
              <ThumbsUp size={15} /> {msg.liked ? 'Like entfernen' : 'Gefällt mir'}
            </button>
            <button onClick={() => { onReply(msg); setMobileActionsOpen(false); }} className="flex items-center gap-2 px-4 py-2.5 text-sm text-surface-700 dark:text-surface-300">
              <Reply size={15} /> Antworten
            </button>
            <button onClick={() => { if (msg.text) navigator.clipboard.writeText(msg.text).catch(() => {}); setMobileActionsOpen(false); }} className="flex items-center gap-2 px-4 py-2.5 text-sm text-surface-700 dark:text-surface-300">
              <Copy size={15} /> Kopieren
            </button>
            <button onClick={() => { onForward(msg); setMobileActionsOpen(false); }} className="flex items-center gap-2 px-4 py-2.5 text-sm text-surface-700 dark:text-surface-300">
              <Forward size={15} /> Weiterleiten
            </button>
            <button onClick={() => { onFlag(String(msg.id), Boolean(msg.flagged)); setMobileActionsOpen(false); }} className={clsx('flex items-center gap-2 px-4 py-2.5 text-sm', msg.flagged ? 'text-amber-500' : 'text-surface-700 dark:text-surface-300')}>
              <Bookmark size={15} fill={msg.flagged ? 'currentColor' : 'none'} /> {msg.flagged ? 'Markierung entfernen' : 'Markieren'}
            </button>
            {canDelete && (
              <button onClick={() => { onDelete(String(msg.id)); setMobileActionsOpen(false); }} className="flex items-center gap-2 px-4 py-2.5 text-sm text-red-600 dark:text-red-400">
                <Trash2 size={15} /> Löschen
              </button>
            )}
          </div>
        )}
      </div>
    </div>
    </>
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
  const senderName = msg.sender ? `${msg.sender.first_name ?? ''} ${msg.sender.last_name ?? ''}`.trim() || 'Jemand' : 'Jemand';
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

/** Extract event ID from message text format: [... [%event:ID%]] */
function extractEventId(msg: Message): string | undefined {
  const raw = msg as unknown as Record<string, unknown>;
  if (raw.event_id) return String(raw.event_id);
  if (raw.target_id) return String(raw.target_id);
  // Parse from text format: "[%event:ID%]"
  const match = (msg.text ?? '').match(/\[%event:([^%]+)%\]$/);
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

function CalendarEventCard({ msg, onOpenCalendar, onOpenEvent }: { msg: Message; onOpenCalendar?: () => void; onOpenEvent?: (eventId: string) => void }) {
  const time = msg.time
    ? new Date(msg.time * 1000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    : '';

  const eventId = extractEventId(msg);

  const handleClick = () => {
    if (eventId && onOpenEvent) {
      onOpenEvent(eventId);
    } else if (onOpenCalendar) {
      onOpenCalendar();
    }
  };

  return (
    <div className="flex justify-center py-2 px-4">
      <div className="rounded-xl bg-surface-700 px-5 py-3 text-center dark:bg-surface-800 max-w-xs shadow">
        <p className="text-sm text-surface-100 dark:text-surface-200 whitespace-pre-wrap">
          {renderEventText(msg.text ?? '')}
        </p>
        {(onOpenCalendar || onOpenEvent) && (
          <button
            onClick={handleClick}
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
  const senderName = msg.sender ? `${msg.sender.first_name ?? ''} ${msg.sender.last_name ?? ''}`.trim() || 'Jemand' : 'Jemand';
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
  const senderName = msg.sender ? `${msg.sender.first_name ?? ''} ${msg.sender.last_name ?? ''}`.trim() || 'Unbekannt' : 'Unbekannt';
  const isDeleted = msg.deleted || msg.is_deleted_by_manager;
  const text = isDeleted ? 'Nachricht wurde gelöscht' : (msg.text || '');
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
            <div className="flex flex-wrap items-center gap-1.5">
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
                <span className="max-w-[120px] truncate sm:max-w-[160px]">{f.name}</span>
                {f.size_string && <span className="hidden opacity-60 sm:inline">({f.size_string})</span>}
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
                  <FileText size={12} /> <span className="hidden sm:inline">Vorschau</span>
                </button>
              )}
              {api.canViewInOnlyOffice(f.name) && (
                <button
                  onClick={() => api.openInOnlyOffice(f.id, f.name)}
                  title="In OnlyOffice ansehen"
                  className={clsx(
                    'inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium transition',
                    isOwn
                      ? 'bg-primary-700 text-primary-100 hover:bg-primary-800'
                      : 'bg-surface-200 text-surface-600 hover:bg-surface-300 dark:bg-surface-700 dark:text-surface-400 dark:hover:bg-surface-600',
                  )}
                >
                  <Eye size={12} /> <span className="hidden sm:inline">Ansehen</span>
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

/** Returns true if the text consists solely of emoji characters (no letters, numbers, or punctuation) */
function isOnlyEmoji(text: string): boolean {
  if (!text || text.trim().length === 0) return false;
  // Remove common whitespace
  const trimmed = text.trim();
  // Emoji regex: matches Unicode emoji characters
  // This covers most emoji including skin tones, ZWJ sequences, and combined emoji
  const emojiRegex = /^[\u{1F300}-\u{1F9FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2300}-\u{23FF}\u{2B50}\u{1FA00}-\u{1FAFF}\u{231A}-\u{231B}\u{23E9}-\u{23F3}\u{23F8}-\u{23FA}\u{25AA}-\u{25AB}\u{25B6}\u{25C0}\u{25FB}-\u{25FE}\u{2614}-\u{2615}\u{2648}-\u{2653}\u{267F}\u{2693}\u{26A1}\u{26AA}-\u{26AB}\u{26BD}-\u{26BE}\u{26C4}-\u{26C5}\u{26CE}\u{26D4}\u{26EA}\u{26F2}-\u{26F3}\u{26F5}\u{26FA}\u{26FD}\u{2702}\u{2705}\u{2708}-\u{270D}\u{270F}\u{2712}\u{2714}\u{2716}\u{271D}\u{2721}\u{2728}\u{2733}-\u{2734}\u{2744}\u{2747}\u{274C}\u{274E}\u{2753}-\u{2755}\u{2757}\u{2763}-\u{2764}\u{2795}-\u{2797}\u{27A1}\u{27B0}\u{27BF}\u{2934}-\u{2935}\u{2B05}-\u{2B07}\u{2B1B}-\u{2B1C}\u{2B55}\u{3030}\u{303D}\u{3297}\u{3299}\u{1F004}\u{1F0CF}\u{1F170}-\u{1F171}\u{1F17E}-\u{1F17F}\u{1F18E}\u{1F191}-\u{1F19A}\u{1F201}-\u{1F202}\u{1F21A}\u{1F22F}\u{1F232}-\u{1F23A}\u{1F250}-\u{1F251}\u{1F300}-\u{1F320}\u{1F32D}-\u{1F335}\u{1F337}-\u{1F392}\u{1F393}\u{1F3A0}-\u{1F3C4}\u{1F3C6}-\u{1F3CA}\u{1F3CF}-\u{1F3D3}\u{1F3E0}-\u{1F3F0}\u{1F3F4}\u{1F3F8}-\u{1F43E}\u{1F440}\u{1F442}-\u{1F4FC}\u{1F4FF}\u{1F500}-\u{1F53D}\u{1F54A}-\u{1F54B}\u{1F54E}-\u{1F567}\u{1F5A4}-\u{1F5A5}\u{1F5FA}-\u{1F64F}\u{1F680}-\u{1F6C5}\u{1F6CB}-\u{1F6CF}\u{1F6D0}-\u{1F6D2}\u{1F6D5}-\u{1F6D7}\u{1F6EB}-\u{1F6EC}\u{1F6F4}-\u{1F6FC}\u{1F7E0}-\u{1F7EB}\u{1F90C}-\u{1F93A}\u{1F93C}-\u{1F945}\u{1F947}-\u{1F978}\u{1F97A}-\u{1F9CB}\u{1F9CD}-\u{1F9FF}\u{1FA70}-\u{1FA74}\u{1FA78}-\u{1FA7A}\u{1FA80}-\u{1FA86}\u{1FA90}-\u{1FAA8}\u{1FAB0}-\u{1FAB6}\u{1FAC0}-\u{1FAC2}\u{1FAD0}-\u{1FAD6}]+$/u;
  // Check if the trimmed text matches emoji-only pattern
  if (!emojiRegex.test(trimmed)) return false;
  // Additional check: ensure there are actual emoji (not just empty string)
  return trimmed.length > 0;
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
      setLikers(data.map((l) => ({ name: `${l.user.first_name ?? ''} ${l.user.last_name ?? ''}`.trim() || 'Unbekannt', image: l.user.image })));
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
            : 'bg-sky-100 text-sky-600 hover:bg-amber-100 hover:text-amber-600 dark:bg-sky-900/40 dark:text-sky-400 dark:hover:bg-amber-900/40 dark:hover:text-amber-400',
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
