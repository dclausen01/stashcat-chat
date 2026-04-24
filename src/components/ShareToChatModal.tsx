import { useState, useEffect, useRef } from 'react';
import { X, Search, Loader2, Send, Link2, Paperclip, KeyRound, RefreshCw } from 'lucide-react';
import * as api from '../api';
import { clsx } from 'clsx';
import type { Channel, Conversation } from '../types';

interface ShareToChatModalProps {
  file: {
    id: string;
    name: string;
    /** Nextcloud path (same as id for NC files) */
    path?: string;
  };
  onClose: () => void;
}

type ShareMode = 'link' | 'attach';

interface ChatOption {
  type: 'channel' | 'conversation';
  id: string;
  name: string;
}

/** Generate a short random password: 10 chars, letters + digits only */
function generatePassword(): string {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let pw = '';
  for (let i = 0; i < 10; i++) {
    pw += chars[Math.floor(Math.random() * chars.length)];
  }
  return pw;
}

export default function ShareToChatModal({ file, onClose }: ShareToChatModalProps) {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<ChatOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);
  const [sharedTo, setSharedTo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ShareMode>('link');
  const inputRef = useRef<HTMLInputElement>(null);

  // Share password state
  const [useAutoPassword, setUseAutoPassword] = useState(true);
  const [sharePassword, setSharePassword] = useState(() => generatePassword());

  // Use path if available, fall back to id (for Nextcloud files these are the same)
  const ncPath = file.path ?? file.id;

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
      if (mode === 'link') {
        const { url } = await api.ncShare(ncPath, sharePassword);
        const passwordLine = sharePassword ? `\n🔑 Passwort: ${sharePassword}` : '';
        await api.sendMessage(target.id, target.type, `📎 ${file.name}\n🔗 ${url}${passwordLine}`);
      } else {
        // Download file from Nextcloud, then upload + send to chat
        const url = api.ncDownloadUrl(ncPath);
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Download fehlgeschlagen: ${response.status}`);
        const blob = await response.blob();
        const contentType = response.headers.get('content-type') || 'application/octet-stream';
        const fileToUpload = new File([blob], file.name, { type: contentType });
        await api.uploadFile(target.type, target.id, fileToUpload);
      }
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
            {/* Mode toggle */}
            <div className="flex shrink-0 gap-1 border-b border-surface-100 px-3 py-2 dark:border-surface-800">
              <button
                onClick={() => setMode('link')}
                className={clsx(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition',
                  mode === 'link'
                    ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300'
                    : 'text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800',
                )}
              >
                <Link2 size={13} />
                Öffentlicher Link
              </button>
              <button
                onClick={() => setMode('attach')}
                className={clsx(
                  'flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium transition',
                  mode === 'attach'
                    ? 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300'
                    : 'text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800',
                )}
              >
                <Paperclip size={13} />
                Datei anhängen
              </button>
            </div>

            {/* Mode hint */}
            <div className="shrink-0 border-b border-surface-100 px-3 py-1.5 dark:border-surface-800">
              <p className="text-[10px] text-surface-500">
                {mode === 'link'
                  ? 'Erstellt einen Nextcloud-Freigabelink'
                  : 'Datei wird hochgeladen und angehängt'}
              </p>
            </div>

            {/* Password row — only in link mode */}
            {mode === 'link' && (
              <div className="shrink-0 border-b border-surface-100 px-3 py-2 dark:border-surface-800">
                <div className="flex items-center gap-2 mb-1.5">
                  <KeyRound size={11} className="text-surface-400" />
                  <span className="text-[10px] font-medium text-surface-500">Link-Passwort</span>
                </div>
                <div className="flex gap-1.5 mb-1.5">
                  <button
                    onClick={() => { setUseAutoPassword(true); setSharePassword(generatePassword()); }}
                    className={clsx(
                      'flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition',
                      useAutoPassword
                        ? 'bg-teal-600 text-white'
                        : 'bg-surface-200 text-surface-600 dark:bg-surface-700 dark:text-surface-400 hover:bg-surface-300 dark:hover:bg-surface-600',
                    )}
                  >
                    Auto
                  </button>
                  <button
                    onClick={() => setUseAutoPassword(false)}
                    className={clsx(
                      'flex-1 rounded-md px-2 py-1 text-[11px] font-medium transition',
                      !useAutoPassword
                        ? 'bg-teal-600 text-white'
                        : 'bg-surface-200 text-surface-600 dark:bg-surface-700 dark:text-surface-400 hover:bg-surface-300 dark:hover:bg-surface-600',
                    )}
                  >
                    Eigenes
                  </button>
                  {!useAutoPassword && (
                    <button
                      onClick={() => setSharePassword(generatePassword())}
                      className="rounded-md p-1.5 text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700"
                      title="Auto generieren"
                    >
                      <RefreshCw size={11} />
                    </button>
                  )}
                </div>
                {useAutoPassword ? (
                  <div className="flex items-center gap-2 rounded-md bg-surface-100 px-3 py-1.5 dark:bg-surface-800">
                    <span className="flex-1 font-mono text-sm font-semibold tracking-widest text-surface-700 dark:text-surface-200">
                      {sharePassword}
                    </span>
                    <button
                      onClick={() => setSharePassword(generatePassword())}
                      className="rounded p-1 text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700"
                      title="Neu generieren"
                    >
                      <RefreshCw size={12} />
                    </button>
                  </div>
                ) : (
                  <input
                    type="text"
                    value={sharePassword}
                    onChange={(e) => setSharePassword(e.target.value)}
                    placeholder="Passwort eingeben"
                    className="w-full rounded-md border border-surface-300 bg-white px-2 py-1 text-xs outline-none focus:border-teal-500 dark:border-surface-600 dark:bg-surface-900 dark:text-surface-100 dark:placeholder-surface-500"
                  />
                )}
              </div>
            )}

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
                    disabled={sharing || (mode === 'link' && !sharePassword.trim())}
                    onClick={() => handleShare(opt)}
                    className={clsx(
                      'flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm transition hover:bg-surface-100 dark:hover:bg-surface-800',
                      (sharing || (mode === 'link' && !sharePassword.trim())) && 'opacity-50 cursor-wait',
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
