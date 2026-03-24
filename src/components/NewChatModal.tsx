import { useState, useEffect, useRef } from 'react';
import { X, Search, MessageSquarePlus, Loader2, Check } from 'lucide-react';
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

const MAX_MEMBERS = 9;

export default function NewChatModal({ companyId, myUserId, onClose, onCreate }: NewChatModalProps) {
  const [query, setQuery] = useState('');
  const [allUsers, setAllUsers] = useState<RawUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [selected, setSelected] = useState<RawUser[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    setLoadingUsers(true);
    api.searchCompanyMembers(companyId, { limit: 50 })
      .then((result) => {
        setAllUsers((result.users as unknown as RawUser[]).filter((u) => String(u.id) !== myUserId));
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'Fehler beim Laden'))
      .finally(() => setLoadingUsers(false));
  }, [companyId, myUserId]);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setLoadingUsers(true);
      api.searchCompanyMembers(companyId, { search: query, limit: 50 })
        .then((result) => {
          setAllUsers((result.users as unknown as RawUser[]).filter((u) => String(u.id) !== myUserId));
        })
        .catch(() => {})
        .finally(() => setLoadingUsers(false));
    }, query ? 300 : 0);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [query, companyId, myUserId]);

  const toggleUser = (u: RawUser) => {
    const uid = String(u.id);
    setSelected((prev) => {
      const already = prev.some((s) => String(s.id) === uid);
      if (already) return prev.filter((s) => String(s.id) !== uid);
      if (prev.length >= MAX_MEMBERS) return prev;
      return [...prev, u];
    });
  };

  const handleCreate = async () => {
    if (selected.length === 0) return;
    setCreating(true);
    setError('');
    try {
      const memberIds = selected.map((u) => String(u.id));
      const conversation = await api.createConversation(memberIds);
      onCreate(conversation as Record<string, unknown>);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Erstellen');
      setCreating(false);
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

        {/* Selected chips */}
        {selected.length > 0 && (
          <div className="flex flex-wrap gap-1.5 border-b border-surface-100 px-4 py-2.5 dark:border-surface-800">
            {selected.map((u) => (
              <button
                key={String(u.id)}
                onClick={() => toggleUser(u)}
                className="flex items-center gap-1 rounded-full bg-primary-100 px-2 py-0.5 text-xs font-medium text-primary-800 hover:bg-primary-200 dark:bg-primary-900/40 dark:text-primary-300 dark:hover:bg-primary-900/60"
              >
                {userName(u)}
                <X size={11} />
              </button>
            ))}
            <span className="ml-auto self-center text-xs text-surface-400">{selected.length}/{MAX_MEMBERS}</span>
          </div>
        )}

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
          ) : error && selected.length === 0 ? (
            <p className="py-4 text-center text-sm text-red-500">{error}</p>
          ) : allUsers.length === 0 ? (
            <p className="py-6 text-center text-sm text-surface-400">
              {query ? 'Keine Treffer' : 'Keine Kontakte gefunden'}
            </p>
          ) : (
            allUsers.map((u) => {
              const uid = String(u.id);
              const name = userName(u);
              const isSelected = selected.some((s) => String(s.id) === uid);
              const isDisabled = !isSelected && selected.length >= MAX_MEMBERS;
              return (
                <button
                  key={uid}
                  onClick={() => toggleUser(u)}
                  disabled={isDisabled}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-surface-100 dark:hover:bg-surface-800 disabled:opacity-40"
                >
                  <div className="relative">
                    <Avatar name={name} image={u.image} size="sm" />
                    {isSelected && (
                      <div className="absolute -right-0.5 -top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-primary-600">
                        <Check size={10} className="text-white" />
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-surface-900 dark:text-surface-100">{name}</div>
                    {u.email && <div className="truncate text-xs text-surface-400">{u.email}</div>}
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-surface-200 px-4 py-3 dark:border-surface-700">
          {error && <p className="mb-2 text-xs text-red-500">{error}</p>}
          <button
            onClick={handleCreate}
            disabled={selected.length === 0 || creating}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-700 disabled:opacity-40"
          >
            {creating
              ? <><Loader2 size={16} className="animate-spin" /> Erstelle…</>
              : <><MessageSquarePlus size={16} />
                {selected.length <= 1
                  ? 'Direktnachricht starten'
                  : `Gruppe mit ${selected.length} Personen erstellen`}
              </>
            }
          </button>
        </div>
      </div>
    </div>
  );
}
