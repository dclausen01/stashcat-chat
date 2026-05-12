import { useEffect, useState } from 'react';
import { Forward, X, Search, Loader2, Hash } from 'lucide-react';
import * as api from '../../api';
import Avatar from '../Avatar';
import { getCleanName } from '../../utils/subchannels';
import type { Message } from '../../types';

export function ForwardDialog({ message, onClose }: { message: Message; onClose: () => void }) {
  const [targets, setTargets] = useState<Array<{ id: string; name: string; type: 'channel' | 'conversation'; image?: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [forwarding, setForwarding] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [companies, convos] = await Promise.all([
          api.getCompanies(),
          api.getConversations(),
        ]);
        const all: typeof targets = [];
        if (companies.length > 0) {
          const chans = await api.getChannels(String(companies[0].id));
          for (const ch of chans) {
            all.push({ id: String(ch.id), name: getCleanName(String(ch.name ?? '')), type: 'channel', image: ch.image ? String(ch.image) : undefined });
          }
        }
        for (const c of convos) {
          const members = c.members;
          const name = members?.map((m) => `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim()).join(', ') || `Konversation ${c.id}`;
          all.push({ id: String(c.id), name, type: 'conversation', image: undefined });
        }
        setTargets(all);
      } catch (err) {
        console.error('Failed to load forward targets:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = targets.filter((t) => {
    if (!filter) return true;
    return t.name.toLowerCase().includes(filter.toLowerCase());
  });

  const handleForward = async (target: typeof targets[0]) => {
    setForwarding(target.id);
    try {
      const text = message.text || '';
      const fileIds = message.files?.map((f) => String(f.id)).filter(Boolean);
      const opts: { is_forwarded?: boolean; files?: string[] } = { is_forwarded: true };
      if (fileIds && fileIds.length > 0) {
        opts.files = fileIds;
      }
      await api.sendMessage(target.id, target.type, text, opts);
      onClose();
    } catch (err) {
      alert(`Weiterleiten fehlgeschlagen: ${err instanceof Error ? err.message : err}`);
    } finally {
      setForwarding(null);
    }
  };

  const preview = (message.text || '').slice(0, 100) + ((message.text || '').length > 100 ? '...' : '');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="relative flex w-full max-w-sm flex-col rounded-2xl bg-white shadow-2xl dark:bg-surface-900" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-surface-200 px-5 py-4 dark:border-surface-700">
          <Forward size={18} className="shrink-0 text-primary-500" />
          <h2 className="flex-1 text-sm font-semibold text-surface-900 dark:text-white">Nachricht weiterleiten</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-surface-600 hover:bg-surface-200 dark:hover:bg-surface-800">
            <X size={16} />
          </button>
        </div>

        {preview && (
          <div className="border-b border-surface-200 px-5 py-3 dark:border-surface-700">
            <div className="rounded-lg bg-surface-50 px-3 py-2 text-xs text-surface-600 dark:bg-surface-800 dark:text-surface-400">
              {preview}
            </div>
          </div>
        )}

        <div className="px-5 pt-3">
          <div className="flex items-center gap-2 rounded-lg bg-surface-100 px-3 py-2 dark:bg-surface-800">
            <Search size={14} className="shrink-0 text-surface-600" />
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Channel oder Konversation suchen..."
              autoFocus
              className="w-full bg-transparent text-sm text-surface-900 outline-none placeholder:text-surface-600 dark:text-white"
            />
          </div>
        </div>

        <div className="max-h-64 overflow-y-auto px-3 py-2">
          {loading ? (
            <div className="flex justify-center py-6"><Loader2 size={20} className="animate-spin text-primary-400" /></div>
          ) : filtered.length === 0 ? (
            <p className="py-4 text-center text-xs text-surface-600">Keine Ziele gefunden</p>
          ) : (
            filtered.map((t) => (
              <button
                key={`${t.type}-${t.id}`}
                onClick={() => handleForward(t)}
                disabled={forwarding === t.id}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-2 hover:bg-surface-200 disabled:opacity-50 dark:hover:bg-surface-800"
              >
                {t.type === 'channel' ? (
                  t.image ? <Avatar name={t.name} image={t.image} size="xs" /> : <Hash size={14} className="shrink-0 text-surface-600" />
                ) : (
                  <Avatar name={t.name} size="xs" />
                )}
                <span className="min-w-0 flex-1 truncate text-left text-sm text-surface-800 dark:text-surface-200">{t.name}</span>
                <span className="shrink-0 text-[10px] uppercase text-surface-600">{t.type === 'channel' ? 'Channel' : 'Chat'}</span>
                {forwarding === t.id && <Loader2 size={14} className="shrink-0 animate-spin text-primary-400" />}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
