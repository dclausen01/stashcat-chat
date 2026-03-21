import { useState, useEffect } from 'react';
import { Hash, MessageCircle, ChevronDown, ChevronRight, Star, Search, LogOut, Sun, Moon, Users } from 'lucide-react';
import { clsx } from 'clsx';
import * as api from '../api';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import Avatar from './Avatar';
import type { ChatTarget } from '../types';

interface SidebarProps {
  activeChat: ChatTarget | null;
  onSelectChat: (target: ChatTarget) => void;
}

export default function Sidebar({ activeChat, onSelectChat }: SidebarProps) {
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const [channels, setChannels] = useState<ChatTarget[]>([]);
  const [conversations, setConversations] = useState<ChatTarget[]>([]);
  const [channelsOpen, setChannelsOpen] = useState(true);
  const [conversationsOpen, setConversationsOpen] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    try {
      const [companyRes, convRes] = await Promise.all([
        api.getCompanies(),
        api.getConversations(),
      ]);

      // Load channels for each company
      const allChannels: ChatTarget[] = [];
      for (const company of companyRes.companies) {
        const chRes = await api.getChannels(String(company.id));
        for (const ch of chRes.channels) {
          allChannels.push({
            type: 'channel',
            id: String(ch.id),
            name: String(ch.name || ''),
            encrypted: Boolean(ch.encrypted),
            unread_count: Number(ch.unread_count || 0),
          });
        }
      }
      setChannels(allChannels);

      const convTargets: ChatTarget[] = convRes.conversations.map((c) => {
        const members = (c.members as Array<Record<string, unknown>>) || [];
        const otherMembers = members.filter((m) => String(m.id) !== String((user as Record<string, unknown>)?.id));
        const name = otherMembers.length > 0
          ? otherMembers.map((m) => `${m.first_name} ${m.last_name}`).join(', ')
          : 'Eigene Notizen';
        return {
          type: 'conversation' as const,
          id: String(c.id),
          name,
          encrypted: Boolean(c.encrypted),
          unread_count: Number(c.unread_count || 0),
        };
      });
      setConversations(convTargets);
    } catch (err) {
      console.error('Failed to load sidebar data:', err);
    }
  }

  const filtered = (items: ChatTarget[]) => {
    if (!search) return items;
    const q = search.toLowerCase();
    return items.filter((i) => i.name.toLowerCase().includes(q));
  };

  const userName = user
    ? `${(user as Record<string, unknown>).first_name} ${(user as Record<string, unknown>).last_name}`
    : '';

  return (
    <div className="flex h-full w-72 flex-col border-r border-surface-200 bg-surface-50 dark:border-surface-700 dark:bg-surface-900">
      {/* User header */}
      <div className="flex items-center gap-3 border-b border-surface-200 p-4 dark:border-surface-700">
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
      <div className="p-3">
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

      {/* Chat lists */}
      <div className="flex-1 overflow-y-auto px-2">
        {/* Channels */}
        <button
          onClick={() => setChannelsOpen(!channelsOpen)}
          className="flex w-full items-center gap-1 px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-surface-500 hover:text-surface-700 dark:hover:text-surface-300"
        >
          {channelsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <Hash size={14} />
          Channels ({channels.length})
        </button>
        {channelsOpen && filtered(channels).map((ch) => (
          <ChatItem key={`ch-${ch.id}`} target={ch} active={activeChat?.id === ch.id && activeChat?.type === 'channel'} onSelect={onSelectChat} />
        ))}

        {/* Conversations */}
        <button
          onClick={() => setConversationsOpen(!conversationsOpen)}
          className="mt-3 flex w-full items-center gap-1 px-2 py-1.5 text-xs font-semibold uppercase tracking-wider text-surface-500 hover:text-surface-700 dark:hover:text-surface-300"
        >
          {conversationsOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <Users size={14} />
          Direktnachrichten ({conversations.length})
        </button>
        {conversationsOpen && filtered(conversations).map((conv) => (
          <ChatItem key={`conv-${conv.id}`} target={conv} active={activeChat?.id === conv.id && activeChat?.type === 'conversation'} onSelect={onSelectChat} />
        ))}
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
        <Hash size={18} className={clsx(active ? 'text-primary-600 dark:text-primary-400' : 'text-surface-400')} />
      ) : (
        <Avatar name={target.name} size="sm" />
      )}
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{target.name}</span>
      {target.encrypted && (
        <span className="text-xs text-surface-400" title="Verschlüsselt">🔒</span>
      )}
      {(target.unread_count ?? 0) > 0 && (
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary-600 px-1.5 text-xs font-bold text-white">
          {target.unread_count}
        </span>
      )}
      {target.type === 'channel' && <Star size={14} className="hidden text-surface-300 group-hover:block" />}
    </button>
  );
}
