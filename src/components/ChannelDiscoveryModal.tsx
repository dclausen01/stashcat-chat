import { useState, useEffect } from 'react';
import { Hash, Search, X, Loader2, Users, LogIn } from 'lucide-react';
import { FocusTrap } from 'focus-trap-react';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { clsx } from 'clsx';
import * as api from '../api';
import Avatar from './Avatar';

interface ChannelDiscoveryModalProps {
  companyId: string;
  subscribedIds: Set<string>;
  onClose: () => void;
  onJoined: (channel: Record<string, unknown>) => void;
}

interface VisibleChannel {
  id: string;
  name: string;
  description?: string;
  image?: string;
  encrypted?: boolean;
  member_count?: number;
  visible?: boolean;
}

export default function ChannelDiscoveryModal({ companyId, subscribedIds, onClose, onJoined }: ChannelDiscoveryModalProps) {
  useEscapeKey(onClose);
  const [channels, setChannels] = useState<VisibleChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [joining, setJoining] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const data = await api.getVisibleChannels(companyId);
        setChannels(
          data.map((ch) => ({
            id: String(ch.id),
            name: String(ch.name || ''),
            description: ch.description ? String(ch.description) : undefined,
            image: ch.image ? String(ch.image) : undefined,
            encrypted: Boolean(ch.encrypted),
            member_count: ch.member_count ? Number(ch.member_count) : undefined,
          })),
        );
      } catch (err) {
        console.error('Failed to load visible channels:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, [companyId]);

  const filtered = channels.filter((ch) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return ch.name.toLowerCase().includes(q) || ch.description?.toLowerCase().includes(q);
  });

  const handleJoin = async (ch: VisibleChannel) => {
    setJoining(ch.id);
    try {
      await api.joinChannel(ch.id);
      onJoined({ id: ch.id, name: ch.name, description: ch.description, image: ch.image, encrypted: ch.encrypted });
    } catch (err) {
      console.error('Failed to join channel:', err);
    } finally {
      setJoining(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <FocusTrap focusTrapOptions={{ escapeDeactivates: false, allowOutsideClick: true }}>
      <div
        className="relative flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-2xl dark:bg-surface-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-surface-200 px-5 py-4 dark:border-surface-700">
          <Hash size={20} className="text-primary-500" />
          <h2 className="flex-1 text-lg font-semibold text-surface-900 dark:text-white">Channels entdecken</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-surface-500 hover:bg-surface-200 dark:hover:bg-surface-800">
            <X size={18} />
          </button>
        </div>

        {/* Search */}
        <div className="border-b border-surface-200 px-5 py-3 dark:border-surface-700">
          <div className="flex items-center gap-2 rounded-lg bg-surface-100 px-3 py-2 dark:bg-surface-800">
            <Search size={16} className="text-surface-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Channel suchen..."
              className="w-full bg-transparent text-sm text-surface-900 outline-none placeholder:text-surface-500 dark:text-white"
              autoFocus
            />
          </div>
        </div>

        {/* Channel list */}
        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 size={24} className="animate-spin text-primary-400" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="py-8 text-center text-sm text-surface-500">
              {search ? 'Keine Channels gefunden' : 'Keine sichtbaren Channels'}
            </div>
          ) : (
            filtered.map((ch) => {
              const alreadyJoined = subscribedIds.has(ch.id);
              return (
                <div
                  key={ch.id}
                  className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition hover:bg-surface-50 dark:hover:bg-surface-800/50"
                >
                  {ch.image ? (
                    <Avatar name={ch.name} image={ch.image} size="sm" />
                  ) : (
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-100 dark:bg-surface-800">
                      <Hash size={16} className="text-surface-500" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium text-surface-900 dark:text-white">{ch.name}</span>
                    </div>
                    {ch.description && (
                      <p className="truncate text-xs text-surface-500">{ch.description}</p>
                    )}
                    {ch.member_count !== undefined && (
                      <span className="flex items-center gap-1 text-xs text-surface-500">
                        <Users size={11} /> {ch.member_count}
                      </span>
                    )}
                  </div>
                  {alreadyJoined ? (
                    <span className="shrink-0 rounded-lg bg-surface-100 px-3 py-1.5 text-xs font-medium text-surface-500 dark:bg-surface-800">
                      Beigetreten
                    </span>
                  ) : (
                    <button
                      onClick={() => handleJoin(ch)}
                      disabled={joining === ch.id}
                      className={clsx(
                        'flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition',
                        'bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50',
                      )}
                    >
                      {joining === ch.id ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <LogIn size={13} />
                      )}
                      Beitreten
                    </button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
      </FocusTrap>
    </div>
  );
}
