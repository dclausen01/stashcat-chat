import { useState, useEffect, useRef, useCallback } from 'react';
import { Hash, Search, Users, GripHorizontal, Plus } from 'lucide-react';
import * as api from '../api';
import { useAuth } from '../context/AuthContext';
import { useRealtimeEvents } from '../hooks/useRealtimeEvents';
import { useFaviconBadge } from '../hooks/useFaviconBadge';
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
}

export default function Sidebar({ activeChat, onSelectChat, loggedIn, onOpenFileBrowser, onOpenBroadcasts, onOpenCalendar, onOpenPolls, onOpenNotifications, onOpenSettings, onOpenProfile, broadcastsOpen, calendarOpen, pollsOpen, notificationsOpen, onChannelsLoaded }: SidebarProps) {
  const { user } = useAuth();
  const [channels, setChannels] = useState<ChatTarget[]>([]);
  const [conversations, setConversations] = useState<ChatTarget[]>([]);
  const [search, setSearch] = useState('');
  const [showNewChannel, setShowNewChannel] = useState(false);
  const [showNewChat, setShowNewChat] = useState(false);
  // Track first company ID for creating channels/chats
  const [primaryCompanyId, setPrimaryCompanyId] = useState<string>('');

  // Sidebar width (horizontal resize)
  const [sidebarWidth, setSidebarWidth] = useState(360); // 360px = w-[360px] for better file browser visibility
  const sidebarWidthRef = useRef(360);
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
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  // Split ratio: percentage for channels panel (top), rest goes to conversations
  const [splitPct, setSplitPct] = useState(50);
  const dragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeChatRef = useRef(activeChat);
  activeChatRef.current = activeChat;

  useEffect(() => { loadData(); }, []);
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
            unread_count: Number(ch.unread_count || 0),
            favorite: Boolean(ch.favorite),
            lastActivity: ch.last_message ? Number(ch.last_message.time || 0) : 0,
            company_id: cid,
          });
        }
      }
      setPrimaryCompanyId(firstCompanyId);
      setChannels(sortChats(allChannels));
      onChannelsLoaded?.(sortChats(allChannels));

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
        return {
          type: 'conversation' as const,
          id: String(c.id),
          name,
          image,
          encrypted: Boolean(c.encrypted),
          unread_count: Number(c.unread_count || 0),
          favorite: Boolean(c.favorite || c.is_favorite),
          lastActivity,
        };
      });
      setConversations(sortChats(convTargets));
    } catch (err) {
      console.error('Failed to load sidebar data:', err);
    }
  }

  // Realtime: increment unread count for inactive chats when new message arrives
  useRealtimeEvents({
    message_sync: (data) => {
      const payload = data as Record<string, unknown>;
      const time = Number(payload.time || 0);
      const channelId = payload.channel_id && payload.channel_id !== 0 ? String(payload.channel_id) : null;
      const convId = payload.conversation_id && payload.conversation_id !== 0 ? String(payload.conversation_id) : null;
      const active = activeChatRef.current;

      if (channelId) {
        const isActive = active?.type === 'channel' && active.id === channelId;
        setChannels((prev) => sortChats(prev.map((ch) =>
          ch.id === channelId
            ? { ...ch, lastActivity: time || ch.lastActivity, unread_count: isActive ? 0 : (ch.unread_count ?? 0) + 1 }
            : ch
        )));
      } else if (convId) {
        const isActive = active?.type === 'conversation' && active.id === convId;
        setConversations((prev) => sortChats(prev.map((conv) =>
          conv.id === convId
            ? { ...conv, lastActivity: time || conv.lastActivity, unread_count: isActive ? 0 : (conv.unread_count ?? 0) + 1 }
            : conv
        )));
      }
    },
  }, loggedIn);

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
      setSplitPct(Math.min(80, Math.max(20, pct)));
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
      className="relative flex h-full shrink-0 flex-col bg-surface-50 dark:bg-surface-900"
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
        <div className="flex items-center gap-2 rounded-lg bg-surface-100 px-3 py-2 dark:bg-surface-800">
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
          <GripHorizontal size={16} className="text-surface-300 group-hover:text-surface-500 dark:text-surface-600 dark:group-hover:text-surface-500" />
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
                  unread_count: Number(c.unread_count || 0),
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
