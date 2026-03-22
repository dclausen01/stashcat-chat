import { useState, useEffect, useRef } from 'react';
import { X, Search, MessageSquarePlus, Loader2 } from 'lucide-react';
import * as api from '../api';
import Avatar from './Avatar';

interface RawUser {
  id?: string | number;
  first_name?: string;
  last_name?: string;
  email?: string;
  image?: string;
}

interface NewChatModalProps {
  companyId: string;
  myUserId: string;
  onClose: () => void;
  onCreate: (conversation: Record<string, unknown>) => void;
}

function userName(u: RawUser): string {
  const name = `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim();
  return name || u.email || String(u.id ?? '?');
}

export default function NewChatModal({ companyId, myUserId, onClose, onCreate }: NewChatModalProps) {
  const [query, setQuery] = useState('');
  const [allUsers, setAllUsers] = useState<RawUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [creating, setCreating] = useState<string | null>(null);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    api.getCompanyMembers(companyId)
      .then((users) => {
        setAllUsers((users as RawUser[]).filter((u) => String(u.id) !== myUserId));
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Fehler beim Laden'))
      .finally(() => setLoadingUsers(false));
  }, [companyId, myUserId]);

  const filtered = allUsers.filter((u) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      u.first_name?.toLowerCase().includes(q) ||
      u.last_name?.toLowerCase().includes(q) ||
      u.email?.toLowerCase().includes(q)
    );
  });

  const handleCreate = async (u: RawUser) => {
    const uid = String(u.id);
    setCreating(uid);
    setError('');
    try {
      const conversation = await api.createConversation([uid]);
      onCreate(conversation as Record<string, unknown>);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Erstellen');
      setCreating(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex w-full max-w-md flex-col rounded-2xl bg-white shadow-2xl dark:bg-surface-900"
        style={{ maxHeight: '80vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-surface-200 px-5 py-4 dark:border-surface-700">
          <MessageSquarePlus size={18} className="text-primary-500" />
          <h2 className="flex-1 text-base font-semibold text-surface-900 dark:text-white">Neue Direktnachricht</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800">
            <X size={18} />
          </button>
        </div>

        {/* Search */}
        <div className="shrink-0 border-b border-surface-100 px-4 py-3 dark:border-surface-800">
          <div className="flex items-center gap-2 rounded-lg bg-surface-100 px-3 py-2 dark:bg-surface-800">
            <Search size={15} className="shrink-0 text-surface-400" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name oder E-Mail suchen…"
              className="w-full bg-transparent text-sm text-surface-900 outline-none placeholder:text-surface-400 dark:text-white"
            />
          </div>
        </div>

        {/* User list */}
        <div className="flex-1 overflow-y-auto p-2">
          {loadingUsers ? (
            <div className="flex justify-center py-8">
              <Loader2 size={24} className="animate-spin text-primary-400" />
            </div>
          ) : error ? (
            <p className="py-4 text-center text-sm text-red-500">{error}</p>
          ) : filtered.length === 0 ? (
            <p className="py-6 text-center text-sm text-surface-400">
              {query ? 'Keine Treffer' : 'Keine Kontakte gefunden'}
            </p>
          ) : (
            filtered.map((u) => {
              const uid = String(u.id);
              const name = userName(u);
              return (
                <button
                  key={uid}
                  onClick={() => handleCreate(u)}
                  disabled={creating === uid}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-surface-100 dark:hover:bg-surface-800 disabled:opacity-50"
                >
                  <Avatar name={name} image={u.image} size="sm" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-surface-900 dark:text-surface-100">{name}</div>
                    {u.email && <div className="truncate text-xs text-surface-400">{u.email}</div>}
                  </div>
                  {creating === uid
                    ? <Loader2 size={16} className="shrink-0 animate-spin text-primary-400" />
                    : <MessageSquarePlus size={16} className="shrink-0 text-surface-300 group-hover:text-primary-500" />}
                </button>
              );
            })
          )}
        </div>

        {error && creating === null && (
          <div className="shrink-0 border-t border-surface-200 px-4 py-2 dark:border-surface-700">
            <p className="text-xs text-red-500">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
}
