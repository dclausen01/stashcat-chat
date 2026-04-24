import { useState, useEffect, useRef } from 'react';
import { X, Search, Loader2, Send } from 'lucide-react';
import * as api from '../api';
import { clsx } from 'clsx';
import type { Channel, Conversation } from '../types';

interface FileEntry {
  id: string;
  name: string;
}

interface ShareToChatModalProps {
  file: FileEntry;
  onClose: () => void;
}

interface ChatOption {
  type: 'channel' | 'conversation';
  id: string;
  name: string;
}

export default function ShareToChatModal({ file, onClose }: ShareToChatModalProps) {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<ChatOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [sharedTo, setSharedTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    async function load() {
      try {
        const companies = await api.getCompanies();
        const companyId = companies[0]?.id ? String(companies[0].id) : '';
        const [channelList, convList] = await Promise.all([
          companyId ? api.getChannels(companyId) : Promise.resolve([]),
          api.getConversations(),
        ]);
        const channelOptions: ChatOption[] = (channelList as Channel[]).map((c) => ({
          type: 'channel',
          id: String(c.id),
          name: c.name || c.id,
        }));
        const convOptions: ChatOption[] = (convList as Conversation[]).map((c) => {
          const members = (c as { members?: Array<{ first_name?: string; last_name?: string }> }).members;
          const memberNames = members?.map(m => [m.first_name, m.last_name].filter(Boolean).join(' ')).join(', ') || String(c.id);
          return { type: 'conversation', id: String(c.id), name: memberNames };
        });
        setOptions([...channelOptions, ...convOptions]);
      } catch {
        setError('Fehler beim Laden der Chats.');
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const filtered = query.trim()
    ? options.filter(o => o.name.toLowerCase().includes(query.toLowerCase()))
    : options;

  async function handleShare(target: ChatOption) {
    setSharing(true);
    setError(null);
    try {
      const { url } = await api.ncShare(file.id);
      await api.sendMessage(target.id, target.type as 'channel' | 'conversation', `📎 ${file.name}\n${url}`);
      setSharedTo(target.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Teilen.');
    } finally {
      setSharing(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-80 max-h-[70vh] flex flex-col rounded-xl border border-surface-200 bg-surface-50 shadow-xl dark:border-surface-700 dark:bg-surface-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center gap-2 border-b border-surface-200 px-4 py-3 dark:border-surface-700">
          <Send size={16} className="text-teal-600 dark:text-teal-400" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-surface-900 dark:text-white">In Chat teilen</p>
            <p className="text-xs text-surface-500 truncate">{file.name}</p>
          </div>
          <button onClick={onClose} className="rounded-md p-1 text-surface-500 hover:bg-surface-200 dark:hover:bg-surface-700">
            <X size={16} />
          </button>
        </div>

        {/* Success state */}
        {sharedTo && (
          <div className="p-4 text-center">
            <p className="text-sm font-medium text-teal-700 dark:text-teal-300">
              Geteilt in „{sharedTo}"
            </p>
            <button
              onClick={onClose}
              className="mt-3 rounded-lg bg-teal-600 px-4 py-1.5 text-sm text-white hover:bg-teal-700"
            >
              Schließen
            </button>
          </div>
        )}

        {/* Search + list */}
        {!sharedTo && (
          <>
            <div className="shrink-0 border-b border-surface-100 px-3 py-2 dark:border-surface-800">
              <div className="flex items-center gap-2 rounded-lg border border-surface-200 bg-white px-2 py-1.5 dark:border-surface-700 dark:bg-surface-800">
                <Search size={14} className="text-surface-400" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Chat suchen…"
                  className="flex-1 bg-transparent text-sm outline-none text-surface-900 dark:text-surface-100 placeholder:text-surface-400"
                />
              </div>
            </div>

            {error && (
              <p className="px-4 py-2 text-xs text-red-500">{error}</p>
            )}

            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="flex h-24 items-center justify-center">
                  <Loader2 size={20} className="animate-spin text-surface-400" />
                </div>
              ) : filtered.length === 0 ? (
                <p className="py-8 text-center text-xs text-surface-500">Keine Chats gefunden.</p>
              ) : (
                filtered.map((opt) => (
                  <button
                    key={`${opt.type}:${opt.id}`}
                    disabled={sharing}
                    onClick={() => handleShare(opt)}
                    className={clsx(
                      'flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm transition hover:bg-surface-100 dark:hover:bg-surface-800',
                      sharing && 'opacity-50 cursor-wait',
                    )}
                  >
                    <span className={clsx('text-[10px] font-medium px-1 py-0.5 rounded uppercase tracking-wide',
                      opt.type === 'channel'
                        ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/40 dark:text-primary-300'
                        : 'bg-surface-200 text-surface-600 dark:bg-surface-700 dark:text-surface-400',
                    )}>
                      {opt.type === 'channel' ? 'CH' : 'DM'}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-surface-800 dark:text-surface-200">{opt.name}</span>
                    {sharing ? <Loader2 size={13} className="animate-spin text-surface-400" /> : <Send size={13} className="text-surface-400" />}
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
