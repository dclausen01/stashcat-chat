import { useState, useEffect, useRef, useCallback } from 'react';
import { Hash, Search, Users, GripHorizontal, Plus } from 'lucide-react';
import * as api from '../api';
import { useAuth } from '../context/AuthContext';
import { useRealtimeEvents } from '../hooks/useRealtimeEvents';
import { useFaviconBadge } from '../hooks/useFaviconBadge';
import { useNotifications } from '../hooks/useNotifications';
import ChatItem from './ChatItem';
import SidebarHeader from './SidebarHeader';
import SidebarFooter from './SidebarFooter';
import NewChannelModal from './NewChannelModal';
import NewChatModal from './NewChatModal';
import ChannelDiscoveryModal from './ChannelDiscoveryModal';
import type { ChatTarget } from '../types';

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
  onOpenFileBrowser: () => void;
  onOpenBroadcasts: () => void;
  onOpenCalendar: () => void;
  onOpenPolls: () => void;
  onOpenNotifications: () => void;
  onOpenSettings: () => void;
  onOpenProfile: () => void;
  broadcastsOpen: boolean;
  calendarOpen: boolean;
  pollsOpen: boolean;
  notificationsOpen: boolean;
  onChannelsLoaded?: (channels: ChatTarget[]) => void;
  onRegisterRefresh?: (refresh: () => void) => void;
  onRegisterToggleFavorite?: (toggle: (target: ChatTarget) => void) => void;
}

export default function Sidebar({ activeChat, onSelectChat, loggedIn, onOpenFileBrowser, onOpenBroadcasts, onOpenCalendar, onOpenPolls, onOpenNotifications, onOpenSettings, onOpenProfile, broadcastsOpen, calendarOpen, pollsOpen, notificationsOpen, onChannelsLoaded, onRegisterRefresh, onRegisterToggleFavorite }: SidebarProps) {
  const { user } = useAuth();
  const { notify } = useNotifications();
  const [channels, setChannels] = useState<ChatTarget[]>([]);
  const [conversations, setConversations] = useState<ChatTarget[]>([]);
  const [search, setSearch] = useState('');
  const [showNewChannel, setShowNewChannel] = useState(false);
  const [showNewChat, setShowNewChat] = useState(false);
  // Track first company ID for creating channels/chats
  const [primaryCompanyId, setPrimaryCompanyId] = useState<string>('');
  // Track previous unread counts for background poll notification detection.
  // null = initial load (don't notify), Map = populated (compare & notify).
  const prevUnreadsRef = useRef<Map<string, number> | null>(null);
  // Mirror of current state for async helpers (avoids stale closure).
  const channelsRef = useRef<ChatTarget[]>([]);
  const conversationsRef = useRef<ChatTarget[]>([]);

  // Sidebar width (horizontal resize)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('schulchat_sidebar_width');
    return saved ? Number(saved) : 360;
  });
  const sidebarWidthRef = useRef(sidebarWidth);
  const resizingWidth = useRef(false);

  const onWidthMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizingWidth.current = true;
    const startX = e.clientX;
    const startW = sidebarWidthRef.current;
    const onMove = (ev: MouseEvent) => {
      const newW = Math.max(200, Math.min(480, startW + ev.clientX - startX));
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
  const dragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeChatRef = useRef(activeChat);
  activeChatRef.current = activeChat;

  // Keep refs in sync with state so async helpers see current values
  channelsRef.current = channels;
  conversationsRef.current = conversations;

  useEffect(() => { (async () => { await loadData(); })(); onRegisterRefresh?.(loadData); onRegisterToggleFavorite?.(handleToggleFavorite); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { onChannelsLoaded?.(channels); }, [channels, onChannelsLoaded]);

  async function loadData() {
    try {
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
          unread_count: Number(c.unread_count ?? (c as unknown as Record<string, unknown>).unread_messages ?? 0),
          favorite: Boolean(c.favorite ?? c.is_favorite),
          lastActivity,
          userId: otherUserId,
          userAvailability,
        };
      });

      // ── Merge API unread_count with current state ───────────────────────
      // Preserve SSE-tracked unread_count if higher than API (handles live case).
      // Only markAsRead/handleSelect can reset unread_count to 0.
      for (const ch of allChannels) {
        const prev = channelsRef.current.find((c) => c.id === ch.id);
        const apiUnread = ch.unread_count ?? 0;
        const sseUnread = prev?.unread_count ?? 0;
        ch.unread_count = Math.max(apiUnread, sseUnread);
      }
      for (const cv of convTargets) {
        const prev = conversationsRef.current.find((c) => c.id === cv.id);
        const apiUnread = cv.unread_count ?? 0;
        const sseUnread = prev?.unread_count ?? 0;
        cv.unread_count = Math.max(apiUnread, sseUnread);
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
            notify(chat.name, body);
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
    } catch (err) {
      console.error('Failed to load sidebar data:', err);
    }
  }

  // Periodic sidebar sync: refresh unread counts and detect missed messages.
  // Runs regardless of tab visibility so background notifications work even
  // when the SSE connection has silently dropped (browser throttling, standby).
  // Uses a shorter interval (60s) to catch missed messages promptly.
  // loadData() preserves SSE-tracked unread counts (never overwrites with
  // a lower API value), so only new unreads from the API or mark-as-read
  // resets can change the count.
  useEffect(() => {
    if (!loggedIn) return;
    const SYNC_INTERVAL = 60 * 1000; // 60 seconds
    const intervalId = setInterval(() => {
      loadData();
    }, SYNC_INTERVAL);
    return () => clearInterval(intervalId);
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
      setChannels((prev) => sortChats(prev.map((ch) =>
        ch.id === channelId
          ? { ...ch, lastActivity: time || ch.lastActivity, unread_count: shouldIncrement ? (ch.unread_count ?? 0) + 1 : ch.unread_count }
          : ch
      )));
      // Keep prevUnreadsRef in sync so background poll doesn't re-notify
      if (shouldIncrement) {
        prevUnreadsRef.current?.set(channelId, (prevUnreadsRef.current.get(channelId) ?? 0) + 1);
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
    // Update ref's lastActivity to current time so loadData() doesn't see
    // a lastActivity increase from the user's own messages and flash a badge.
    const nowS = Math.floor(Date.now() / 1000);
    if (chatType === 'channel') {
      const ch = channelsRef.current.find((c) => c.id === chatId);
      if (ch) ch.lastActivity = nowS;
    } else {
      const cv = conversationsRef.current.find((c) => c.id === chatId);
      if (cv) cv.lastActivity = nowS;
    }
  }, []);

  // Listen for mark-read events from ChatView
  useEffect(() => {
    const handler = (e: CustomEvent<{ chatId: string; chatType: 'channel' | 'conversation' }>) => {
      handleMarkRead(e.detail.chatId, e.detail.chatType);
    };
    window.addEventListener('chat-mark-read', handler as EventListener);
    return () => window.removeEventListener('chat-mark-read', handler as EventListener);
  }, [handleMarkRead]);

  const handleSelect = useCallback((target: ChatTarget) => {
    // Clear unread for selected chat immediately in sidebar
    if (target.type === 'channel') {
      setChannels((prev) => prev.map((ch) => ch.id === target.id ? { ...ch, unread_count: 0 } : ch));
    } else {
      setConversations((prev) => prev.map((c) => c.id === target.id ? { ...c, unread_count: 0 } : c));
    }
    // Update ref's lastActivity so loadData() doesn't flash a badge on the
    // user's own messages in the chat they just opened.
    const nowS = Math.floor(Date.now() / 1000);
    if (target.type === 'channel') {
      const ch = channelsRef.current.find((c) => c.id === target.id);
      if (ch) ch.lastActivity = nowS;
    } else {
      const cv = conversationsRef.current.find((c) => c.id === target.id);
      if (cv) cv.lastActivity = nowS;
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
    return items.filter((i) => i.name.toLowerCase().includes(q));
  };

  const [showChannelDiscovery, setShowChannelDiscovery] = useState(false);

  // Total unread count — update document title as indicator
  const totalUnread = channels.reduce((sum, ch) => sum + (ch.unread_count ?? 0), 0)
    + conversations.reduce((sum, c) => sum + (c.unread_count ?? 0), 0);

  useEffect(() => {
    document.title = totalUnread > 0 ? `(${totalUnread}) BBZ Chat` : 'BBZ Chat';
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
      className="relative flex h-full shrink-0 flex-col bg-[var(--theme-panel)]"
      style={{ width: sidebarWidth }}
    >
      {/* Horizontal resize handle */}
      <div
        onMouseDown={onWidthMouseDown}
        className="absolute right-0 top-0 z-20 h-full w-1 cursor-col-resize border-r border-surface-200 transition-colors hover:border-primary-400 hover:border-r-2 dark:border-surface-700 dark:hover:border-primary-600"
        title="Breite anpassen"
      />
      <SidebarHeader
        totalUnread={totalUnread}
        notificationsOpen={notificationsOpen}
        onOpenNotifications={onOpenNotifications}
        onOpenFileBrowser={onOpenFileBrowser}
        onOpenSettings={onOpenSettings}
        onOpenProfile={onOpenProfile}
      />

      {/* Search */}
      <div className="shrink-0 p-3">
        <div className="flex items-center gap-2 rounded-lg bg-white/70 px-3 py-2 dark:bg-surface-800">
          <Search size={16} className="text-surface-500" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Suchen..."
            className="w-full bg-transparent text-sm text-surface-900 outline-none placeholder:text-surface-500 dark:text-white"
          />
        </div>
      </div>

      {/* Split panels */}
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
                <Hash size={13} /> Channels ({filtered(channels).length})
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
            {filtered(channels).map((ch) => (
              <ChatItem
                key={`ch-${ch.id}`}
                target={ch}
                active={activeChat?.id === ch.id && activeChat?.type === 'channel'}
                onSelect={handleSelect}
                onToggleFavorite={handleToggleFavorite}
              />
            ))}
          </div>
        </div>

        {/* Drag handle */}
        <div
          onMouseDown={onMouseDown}
          className="group flex shrink-0 cursor-row-resize items-center justify-center border-y border-surface-200 py-0.5 hover:bg-surface-200 dark:border-surface-700 dark:hover:bg-surface-800"
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
              />
            ))}
          </div>
        </div>
      </div>

      <SidebarFooter
        broadcastsOpen={broadcastsOpen}
        calendarOpen={calendarOpen}
        pollsOpen={pollsOpen}
        onOpenBroadcasts={onOpenBroadcasts}
        onOpenCalendar={onOpenCalendar}
        onOpenPolls={onOpenPolls}
      />

      {/* New channel modal */}
      {showNewChannel && primaryCompanyId && (
        <NewChannelModal
          companyId={primaryCompanyId}
          onClose={() => setShowNewChannel(false)}
          onCreate={(ch) => {
            // Add newly created channel to the list and navigate to it
            const newTarget: ChatTarget = {
              type: 'channel',
              id: String(ch.id ?? ''),
              name: String(ch.name ?? ''),
              description: ch.description ? String(ch.description) : undefined,
              image: ch.image ? String(ch.image) : undefined,
              company_id: primaryCompanyId,
              encrypted: false,
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
