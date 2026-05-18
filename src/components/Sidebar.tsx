import { useState, useEffect, useRef, useCallback, useMemo, type CSSProperties } from 'react';
import { Hash, Search, Users, GripHorizontal, Plus, X } from 'lucide-react';
import { clsx } from 'clsx';
import * as api from '../api';
import { useAuth } from '../context/AuthContext';
import { useRealtimeEvents } from '../hooks/useRealtimeEvents';
import { useFaviconBadge } from '../hooks/useFaviconBadge';
import { useNotifications } from '../hooks/useNotifications';
import { useLayoutMode } from '../hooks/useLayoutMode';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import { bridge } from '../lib/flutterBridge';
import ChatItem from './ChatItem';
import SidebarHeader from './SidebarHeader';
import SidebarFooter from './SidebarFooter';
import NewChannelModal from './NewChannelModal';
import NewChatModal from './NewChatModal';
import ChannelDiscoveryModal from './ChannelDiscoveryModal';
import type { ChatTarget } from '../types';
import { buildChannelTree, getCleanName, getParentId, type ChannelNode } from '../utils/subchannels';

// --- Sidebar SWR cache (stale-while-revalidate via localStorage) ---
const SIDEBAR_CACHE_KEY = 'schulchat_sidebar_cache';
const SIDEBAR_CACHE_MAX_AGE = 24 * 60 * 60 * 1000; // 24 h

interface SidebarCacheEntry {
  ts: number;
  channels: ChatTarget[];
  conversations: ChatTarget[];
  primaryCompanyId: string;
}

function loadSidebarCache(): Omit<SidebarCacheEntry, 'ts'> | null {
  try {
    const raw = localStorage.getItem(SIDEBAR_CACHE_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw) as SidebarCacheEntry;
    if (Date.now() - entry.ts > SIDEBAR_CACHE_MAX_AGE) return null;
    return { channels: entry.channels, conversations: entry.conversations, primaryCompanyId: entry.primaryCompanyId };
  } catch {
    return null;
  }
}

function saveSidebarCache(channels: ChatTarget[], conversations: ChatTarget[], primaryCompanyId: string) {
  try {
    const entry: SidebarCacheEntry = { ts: Date.now(), channels, conversations, primaryCompanyId };
    localStorage.setItem(SIDEBAR_CACHE_KEY, JSON.stringify(entry));
  } catch {
    // localStorage quota exceeded — ignore
  }
}

/** Sort: favorites first, non-favorites second. Within each group: by lastActivity desc. */
function sortChats(items: ChatTarget[]): ChatTarget[] {
  return [...items].sort((a, b) => {
    const af = a.favorite ? 1 : 0;
    const bf = b.favorite ? 1 : 0;
    if (bf !== af) return bf - af;
    return (b.lastActivity ?? 0) - (a.lastActivity ?? 0);
  });
}

interface SidebarProps {
  activeChat: ChatTarget | null;
  onSelectChat: (target: ChatTarget) => void;
  loggedIn: boolean;
  triggerFocusKey?: number;
  onChannelsLoaded?: (channels: ChatTarget[]) => void;
  onConversationsLoaded?: (conversations: ChatTarget[]) => void;
  onRegisterRefresh?: (refresh: () => void) => void;
  onRegisterToggleFavorite?: (toggle: (target: ChatTarget) => void) => void;
  onGoHome?: () => void;
  onUnreadChange?: (total: number, unreadChannels: ChatTarget[], unreadConversations: ChatTarget[]) => void;
}

export default function Sidebar({ activeChat, onSelectChat, loggedIn, triggerFocusKey, onChannelsLoaded, onConversationsLoaded, onRegisterRefresh, onRegisterToggleFavorite, onGoHome, onUnreadChange }: SidebarProps) {
  const { user } = useAuth();
  const { notify } = useNotifications();
  const [channels, setChannels] = useState<ChatTarget[]>([]);
  const [conversations, setConversations] = useState<ChatTarget[]>([]);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (triggerFocusKey === 0) return; // skip initial mount, only focus on explicit trigger
    // rAF: ensure focus call happens after any in-flight focus / render, so it sticks.
    const raf = requestAnimationFrame(() => {
      const el = searchRef.current;
      if (!el) return;
      el.focus();
      el.select();
    });
    return () => cancelAnimationFrame(raf);
  }, [triggerFocusKey]);

  const [showNewChannel, setShowNewChannel] = useState(false);
  const [newChannelParentId, setNewChannelParentId] = useState<string | undefined>(undefined);
  const [showNewChat, setShowNewChat] = useState(false);
  // Track first company ID for creating channels/chats
  const [primaryCompanyId, setPrimaryCompanyId] = useState<string>('');
  // Track previous unread counts for background poll notification detection.
  // null = initial load (don't notify), Map = populated (compare & notify).
  const prevUnreadsRef = useRef<Map<string, number> | null>(null);
  // Mirror of current state for async helpers (avoids stale closure).
  const channelsRef = useRef<ChatTarget[]>([]);
  const conversationsRef = useRef<ChatTarget[]>([]);
  // Zählt SSE-Increments seit der letzten erfolgreichen loadData()-Antwort.
  // loadData() nutzt diese Deltas, um Server-`unread`-Counts (die das Lesen
  // auf anderen Geräten widerspiegeln) durchzureichen, ohne lokal eingegangene
  // SSE-Increments während des Roundtrips zu verlieren.
  const sseDeltaRef = useRef<Map<string, number>>(new Map());

  // Sidebar width (horizontal resize)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('schulchat_sidebar_width');
    return saved ? Number(saved) : 280;
  });
  const sidebarWidthRef = useRef(sidebarWidth);
  const resizingWidth = useRef(false);

  const onWidthMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizingWidth.current = true;
    const startX = e.clientX;
    const startW = sidebarWidthRef.current;
    const onMove = (ev: MouseEvent) => {
      const newW = Math.max(200, Math.min(420, startW + ev.clientX - startX));
      setSidebarWidth(newW);
      sidebarWidthRef.current = newW;
    };
    const onUp = () => {
      resizingWidth.current = false;
      localStorage.setItem('schulchat_sidebar_width', String(sidebarWidthRef.current));
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  // Split ratio: percentage for channels panel (top), rest goes to conversations
  const [splitPct, setSplitPct] = useState(() => {
    const saved = localStorage.getItem('schulchat_sidebar_split');
    return saved ? Number(saved) : 50;
  });
  // Mobile-only tab state. WhatsApp-style: pick one of the two lists at a time.
  // Persisted per browser; default = direct messages (matches user request).
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [activeTab, setActiveTab] = useState<'channels' | 'direct'>(() => {
    const saved = localStorage.getItem('schulchat_sidebar_tab');
    return saved === 'channels' ? 'channels' : 'direct';
  });
  useEffect(() => {
    localStorage.setItem('schulchat_sidebar_tab', activeTab);
  }, [activeTab]);
  const layoutMode = useLayoutMode();
  const isPhone = layoutMode === 'mobile';
  const dragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeChatRef = useRef(activeChat);
  activeChatRef.current = activeChat;

  // Keep refs in sync with state so async helpers see current values
  channelsRef.current = channels;
  conversationsRef.current = conversations;

  useEffect(() => {
    // Preload from cache so the sidebar appears instantly, then fetch fresh data
    const cached = loadSidebarCache();
    if (cached) {
      channelsRef.current = cached.channels;
      conversationsRef.current = cached.conversations;
      setChannels(cached.channels);
      setConversations(cached.conversations);
      setPrimaryCompanyId(cached.primaryCompanyId);
      setInitialLoaded(true);
      onChannelsLoaded?.(cached.channels);
      onConversationsLoaded?.(cached.conversations);
    }
    (async () => { await loadData(); })();
    onRegisterRefresh?.(loadData);
    onRegisterToggleFavorite?.(handleToggleFavorite);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Pull-to-refresh — wird auf Desktop/Tablet automatisch no-op.
  // Eigene Instanz pro Tab-Liste; nur die sichtbare zieht.
  const channelsPullToRefresh = usePullToRefresh(async () => { await loadData(); });
  const directPullToRefresh = usePullToRefresh(async () => { await loadData(); });
  useEffect(() => { onChannelsLoaded?.(channels); }, [channels, onChannelsLoaded]);

  async function loadData() {
    try {
      // Snapshot der aktuellen SSE-Deltas: alles was BIS HIER reinkam, ist im
      // serverseitigen `unread` enthalten (bzw. wird es spätestens dann sein,
      // wenn der Server den Stream verarbeitet hat). Increments, die zwischen
      // Snapshot und API-Response noch eintreffen, addieren wir nach dem Merge
      // wieder hinzu — so geht währen des Roundtrips nichts verloren.
      const deltaSnapshot = new Map(sseDeltaRef.current);
      const [companies, convList] = await Promise.all([
        api.getCompanies(),
        api.getConversations(),
      ]);

      const allChannels: ChatTarget[] = [];
      let firstCompanyId = '';
      for (const company of companies) {
        const cid = String(company.id);
        if (!firstCompanyId) firstCompanyId = cid;
        const channelList = await api.getChannels(cid);
        for (const ch of channelList) {
          allChannels.push({
            type: 'channel',
            id: String(ch.id),
            name: ch.name || '',
            description: ch.description,
            image: ch.image,
            encrypted: Boolean(ch.encrypted),
            // Stashcat API: 'unread' (not 'unread_count') carries the actual count.
            // 'unread_count' is always 0. 'unread_messages' is a legacy fallback.
            unread_count: (ch as any).unread ?? ch.unread_count ?? 0,
            favorite: Boolean(ch.favorite),
            lastActivity: Number((ch as any).last_action || (ch as any).last_activity || 0),
            company_id: cid,
          });
        }
      }
      setPrimaryCompanyId(firstCompanyId);

      const userId = user?.id ?? '';
      const convTargets: ChatTarget[] = convList.map((c) => {
        const members = c.members || [];
        const otherMembers = members.filter((m) => String(m.id) !== userId);
        const name = otherMembers.length > 0
          ? otherMembers.map((m) => `${m.first_name} ${m.last_name}`).join(', ')
          : 'Eigene Notizen';
        const lastActivity = Number(c.last_action || c.last_activity || 0);
        const image = otherMembers.length === 1 && otherMembers[0].image
          ? String(otherMembers[0].image)
          : undefined;
        // Extract other user's ID and derive availability from status
        const otherUserId = otherMembers.length === 1 ? String(otherMembers[0].id) : undefined;
        const otherStatus = otherMembers.length === 1 ? String(otherMembers[0].status || '') : undefined;
        const userAvailability = api.deriveAvailability(otherStatus);
        return {
          type: 'conversation' as const,
          id: String(c.id),
          name,
          image,
          encrypted: Boolean(c.encrypted),
          // Stashcat API: same as channels, 'unread' (not 'unread_count') carries the actual count.
          unread_count: (c as any).unread ?? c.unread_count ?? (c as any).unread_messages ?? 0,
          favorite: Boolean(c.favorite ?? c.is_favorite),
          lastActivity,
          userId: otherUserId,
          userAvailability,
        };
      });

      // ── Merge API unread_count with state ───────────────────────────────
      // Wir vertrauen dem Server-`unread`-Wert (das ist die einzige Quelle,
      // die "auf anderem Gerät gelesen" mitbekommt). Nur SSE-Increments, die
      // WÄHREND des Roundtrips reinkamen und im Server-Snapshot noch nicht
      // enthalten waren, addieren wir oben drauf. Aktive Chats halten ihre 0,
      // damit ein eigenes Lesen nicht für einen Moment "aufflackert", falls
      // der Server-Wert noch nicht aktualisiert wurde.
      const active = activeChatRef.current;
      const mergeUnread = (id: string, apiUnread: number, kind: 'channel' | 'conversation'): number => {
        if (active?.type === kind && active.id === id) return 0;
        const deltaAtStart = deltaSnapshot.get(id) ?? 0;
        const deltaNow = sseDeltaRef.current.get(id) ?? 0;
        const incrementsDuringFetch = Math.max(0, deltaNow - deltaAtStart);
        // Delta-Buffer entsprechend zurücksetzen: alles bis zum Snapshot ist
        // erledigt, nur die "während Fetch"-Increments bleiben.
        if (incrementsDuringFetch > 0) {
          sseDeltaRef.current.set(id, incrementsDuringFetch);
        } else {
          sseDeltaRef.current.delete(id);
        }
        return apiUnread + incrementsDuringFetch;
      };
      for (const ch of allChannels) {
        ch.unread_count = mergeUnread(ch.id, ch.unread_count ?? 0, 'channel');
      }
      for (const cv of convTargets) {
        cv.unread_count = mergeUnread(cv.id, cv.unread_count ?? 0, 'conversation');
      }

      // Detect newly unread chats and show OS notifications.
      // Only after initial load (prevUnreadsRef populated), so login
      // doesn't flood with notifications for pre-existing unreads.
      if (prevUnreadsRef.current) {
        const allChats = [...allChannels, ...convTargets];
        for (const chat of allChats) {
          const prevCount = prevUnreadsRef.current.get(chat.id) ?? 0;
          const newCount = chat.unread_count ?? 0;
          if (newCount > prevCount && prevCount === 0) {
            const body = newCount === 1 ? 'Neue Nachricht' : `${newCount} neue Nachrichten`;
            notify(getCleanName(chat.name), body);
          }
        }
      }

      // Update ref for next comparison
      const unreads = new Map<string, number>();
      for (const ch of allChannels) unreads.set(ch.id, ch.unread_count ?? 0);
      for (const cv of convTargets) unreads.set(cv.id, cv.unread_count ?? 0);
      prevUnreadsRef.current = unreads;

      const sortedChannels = sortChats(allChannels);
      const sortedConvs = sortChats(convTargets);
      // Pre-populate refs so async helpers see fresh data without waiting for
      // the next render cycle.
      channelsRef.current = sortedChannels;
      conversationsRef.current = sortedConvs;
      setChannels(sortedChannels);
      onChannelsLoaded?.(sortedChannels);
      setConversations(sortedConvs);
      onConversationsLoaded?.(sortedConvs);
      setInitialLoaded(true);
      saveSidebarCache(sortedChannels, sortedConvs, firstCompanyId);
    } catch (err) {
      console.error('Failed to load sidebar data:', err);
    }
  }

  // Periodic sidebar sync: refresh unread counts and detect missed messages.
  // Runs regardless of tab visibility so background notifications work even
  // when the SSE connection has silently dropped (browser throttling, standby).
  // 20 s + Jitter halten Multi-Device-Read-Status zeitnah konsistent: Liest
  // ein anderes Gerät desselben Users eine Nachricht, sendet Stashcat dafür
  // kein Realtime-Event — wir müssen den serverseitigen `unread`-Wert pollen.
  // loadData() reicht jetzt fallende API-Werte durch (Delta-Tracking statt
  // Math.max), sodass dieses Polling den Badge tatsächlich zurücksetzen kann.
  useEffect(() => {
    if (!loggedIn) return;
    const BASE_INTERVAL = 20_000;
    const jitter = () => Math.random() * 4_000;
    let timeoutId: number;
    const tick = () => {
      loadData().finally(() => {
        timeoutId = window.setTimeout(tick, BASE_INTERVAL + jitter());
      });
    };
    timeoutId = window.setTimeout(tick, BASE_INTERVAL + jitter());
    return () => window.clearTimeout(timeoutId);
  }, [loggedIn]);

  // Sofort-Sync, wenn der Tab in den Vordergrund kommt: deckt den Fall ab,
  // dass der Nutzer auf einem anderen Gerät gelesen hat, ohne dass die SSE-
  // Verbindung dabei abriss. handleReconnect kümmert sich um den Disconnect-
  // Fall, dieser Hook hier um "Tab war nur ausgeblendet".
  useEffect(() => {
    if (!loggedIn) return;
    const onVisibility = () => {
      if (!document.hidden) loadData();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [loggedIn]);

  // Stable handler refs for useRealtimeEvents — prevents handler replacement on every render
  const handleMessageSync = useCallback((data: unknown) => {
    const payload = data as Record<string, unknown>;
    const time = Number(payload.time || 0);
    const channelId = payload.channel_id && payload.channel_id !== 0 ? String(payload.channel_id) : null;
    const convId = payload.conversation_id && payload.conversation_id !== 0 ? String(payload.conversation_id) : null;
    const active = activeChatRef.current;
    const isInForeground = !document.hidden;

    // Always update lastActivity for sorting; increment unread_count only if:
    // - Tab is in background, OR
    // - Tab is in foreground but the chat is not currently open
    // - AND the message is from someone else (not own messages)
    const sender = payload.sender as Record<string, unknown> | undefined;
    const senderId = sender?.id ? String(sender.id) : '';
    const isOwnMessage = senderId === String(user?.id ?? '');

    if (channelId) {
      const isActive = active?.type === 'channel' && active.id === channelId;
      const shouldIncrement = (!isInForeground || !isActive) && !isOwnMessage;
      let bumpedParentId: string | null = null;
      setChannels((prev) => {
        // If this channel is a subchannel, bump the parent's lastActivity too
        // so the parent floats up in the sidebar order.
        const target = prev.find((c) => c.id === channelId);
        const parentId = target ? getParentId(target.name) : null;
        bumpedParentId = shouldIncrement ? parentId : null;
        return sortChats(prev.map((ch) => {
          if (ch.id === channelId) {
            return { ...ch, lastActivity: time || ch.lastActivity, unread_count: shouldIncrement ? (ch.unread_count ?? 0) + 1 : ch.unread_count };
          }
          if (parentId && ch.id === parentId) {
            return { ...ch, lastActivity: time || ch.lastActivity };
          }
          return ch;
        }));
      });
      // Wenn die Nachricht in einem Sub-Channel landet, klappen wir den
      // Parent automatisch auf — sonst sieht der User die Unread-Badge nicht
      // (sie steckt unter einem zugeklappten Knoten). Idempotent: setExpanded
      // mit einem schon enthaltenen Key liefert die alte Set-Referenz zurück.
      if (bumpedParentId) {
        setExpandedParents((prev) => {
          if (prev.has(bumpedParentId!)) return prev;
          const next = new Set(prev);
          next.add(bumpedParentId!);
          return next;
        });
      }
      // Keep prevUnreadsRef in sync so background poll doesn't re-notify
      if (shouldIncrement) {
        prevUnreadsRef.current?.set(channelId, (prevUnreadsRef.current.get(channelId) ?? 0) + 1);
        sseDeltaRef.current.set(channelId, (sseDeltaRef.current.get(channelId) ?? 0) + 1);
      }
    } else if (convId) {
      const isActive = active?.type === 'conversation' && active.id === convId;
      const shouldIncrement = (!isInForeground || !isActive) && !isOwnMessage;
      setConversations((prev) => sortChats(prev.map((conv) =>
        conv.id === convId
          ? { ...conv, lastActivity: time || conv.lastActivity, unread_count: shouldIncrement ? (conv.unread_count ?? 0) + 1 : conv.unread_count }
          : conv
      )));
      if (shouldIncrement) {
        prevUnreadsRef.current?.set(convId, (prevUnreadsRef.current.get(convId) ?? 0) + 1);
        sseDeltaRef.current.set(convId, (sseDeltaRef.current.get(convId) ?? 0) + 1);
      }
    }

    // OS notification for messages from other users when tab is in background
    if (senderId && senderId !== String(user?.id ?? '')) {
      const senderName = `${sender?.first_name ?? ''} ${sender?.last_name ?? ''}`.trim() || 'Neue Nachricht';
      const text = payload.text ? String(payload.text) : '';
      const preview = text
        ? (text.length > 80 ? text.slice(0, 80) + '…' : text)
        : 'Datei gesendet';
      notify(senderName, preview);
    }
  }, [user?.id, notify]);

  const handleReconnect = useCallback(() => {
    // Re-fetch all sidebar data after SSE reconnection to sync missed unread counts.
    // loadData() preserves SSE-tracked unread counts (never overwrites with a lower
    // API value), so this is safe to call after reconnect.
    loadData();
  }, []);

  const handleStatusChange = useCallback((data: unknown) => {
    // Payload: { user_id, status } or similar
    const payload = data as Record<string, unknown>;
    const userId = payload.user_id ? String(payload.user_id) : (payload.userId ? String(payload.userId) : null);
    const statusText = payload.status ? String(payload.status) : null;
    if (userId && statusText) {
      const availability = api.deriveAvailability(statusText);
      if (availability) {
        setConversations((prev) => prev.map((conv) =>
          conv.userId === userId ? { ...conv, userAvailability: availability } : conv
        ));
      }
    }
  }, []);

  // Realtime: increment unread count for inactive chats when new message arrives
  useRealtimeEvents({
    message_sync: handleMessageSync,
    reconnect: handleReconnect,
    online_status_change: handleStatusChange,
  }, loggedIn);

  // Mark chat as read (called from ChatView after 3s visibility)
  const handleMarkRead = useCallback((chatId: string, chatType: 'channel' | 'conversation') => {
    if (chatType === 'channel') {
      setChannels((prev) => prev.map((ch) => ch.id === chatId ? { ...ch, unread_count: 0 } : ch));
    } else {
      setConversations((prev) => prev.map((c) => c.id === chatId ? { ...c, unread_count: 0 } : c));
    }
    // Keep prevUnreadsRef in sync so background poll doesn't re-notify
    prevUnreadsRef.current?.set(chatId, 0);
    // Lokales Lesen invalidiert das SSE-Delta — der Server kennt jetzt den
    // korrekten Stand, und beim nächsten loadData() soll der Server-Wert (0)
    // direkt durchgereicht werden.
    sseDeltaRef.current.delete(chatId);
  }, []);

  // Mark chat as unread (triggered from ChatItem three-dot menu)
  const handleMarkUnread = useCallback(async (target: ChatTarget) => {
    try {
      await api.markChatAsUnread(target.id, target.type);
    } catch (err) {
      console.error('markChatAsUnread failed:', err);
      return;
    }
    // Optimistic local update; next sidebar poll will sync the real count
    if (target.type === 'channel') {
      setChannels((prev) => prev.map((ch) => ch.id === target.id ? { ...ch, unread_count: Math.max(1, ch.unread_count ?? 0) } : ch));
    } else {
      setConversations((prev) => prev.map((c) => c.id === target.id ? { ...c, unread_count: Math.max(1, c.unread_count ?? 0) } : c));
    }
    prevUnreadsRef.current?.set(target.id, Math.max(1, prevUnreadsRef.current.get(target.id) ?? 0));
  }, []);

  // Channel deleted from ChatItem three-dot menu (DeleteConfirmModal also dispatches 'channel-deleted' event which triggers loadData)
  const handleChannelDeleted = useCallback((target: ChatTarget) => {
    setChannels((prev) => prev.filter((ch) => ch.id !== target.id));
    prevUnreadsRef.current?.delete(target.id);
    sseDeltaRef.current.delete(target.id);
  }, []);

  // Channel left from ChatItem three-dot menu
  const handleChannelLeft = useCallback((target: ChatTarget) => {
    setChannels((prev) => prev.filter((ch) => ch.id !== target.id));
    prevUnreadsRef.current?.delete(target.id);
    sseDeltaRef.current.delete(target.id);
  }, []);

  // Conversation archived from ChatItem three-dot menu
  const handleConversationArchived = useCallback((target: ChatTarget) => {
    setConversations((prev) => prev.filter((c) => c.id !== target.id));
    prevUnreadsRef.current?.delete(target.id);
    sseDeltaRef.current.delete(target.id);
  }, []);

  // Listen for mark-read events from ChatView
  useEffect(() => {
    const handler = (e: CustomEvent<{ chatId: string; chatType: 'channel' | 'conversation' }>) => {
      handleMarkRead(e.detail.chatId, e.detail.chatType);
    };
    window.addEventListener('chat-mark-read', handler as EventListener);
    return () => window.removeEventListener('chat-mark-read', handler as EventListener);
  }, [handleMarkRead]);

  // Listen for channel-deleted events to refresh sidebar immediately
  useEffect(() => {
    const handler = () => {
      loadData();
    };
    window.addEventListener('channel-deleted', handler as EventListener);
    return () => window.removeEventListener('channel-deleted', handler as EventListener);
  }, []);

  // Listen for channel-renamed events to update sidebar
  useEffect(() => {
    const handler = (e: CustomEvent<{ channelId: string; newName: string }>) => {
      setChannels((prev) => prev.map((ch) => ch.id === e.detail.channelId ? { ...ch, name: e.detail.newName } : ch));
    };
    window.addEventListener('channel-renamed', handler as EventListener);
    return () => window.removeEventListener('channel-renamed', handler as EventListener);
  }, []);

  // Listen for "open new channel modal" requests (e.g. from ChatItem "Subchannel hinzufügen")
  useEffect(() => {
    const handler = (e: CustomEvent<{ parentId?: string }>) => {
      setNewChannelParentId(e.detail?.parentId);
      setShowNewChannel(true);
    };
    window.addEventListener('open-new-channel-modal', handler as EventListener);
    return () => window.removeEventListener('open-new-channel-modal', handler as EventListener);
  }, []);

  const handleSelect = useCallback((target: ChatTarget) => {
    // Clear unread for selected chat immediately in sidebar
    if (target.type === 'channel') {
      setChannels((prev) => prev.map((ch) => ch.id === target.id ? { ...ch, unread_count: 0 } : ch));
    } else {
      setConversations((prev) => prev.map((c) => c.id === target.id ? { ...c, unread_count: 0 } : c));
    }
    onSelectChat(target);
  }, [onSelectChat]);

  const handleToggleFavorite = useCallback(async (target: ChatTarget) => {
    const newFav = !target.favorite;
    // Optimistic update
    if (target.type === 'channel') {
      setChannels((prev) => sortChats(prev.map((ch) => ch.id === target.id ? { ...ch, favorite: newFav } : ch)));
    } else {
      setConversations((prev) => sortChats(prev.map((c) => c.id === target.id ? { ...c, favorite: newFav } : c)));
    }
    try {
      await api.setFavorite(target.type, target.id, newFav);
    } catch (err) {
      console.error('Failed to toggle favorite:', err);
      // Revert on error
      if (target.type === 'channel') {
        setChannels((prev) => sortChats(prev.map((ch) => ch.id === target.id ? { ...ch, favorite: !newFav } : ch)));
      } else {
        setConversations((prev) => sortChats(prev.map((c) => c.id === target.id ? { ...c, favorite: !newFav } : c)));
      }
    }
  }, []);

  const filtered = (items: ChatTarget[]) => {
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter((i) => getCleanName(i.name).toLowerCase().includes(q));
  };

  // Render tree nodes (one level deep) with collapse toggle
  // Skeleton-Placeholder für die initiale Lade-Phase. Eine Liste von
  // grauen Pulse-Karten statt nichts/Spinner — fühlt sich responsiver an.
  const SkeletonList = ({ count = 6 }: { count?: number }) => (
    <div className="px-1 py-1" aria-hidden>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-2 rounded-lg px-2 py-2">
          <div className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-surface-200 dark:bg-surface-700" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="h-3 w-3/5 animate-pulse rounded bg-surface-200 dark:bg-surface-700" />
            <div className="h-2.5 w-2/5 animate-pulse rounded bg-surface-200/70 dark:bg-surface-700/70" />
          </div>
        </div>
      ))}
    </div>
  );

  const renderChannelTree = (roots: ChannelNode[], orphans: ChannelNode[]) => {
    const q = search.toLowerCase();

    const renderNode = (node: ChannelNode, depth = 0) => {
      const isParent = node.children.length > 0;
      const hasMatchingChild = isParent && q
        ? node.children.some((c) => c.displayName.toLowerCase().includes(q))
        : false;
      const isActiveParent = isParent && activeParentId === node.id;
      const effectivelyExpanded =
        expandedParents.has(node.id) || hasMatchingChild || isActiveParent;

      // Filter by search
      const nameMatches = !q || node.displayName.toLowerCase().includes(q);
      const childrenToShow = q
        ? node.children.filter((c) => c.displayName.toLowerCase().includes(q))
        : node.children;

      if (!nameMatches && childrenToShow.length === 0) return null;

      return (
        <div key={node.id}>
          <ChatItem
            target={{ ...node, name: node.displayName }}
            active={activeChat?.id === node.id && activeChat?.type === 'channel'}
            onSelect={(t) => handleSelect({ ...t, name: node.name })}
            onToggleFavorite={(t) => handleToggleFavorite({ ...t, name: node.name })}
            onMarkUnread={(t) => handleMarkUnread({ ...t, name: node.name })}
            onChannelDeleted={(t) => handleChannelDeleted({ ...t, name: node.name })}
            onChannelLeft={(t) => handleChannelLeft({ ...t, name: node.name })}
            channels={channels}
            compact={depth > 0}
            onAddSubchannel={depth === 0 ? (parentId) => {
              setNewChannelParentId(parentId);
              setShowNewChannel(true);
            } : undefined}
            expanded={isParent && !q ? effectivelyExpanded : undefined}
            onToggleExpand={isParent && !q ? () => toggleExpand(node.id) : undefined}
          />
          {isParent && effectivelyExpanded && childrenToShow.length > 0 && (
            <div className="ml-3 border-l-2 border-surface-200 pl-3 dark:border-surface-700">
              {childrenToShow.map((child) => renderNode(child, depth + 1))}
            </div>
          )}
        </div>
      );
    };

    const allRoots = [...roots, ...orphans];
    return allRoots.map((node) => renderNode(node));
  };

  const [showChannelDiscovery, setShowChannelDiscovery] = useState(false);

  // Manually expanded parent channel IDs — default empty (all collapsed).
  // Parents are also auto-expanded when an active subchannel is inside them
  // or when a search query matches one of their children.
  const [expandedParents, setExpandedParents] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('schulchat_subchannel_expanded');
      return saved ? new Set<string>(JSON.parse(saved) as string[]) : new Set<string>();
    } catch {
      return new Set<string>();
    }
  });

  const toggleExpand = useCallback((channelId: string) => {
    setExpandedParents((prev) => {
      const next = new Set(prev);
      if (next.has(channelId)) {
        next.delete(channelId);
      } else {
        next.add(channelId);
      }
      try { localStorage.setItem('schulchat_subchannel_expanded', JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }, []);

  // Build channel tree
  const { roots: channelRoots, orphans: channelOrphans } = useMemo(
    () => buildChannelTree(channels),
    [channels],
  );

  // Parent ID of the currently active subchannel — that parent is force-expanded
  const activeParentId = useMemo(() => {
    if (!activeChat || activeChat.type !== 'channel') return null;
    const ch = channels.find((c) => c.id === activeChat.id);
    return ch ? getParentId(ch.name) : null;
  }, [activeChat, channels]);

  // Total unread count — update document title as indicator
  const totalUnread = channels.reduce((sum, ch) => sum + (ch.unread_count ?? 0), 0)
    + conversations.reduce((sum, c) => sum + (c.unread_count ?? 0), 0);

  // Unread chats — used by the bell hover popup
  const unreadChannels = channels
    .filter((ch) => (ch.unread_count ?? 0) > 0)
    .sort((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0));
  const unreadConversations = conversations
    .filter((c) => (c.unread_count ?? 0) > 0)
    .sort((a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0));

  useEffect(() => {
    document.title = totalUnread > 0 ? `(${totalUnread}) BBZ Chat` : 'BBZ Chat';
    onUnreadChange?.(totalUnread, unreadChannels, unreadConversations);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalUnread]);

  useFaviconBadge(totalUnread);

  // Drag logic
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;

    const onMove = (ev: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pct = ((ev.clientY - rect.top) / rect.height) * 100;
      const newPct = Math.min(80, Math.max(20, pct));
      setSplitPct(newPct);
      localStorage.setItem('schulchat_sidebar_split', String(newPct));
    };

    const onUp = () => {
      dragging.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  return (
    <div
      className="relative flex h-full w-full shrink-0 flex-col bg-[var(--theme-panel)] md:w-[var(--sidebar-w)]"
      style={{ '--sidebar-w': `${sidebarWidth}px` } as CSSProperties}
    >
      {/* Horizontal resize handle — desktop only */}
      <div
        onMouseDown={onWidthMouseDown}
        className="absolute right-0 top-0 z-20 hidden h-full w-1 cursor-col-resize border-r border-surface-200 transition-colors hover:border-primary-400 hover:border-r-2 dark:border-surface-700 dark:hover:border-primary-600 md:block"
        title="Breite anpassen"
      />
      {/* SidebarHeader — mobile only; desktop uses TopBar */}
      <div className="md:hidden">
        <SidebarHeader
          totalUnread={totalUnread}
          unreadChannels={unreadChannels}
          unreadConversations={unreadConversations}
          onSelectChat={handleSelect}
          onGoHome={onGoHome}
        />
      </div>

      {/* Search */}
      <div className="shrink-0 p-3">
        <div className="flex items-center gap-2 rounded-lg bg-white/70 px-3 py-2 dark:bg-surface-800">
          <Search size={16} className="shrink-0 text-surface-500" />
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Escape') { setSearch(''); searchRef.current?.blur(); } }}
            placeholder="Suchen..."
            className="w-full bg-transparent text-sm text-surface-900 outline-none placeholder:text-surface-500 dark:text-white"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="shrink-0 rounded text-surface-400 hover:text-surface-600 dark:hover:text-surface-300"
              aria-label="Suche löschen"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Split panels (desktop/tablet) — WhatsApp-style tabs (phone) */}
      {isPhone ? (
        <div className="relative flex min-h-0 flex-1 flex-col">
          {/* Tab bar — segmented control pill style */}
          <div className="mx-3 mt-2.5 mb-1.5 flex shrink-0 items-center gap-1 rounded-xl bg-surface-100 p-1 dark:bg-surface-800">
            {/* Direct tab */}
            <button
              onClick={() => { bridge.haptic('selection'); setActiveTab('direct'); }}
              className={clsx(
                'flex min-h-[36px] flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-semibold uppercase tracking-wider transition-all duration-150',
                activeTab === 'direct'
                  ? 'bg-white text-primary-600 shadow-sm dark:bg-surface-700 dark:text-primary-400'
                  : 'text-surface-500 dark:text-surface-400',
              )}
            >
              <Users size={14} />
              <span>Direktnachrichten</span>
              {unreadConversations.length > 0 && activeTab !== 'direct' && (
                <span className="ml-0.5 rounded-full bg-primary-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white dark:bg-primary-500">
                  {unreadConversations.length}
                </span>
              )}
            </button>

            {/* Channels tab */}
            <div className="flex flex-1 items-center">
              <button
                onClick={() => { bridge.haptic('selection'); setActiveTab('channels'); }}
                className={clsx(
                  'flex min-h-[36px] flex-1 items-center justify-center gap-1.5 rounded-lg px-2 text-xs font-semibold uppercase tracking-wider transition-all duration-150',
                  activeTab === 'channels'
                    ? 'bg-white text-primary-600 shadow-sm dark:bg-surface-700 dark:text-primary-400'
                    : 'text-surface-500 dark:text-surface-400',
                )}
              >
                <Hash size={14} />
                <span>Channels</span>
                {unreadChannels.length > 0 && activeTab !== 'channels' && (
                  <span className="ml-0.5 rounded-full bg-primary-600 px-1.5 py-0.5 text-[10px] font-bold leading-none text-white dark:bg-primary-500">
                    {unreadChannels.length}
                  </span>
                )}
              </button>
              {activeTab === 'channels' && (
                <button
                  onClick={() => setShowChannelDiscovery(true)}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-primary-600 transition hover:bg-surface-200 dark:text-primary-400 dark:hover:bg-surface-600"
                  title="Alle Channels anzeigen"
                  aria-label="Alle Channels anzeigen"
                >
                  <Search size={16} />
                </button>
              )}
            </div>
          </div>

          {/* Tab-Container: horizontaler Slide zwischen Direkt und Channels.
              Beide Tabs sind immer im DOM, nur ihre X-Position wird über
              translate animiert (220 ms ease-out). Reihenfolge fest:
              direct (links, translateX(0)) ←→ channels (rechts, translateX(-100%)). */}
          <div className="relative flex min-h-0 flex-1 overflow-hidden">
            <div
              className="flex w-[200%] min-h-0 flex-1 transition-transform duration-[220ms] ease-out"
              style={{ transform: activeTab === 'channels' ? 'translateX(-50%)' : 'translateX(0%)' }}
            >
              {/* Direkt-Tab */}
              <div className="flex w-1/2 min-h-0 flex-col">
                <div
                  ref={directPullToRefresh.containerRef as React.RefCallback<HTMLDivElement>}
                  className={clsx(
                    'flex-1 overflow-y-auto px-2 py-1',
                    activeTab !== 'direct' && 'pointer-events-none',
                  )}
                  aria-hidden={activeTab !== 'direct'}
                >
                  {directPullToRefresh.indicator}
                  {!initialLoaded && conversations.length === 0
                    ? <SkeletonList />
                    : filtered(conversations).map((conv) => (
                      <ChatItem
                        key={`conv-${conv.id}`}
                        target={conv}
                        active={activeChat?.id === conv.id && activeChat?.type === 'conversation'}
                        onSelect={handleSelect}
                        onToggleFavorite={handleToggleFavorite}
                        onMarkUnread={handleMarkUnread}
                        onConversationArchived={handleConversationArchived}
                      />
                    ))}
                </div>
              </div>
              {/* Channels-Tab */}
              <div className="flex w-1/2 min-h-0 flex-col">
                <div
                  ref={channelsPullToRefresh.containerRef as React.RefCallback<HTMLDivElement>}
                  className={clsx(
                    'flex-1 overflow-y-auto px-2 py-1',
                    activeTab !== 'channels' && 'pointer-events-none',
                  )}
                  aria-hidden={activeTab !== 'channels'}
                >
                  {channelsPullToRefresh.indicator}
                  {!initialLoaded && channels.length === 0
                    ? <SkeletonList />
                    : renderChannelTree(channelRoots, channelOrphans)}
                </div>
              </div>
            </div>
          </div>

          {/* Floating Action Button — bedient den aktiven Tab. Bleibt über dem
              SidebarFooter (bottom-20) und respektiert iOS-Safe-Area. */}
          <button
            type="button"
            onClick={() => {
              bridge.haptic('medium');
              if (activeTab === 'channels') setShowNewChannel(true);
              else setShowNewChat(true);
            }}
            disabled={!primaryCompanyId}
            aria-label={activeTab === 'channels' ? 'Neuen Channel erstellen' : 'Neue Direktnachricht starten'}
            title={activeTab === 'channels' ? 'Neuen Channel erstellen' : 'Neue Direktnachricht starten'}
            style={{ bottom: 'calc(5rem + env(safe-area-inset-bottom, 0px))' }}
            className="absolute right-4 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-primary-600 text-white shadow-lg ring-1 ring-black/5 transition hover:bg-primary-700 active:scale-95 disabled:opacity-50 dark:bg-primary-500 dark:hover:bg-primary-600"
          >
            <Plus size={26} strokeWidth={2.4} />
          </button>
        </div>
      ) : (
        <div ref={containerRef} className="flex min-h-0 flex-1 flex-col">
          {/* Channels panel */}
          <div className="flex min-h-0 flex-col" style={{ height: `${splitPct}%` }}>
            <div className="shrink-0 px-4 py-1.5">
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setShowChannelDiscovery(true)}
                  className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-surface-500 transition hover:text-primary-600 dark:hover:text-primary-400"
                  title="Alle Channels anzeigen"
                >
                  <Hash size={13} /> Channels ({channels.length})
                </button>
                <button
                  onClick={() => setShowNewChannel(true)}
                  disabled={!primaryCompanyId}
                  className="rounded-md p-0.5 text-surface-500 transition hover:bg-surface-200 hover:text-surface-600 dark:hover:bg-surface-700 dark:hover:text-surface-300 disabled:opacity-30"
                  title="Neuen Channel erstellen"
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-2 pb-1">
              {renderChannelTree(channelRoots, channelOrphans)}
            </div>
          </div>

          {/* Drag handle — desktop only */}
          <div
            onMouseDown={onMouseDown}
            className="group hidden cursor-row-resize items-center justify-center border-y border-surface-200 py-0.5 hover:bg-surface-200 dark:border-surface-700 dark:hover:bg-surface-800 md:flex"
          >
            <GripHorizontal size={16} className="text-surface-300 group-hover:text-surface-500 dark:text-surface-400 dark:group-hover:text-surface-500" />
          </div>

          {/* Conversations panel */}
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="shrink-0 px-4 py-1.5">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-surface-500">
                  <Users size={13} /> Direktnachrichten ({filtered(conversations).length})
                </span>
                <button
                  onClick={() => setShowNewChat(true)}
                  disabled={!primaryCompanyId}
                  className="rounded-md p-0.5 text-surface-500 transition hover:bg-surface-200 hover:text-surface-600 dark:hover:bg-surface-700 dark:hover:text-surface-300 disabled:opacity-30"
                  title="Neue Direktnachricht starten"
                >
                  <Plus size={14} />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-2 pb-1">
              {filtered(conversations).map((conv) => (
                <ChatItem
                  key={`conv-${conv.id}`}
                  target={conv}
                  active={activeChat?.id === conv.id && activeChat?.type === 'conversation'}
                  onSelect={handleSelect}
                  onToggleFavorite={handleToggleFavorite}
                  onMarkUnread={handleMarkUnread}
                  onConversationArchived={handleConversationArchived}
                />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* SidebarFooter — mobile only; desktop uses TopBar */}
      <div className="md:hidden">
        <SidebarFooter />
      </div>

      {/* New channel modal */}
      {showNewChannel && primaryCompanyId && (
        <NewChannelModal
          companyId={primaryCompanyId}
          channels={channels}
          myUserId={user?.id}
          presetParentId={newChannelParentId}
          onClose={() => { setShowNewChannel(false); setNewChannelParentId(undefined); }}
          onCreate={(ch) => {
            // Add newly created channel to the list and navigate to it
            const newTarget: ChatTarget = {
              type: 'channel',
              id: String(ch.id ?? ''),
              name: String(ch.name ?? ''),
              description: ch.description ? String(ch.description) : undefined,
              image: ch.image ? String(ch.image) : undefined,
              company_id: primaryCompanyId,
              encrypted: Boolean(ch.encrypted),
              unread_count: 0,
              favorite: false,
              lastActivity: Date.now() / 1000,
            };
            setChannels((prev) => sortChats([newTarget, ...prev]));
            onSelectChat(newTarget);
          }}
        />
      )}

      {/* New direct message modal */}
      {showNewChat && primaryCompanyId && (
        <NewChatModal
          companyId={primaryCompanyId}
          myUserId={user?.id ?? ''}
          onClose={() => setShowNewChat(false)}
          onCreate={(conv) => {
            const newId = String(conv.id ?? '');
            const members = conv.members || [];
            const userId = user?.id ?? '';
            const others = members.filter((m) => String(m.id) !== userId);
            const name = others.length > 0
              ? others.map((m) => `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim()).join(', ')
              : 'Eigene Notizen';

            const newTarget: ChatTarget = {
              type: 'conversation',
              id: newId,
              name,
              image: others.length === 1 && others[0].image ? String(others[0].image) : undefined,
              encrypted: Boolean(conv.encrypted),
              unread_count: 0,
              favorite: false,
              lastActivity: Date.now() / 1000,
            };

            // Add to conversations list and navigate
            setConversations((prev) => sortChats([newTarget, ...prev.filter((c) => c.id !== newId)]));
            onSelectChat(newTarget);

            // Also refresh from server in background to sync
            api.getConversations().then((freshConvs) => {
              const targets: ChatTarget[] = freshConvs.map((c) => {
                const m = c.members || [];
                const o = m.filter((mb) => String(mb.id) !== userId);
                return {
                  type: 'conversation' as const,
                  id: String(c.id),
                  name: o.length > 0 ? o.map((mb) => `${mb.first_name ?? ''} ${mb.last_name ?? ''}`.trim()).join(', ') : 'Eigene Notizen',
                  image: o.length === 1 && o[0].image ? String(o[0].image) : undefined,
                  encrypted: Boolean(c.encrypted),
                  unread_count: Number(c.unread_count ?? 0),
                  favorite: Boolean(c.favorite),
                  lastActivity: Number(c.last_action || c.last_activity || 0),
                };
              });
              setConversations(sortChats(targets));
            }).catch(() => {});
          }}
        />
      )}

      {/* Channel discovery modal */}
      {showChannelDiscovery && primaryCompanyId && (
        <ChannelDiscoveryModal
          companyId={primaryCompanyId}
          subscribedIds={new Set(channels.map((ch) => ch.id))}
          onClose={() => setShowChannelDiscovery(false)}
          onJoined={(ch) => {
            const newTarget: ChatTarget = {
              type: 'channel',
              id: String(ch.id),
              name: String(ch.name || ''),
              description: ch.description ? String(ch.description) : undefined,
              image: ch.image ? String(ch.image) : undefined,
              encrypted: Boolean(ch.encrypted),
              unread_count: 0,
              favorite: false,
              lastActivity: Date.now() / 1000,
              company_id: primaryCompanyId,
            };
            setChannels((prev) => sortChats([newTarget, ...prev.filter((c) => c.id !== newTarget.id)]));
            onSelectChat(newTarget);
            setShowChannelDiscovery(false);
          }}
        />
      )}
    </div>
  );
}
