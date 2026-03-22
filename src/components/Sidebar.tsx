import { useState, useEffect, useRef, useCallback } from 'react';
import { Hash, Search, LogOut, Sun, Moon, Users, GripHorizontal, Star } from 'lucide-react';
import { clsx } from 'clsx';
import * as api from '../api';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useRealtimeEvents } from '../hooks/useRealtimeEvents';
import Avatar from './Avatar';
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
}

export default function Sidebar({ activeChat, onSelectChat, loggedIn }: SidebarProps) {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const [channels, setChannels] = useState<ChatTarget[]>([]);
  const [conversations, setConversations] = useState<ChatTarget[]>([]);
  const [search, setSearch] = useState('');

  // Split ratio: percentage for channels panel (top), rest goes to conversations
  const [splitPct, setSplitPct] = useState(50);
  const dragging = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeChatRef = useRef(activeChat);
  activeChatRef.current = activeChat;

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    try {
      const [companies, convList] = await Promise.all([
        api.getCompanies(),
        api.getConversations(),
      ]);

      const allChannels: ChatTarget[] = [];
      for (const company of (companies as Array<Record<string, unknown>>)) {
        const channelList = await api.getChannels(String(company.id));
        for (const ch of (channelList as Array<Record<string, unknown>>)) {
          const lastMsg = ch.last_message as Record<string, unknown> | undefined;
          allChannels.push({
            type: 'channel',
            id: String(ch.id),
            name: String(ch.name || ''),
            description: ch.description ? String(ch.description) : undefined,
            image: ch.image ? String(ch.image) : undefined,
            encrypted: Boolean(ch.encrypted),
            unread_count: Number(ch.unread_count || 0),
            favorite: Boolean(ch.favorite),
            lastActivity: lastMsg ? Number(lastMsg.time || 0) : 0,
          });
        }
      }
      setChannels(sortChats(allChannels));

      const convTargets: ChatTarget[] = (convList as Array<Record<string, unknown>>).map((c) => {
        const members = (c.members as Array<Record<string, unknown>>) || [];
        const userId = String((user as Record<string, unknown>)?.id);
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

  const filtered = (items: ChatTarget[]) => {
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter((i) => i.name.toLowerCase().includes(q));
  };

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

  const userName = user
    ? `${(user as Record<string, unknown>).first_name} ${(user as Record<string, unknown>).last_name}`
    : '';

  return (
    <div className="flex h-full w-72 shrink-0 flex-col border-r border-surface-200 bg-surface-50 dark:border-surface-700 dark:bg-surface-900">
      {/* User header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-surface-200 p-4 dark:border-surface-700">
        <Avatar name={userName} size="md" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-surface-900 dark:text-white">{userName}</div>
          <div className="truncate text-xs text-surface-500">Online</div>
        </div>
        <button onClick={toggle} className="rounded-lg p-1.5 text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700">
          {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
        </button>
        <button onClick={logout} className="rounded-lg p-1.5 text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700">
          <LogOut size={18} />
        </button>
      </div>

      {/* Search */}
      <div className="shrink-0 p-3">
        <div className="flex items-center gap-2 rounded-lg bg-surface-100 px-3 py-2 dark:bg-surface-800">
          <Search size={16} className="text-surface-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Suchen..."
            className="w-full bg-transparent text-sm text-surface-900 outline-none placeholder:text-surface-400 dark:text-white"
          />
        </div>
      </div>

      {/* Split panels */}
      <div ref={containerRef} className="flex min-h-0 flex-1 flex-col">
        {/* Channels panel */}
        <div className="flex min-h-0 flex-col" style={{ height: `${splitPct}%` }}>
          <div className="shrink-0 px-4 py-1.5">
            <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-surface-500">
              <Hash size={13} /> Channels ({filtered(channels).length})
            </span>
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-1">
            {filtered(channels).map((ch) => (
              <ChatItem
                key={`ch-${ch.id}`}
                target={ch}
                active={activeChat?.id === ch.id && activeChat?.type === 'channel'}
                onSelect={handleSelect}
              />
            ))}
          </div>
        </div>

        {/* Drag handle */}
        <div
          onMouseDown={onMouseDown}
          className="group flex shrink-0 cursor-row-resize items-center justify-center border-y border-surface-200 py-0.5 hover:bg-surface-100 dark:border-surface-700 dark:hover:bg-surface-800"
        >
          <GripHorizontal size={16} className="text-surface-300 group-hover:text-surface-500 dark:text-surface-600 dark:group-hover:text-surface-400" />
        </div>

        {/* Conversations panel */}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 px-4 py-1.5">
            <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-surface-500">
              <Users size={13} /> Direktnachrichten ({filtered(conversations).length})
            </span>
          </div>
          <div className="flex-1 overflow-y-auto px-2 pb-1">
            {filtered(conversations).map((conv) => (
              <ChatItem
                key={`conv-${conv.id}`}
                target={conv}
                active={activeChat?.id === conv.id && activeChat?.type === 'conversation'}
                onSelect={handleSelect}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ChatItem({ target, active, onSelect }: { target: ChatTarget; active: boolean; onSelect: (t: ChatTarget) => void }) {
  return (
    <button
      onClick={() => onSelect(target)}
      className={clsx(
        'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition',
        active
          ? 'bg-primary-100 text-primary-900 dark:bg-primary-900/30 dark:text-primary-200'
          : 'text-surface-700 hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-800',
      )}
    >
      {target.type === 'channel' ? (
        target.image
          ? <Avatar name={target.name} image={target.image} size="sm" />
          : <Hash size={17} className={clsx('shrink-0', active ? 'text-primary-600 dark:text-primary-400' : 'text-surface-400')} />
      ) : (
        <Avatar name={target.name} image={target.image} size="sm" />
      )}
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{target.name}</span>
      {target.favorite && <Star size={13} className="shrink-0 fill-yellow-400 text-yellow-400" />}
      {target.encrypted && <span className="shrink-0 text-xs text-surface-400" title="Verschlüsselt">🔒</span>}
      {(target.unread_count ?? 0) > 0 && (
        <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary-600 px-1.5 text-xs font-bold text-white">
          {target.unread_count}
        </span>
      )}
    </button>
  );
}
