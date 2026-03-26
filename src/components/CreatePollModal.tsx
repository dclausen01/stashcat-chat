import { useState, useEffect } from 'react';
import { X, Plus, Trash2, Loader2, ChevronDown, ChevronUp, BarChart3, Search } from 'lucide-react';
import { clsx } from 'clsx';
import * as api from '../api';
import type { ChatTarget } from '../types';

interface Question {
  name: string;
  answer_limit: number; // 1 = single choice, 0 = multi choice
  answers: string[];
}

interface Props {
  /** Pre-selected chat (from paperclip button) */
  preselectedChat?: ChatTarget;
  onClose: () => void;
  onCreated?: (id: string) => void;
}

interface ChatOption {
  id: string;
  name: string;
  type: 'channel' | 'conversation';
}

const DEFAULT_QUESTION: Question = { name: '', answer_limit: 1, answers: ['', ''] };

function today(): string {
  return new Date().toISOString().slice(0, 10);
}
function inTwoWeeks(): string {
  const d = new Date();
  d.setDate(d.getDate() + 14);
  return d.toISOString().slice(0, 10);
}
function dateToTs(dateStr: string): number {
  return Math.floor(new Date(dateStr).getTime() / 1000);
}

export default function CreatePollModal({ preselectedChat, onClose, onCreated }: Props) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [startDate, setStartDate] = useState(today());
  const [endDate, setEndDate] = useState(inTwoWeeks());
  const [privacyType, setPrivacyType] = useState<'open' | 'hidden' | 'anonymous'>('open');
  const [hiddenResults, setHiddenResults] = useState(false);
  const [questions, setQuestions] = useState<Question[]>([{ ...DEFAULT_QUESTION, answers: ['', ''] }]);

  const [chatOptions, setChatOptions] = useState<ChatOption[]>([]);
  const [selectedChats, setSelectedChats] = useState<Set<string>>(new Set());
  const [chatSearch, setChatSearch] = useState('');
  const [loadingChats, setLoadingChats] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Load available channels and conversations for targeting
  useEffect(() => {
    async function load() {
      try {
        const [companies, convs] = await Promise.all([
          api.getCompanies(),
          api.getConversations(100, 0).catch(() => [] as Record<string, unknown>[]),
        ]);
        const opts: ChatOption[] = [];

        // Channels from first company
        if (companies.length > 0) {
          const companyId = String((companies[0] as Record<string, unknown>).id ?? '');
          const channels = await api.getChannels(companyId).catch(() => [] as Record<string, unknown>[]);
          for (const ch of channels) {
            opts.push({ id: String((ch as Record<string, unknown>).id), name: String((ch as Record<string, unknown>).name ?? ''), type: 'channel' });
          }
        }

        // Conversations
        for (const c of convs) {
          const raw = c as Record<string, unknown>;
          if (!raw.id) continue;
          opts.push({ id: String(raw.id), name: String(raw.name ?? raw.title ?? `Konversation ${raw.id}`), type: 'conversation' });
        }

        setChatOptions(opts);

        // Pre-select if coming from chat
        if (preselectedChat) {
          setSelectedChats(new Set([preselectedChat.id]));
        }
      } catch {
        // ignore
      } finally {
        setLoadingChats(false);
      }
    }
    load();
  }, [preselectedChat]);

  // --- Question helpers ---
  function updateQuestion(qi: number, patch: Partial<Question>) {
    setQuestions((prev) => prev.map((q, i) => i === qi ? { ...q, ...patch } : q));
  }
  function updateAnswer(qi: number, ai: number, value: string) {
    setQuestions((prev) => prev.map((q, i) => {
      if (i !== qi) return q;
      const answers = [...q.answers];
      answers[ai] = value;
      return { ...q, answers };
    }));
  }
  function addAnswer(qi: number) {
    setQuestions((prev) => prev.map((q, i) => i === qi ? { ...q, answers: [...q.answers, ''] } : q));
  }
  function removeAnswer(qi: number, ai: number) {
    setQuestions((prev) => prev.map((q, i) => {
      if (i !== qi) return q;
      const answers = q.answers.filter((_, j) => j !== ai);
      return { ...q, answers: answers.length >= 2 ? answers : q.answers };
    }));
  }
  function addQuestion() {
    setQuestions((prev) => [...prev, { name: '', answer_limit: 1, answers: ['', ''] }]);
  }
  function removeQuestion(qi: number) {
    if (questions.length <= 1) return;
    setQuestions((prev) => prev.filter((_, i) => i !== qi));
  }
  function moveQuestion(qi: number, dir: -1 | 1) {
    setQuestions((prev) => {
      const arr = [...prev];
      const target = qi + dir;
      if (target < 0 || target >= arr.length) return prev;
      [arr[qi], arr[target]] = [arr[target], arr[qi]];
      return arr;
    });
  }

  // --- Chat selection ---
  function toggleChat(id: string) {
    setSelectedChats((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // --- Submit ---
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (!name.trim()) { setError('Bitte einen Titel eingeben.'); return; }
    if (dateToTs(startDate) >= dateToTs(endDate)) { setError('Enddatum muss nach dem Startdatum liegen.'); return; }
    for (const q of questions) {
      if (!q.name.trim()) { setError('Bitte alle Fragen ausfüllen.'); return; }
      if (q.answers.filter((a) => a.trim()).length < 2) { setError('Jede Frage benötigt mindestens 2 Antwortoptionen.'); return; }
    }

    const channelIds: string[] = [];
    const conversationIds: string[] = [];
    for (const id of selectedChats) {
      const opt = chatOptions.find((c) => c.id === id);
      if (opt?.type === 'channel') channelIds.push(id);
      else if (opt?.type === 'conversation') conversationIds.push(id);
    }

    // Notify in source chat if triggered from chat
    const notifyId = preselectedChat?.id;
    const notifyType = preselectedChat?.type;

    setSubmitting(true);
    try {
      const { id } = await api.createPoll({
        name: name.trim(),
        description: description.trim() || undefined,
        start_time: dateToTs(startDate),
        end_time: dateToTs(endDate),
        privacy_type: privacyType,
        hidden_results: hiddenResults,
        questions: questions.map((q) => ({
          name: q.name.trim(),
          answer_limit: q.answer_limit,
          answers: q.answers.filter((a) => a.trim()),
        })),
        invite_channel_ids: channelIds,
        invite_conversation_ids: conversationIds,
        notify_chat_id: notifyId,
        notify_chat_type: notifyType,
      });
      onCreated?.(id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Erstellen der Umfrage');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-surface-900">

        {/* Header */}
        <div className="flex items-center gap-3 border-b border-surface-200 px-6 py-4 dark:border-surface-700">
          <BarChart3 size={22} className="text-primary-500" />
          <h2 className="flex-1 text-lg font-semibold text-surface-900 dark:text-white">Neue Umfrage</h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800">
            <X size={18} />
          </button>
        </div>

        {/* Scrollable body */}
        <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">

            {/* Basic info */}
            <div className="space-y-3">
              <input
                className="w-full rounded-lg border border-surface-200 bg-surface-50 px-3 py-2 text-sm text-surface-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-200 dark:border-surface-700 dark:bg-surface-800 dark:text-white dark:focus:ring-primary-800"
                placeholder="Titel der Umfrage *"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
              <textarea
                className="w-full rounded-lg border border-surface-200 bg-surface-50 px-3 py-2 text-sm text-surface-900 outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-200 dark:border-surface-700 dark:bg-surface-800 dark:text-white dark:focus:ring-primary-800 resize-none"
                placeholder="Beschreibung (optional)"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            {/* Dates */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-surface-500 dark:text-surface-400">Startdatum</label>
                <input type="date" className="w-full rounded-lg border border-surface-200 bg-surface-50 px-3 py-2 text-sm text-surface-900 outline-none focus:border-primary-500 dark:border-surface-700 dark:bg-surface-800 dark:text-white" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-surface-500 dark:text-surface-400">Enddatum</label>
                <input type="date" className="w-full rounded-lg border border-surface-200 bg-surface-50 px-3 py-2 text-sm text-surface-900 outline-none focus:border-primary-500 dark:border-surface-700 dark:bg-surface-800 dark:text-white" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
              </div>
            </div>

            {/* Privacy */}
            <div className="flex flex-wrap items-center gap-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-surface-500 dark:text-surface-400">Datenschutz</label>
                <select
                  className="rounded-lg border border-surface-200 bg-surface-50 px-3 py-2 text-sm text-surface-900 outline-none focus:border-primary-500 dark:border-surface-700 dark:bg-surface-800 dark:text-white"
                  value={privacyType}
                  onChange={(e) => setPrivacyType(e.target.value as 'open' | 'hidden' | 'anonymous')}
                >
                  <option value="open">Offen (Name sichtbar)</option>
                  <option value="hidden">Versteckt (Namen privat)</option>
                  <option value="anonymous">Anonym</option>
                </select>
              </div>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-surface-700 dark:text-surface-300">
                <input type="checkbox" className="accent-primary-500" checked={hiddenResults} onChange={(e) => setHiddenResults(e.target.checked)} />
                Ergebnisse zunächst verbergen
              </label>
            </div>

            {/* Questions */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-surface-800 dark:text-surface-200">Fragen</h3>
              </div>
              <div className="space-y-4">
                {questions.map((q, qi) => (
                  <div key={qi} className="rounded-xl border border-surface-200 bg-surface-50 p-4 dark:border-surface-700 dark:bg-surface-800">
                    <div className="mb-3 flex items-center gap-2">
                      <span className="text-xs font-bold text-primary-500">F{qi + 1}</span>
                      <input
                        className="flex-1 rounded-lg border border-surface-200 bg-white px-3 py-1.5 text-sm text-surface-900 outline-none focus:border-primary-500 dark:border-surface-600 dark:bg-surface-700 dark:text-white"
                        placeholder="Frage eingeben..."
                        value={q.name}
                        onChange={(e) => updateQuestion(qi, { name: e.target.value })}
                      />
                      <select
                        className="rounded-lg border border-surface-200 bg-white px-2 py-1.5 text-xs text-surface-700 outline-none dark:border-surface-600 dark:bg-surface-700 dark:text-surface-200"
                        value={q.answer_limit}
                        onChange={(e) => updateQuestion(qi, { answer_limit: Number(e.target.value) })}
                        title="Antworttyp"
                      >
                        <option value={1}>Einfachauswahl</option>
                        <option value={0}>Mehrfachauswahl</option>
                      </select>
                      <button type="button" onClick={() => moveQuestion(qi, -1)} disabled={qi === 0} className="rounded p-1 text-surface-400 hover:text-surface-600 disabled:opacity-30"><ChevronUp size={14} /></button>
                      <button type="button" onClick={() => moveQuestion(qi, 1)} disabled={qi === questions.length - 1} className="rounded p-1 text-surface-400 hover:text-surface-600 disabled:opacity-30"><ChevronDown size={14} /></button>
                      <button type="button" onClick={() => removeQuestion(qi)} disabled={questions.length <= 1} className="rounded p-1 text-red-400 hover:text-red-600 disabled:opacity-30"><Trash2 size={14} /></button>
                    </div>
                    <div className="space-y-2 pl-5">
                      {q.answers.map((a, ai) => (
                        <div key={ai} className="flex items-center gap-2">
                          <div className={clsx('h-3.5 w-3.5 shrink-0 border-2 border-surface-300', q.answer_limit === 1 ? 'rounded-full' : 'rounded')} />
                          <input
                            className="flex-1 rounded border border-surface-200 bg-white px-2 py-1 text-sm text-surface-900 outline-none focus:border-primary-500 dark:border-surface-600 dark:bg-surface-700 dark:text-white"
                            placeholder={`Option ${ai + 1}`}
                            value={a}
                            onChange={(e) => updateAnswer(qi, ai, e.target.value)}
                          />
                          <button type="button" onClick={() => removeAnswer(qi, ai)} disabled={q.answers.length <= 2} className="rounded p-0.5 text-surface-300 hover:text-red-400 disabled:opacity-30"><X size={13} /></button>
                        </div>
                      ))}
                      <button type="button" onClick={() => addAnswer(qi)} className="flex items-center gap-1 text-xs text-primary-500 hover:text-primary-700">
                        <Plus size={13} /> Option hinzufügen
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <button type="button" onClick={addQuestion} className="mt-3 flex items-center gap-1.5 rounded-lg border border-dashed border-surface-300 px-4 py-2 text-sm text-surface-500 hover:border-primary-400 hover:text-primary-600 dark:border-surface-600 dark:hover:border-primary-500">
                <Plus size={15} /> Frage hinzufügen
              </button>
            </div>

            {/* Chat targeting */}
            <div>
              <h3 className="mb-2 text-sm font-semibold text-surface-800 dark:text-surface-200">
                Teilen mit
                <span className="ml-1.5 text-xs font-normal text-surface-400">(Mehrfachauswahl)</span>
              </h3>
              {loadingChats ? (
                <div className="flex items-center gap-2 text-sm text-surface-400"><Loader2 size={14} className="animate-spin" /> Lade Chats…</div>
              ) : (
                <div className="rounded-xl border border-surface-200 dark:border-surface-700 overflow-hidden">
                  {/* Search field */}
                  <div className="flex items-center gap-2 border-b border-surface-200 px-3 py-2 dark:border-surface-700 bg-surface-50 dark:bg-surface-800">
                    <Search size={14} className="shrink-0 text-surface-400" />
                    <input
                      type="text"
                      placeholder="Channel oder Konversation suchen…"
                      value={chatSearch}
                      onChange={(e) => setChatSearch(e.target.value)}
                      className="w-full bg-transparent text-sm text-surface-900 outline-none placeholder:text-surface-400 dark:text-white"
                    />
                    {chatSearch && (
                      <button type="button" onClick={() => setChatSearch('')} className="text-surface-400 hover:text-surface-600">
                        <X size={13} />
                      </button>
                    )}
                  </div>
                  {/* List */}
                  <div className="max-h-44 overflow-y-auto">
                    {(() => {
                      const filtered = chatOptions.filter((o) =>
                        o.name.toLowerCase().includes(chatSearch.toLowerCase())
                      );
                      if (filtered.length === 0) return (
                        <p className="p-3 text-sm text-surface-400">
                          {chatSearch ? 'Keine Treffer' : 'Keine Chats verfügbar'}
                        </p>
                      );
                      return filtered.map((opt) => (
                        <label key={opt.id} className={clsx(
                          'flex cursor-pointer items-center gap-3 px-4 py-2.5 text-sm transition hover:bg-surface-50 dark:hover:bg-surface-800',
                          selectedChats.has(opt.id) && 'bg-primary-50 dark:bg-primary-900/20',
                        )}>
                          <input
                            type="checkbox"
                            className="accent-primary-500"
                            checked={selectedChats.has(opt.id)}
                            onChange={() => toggleChat(opt.id)}
                          />
                          <span className="text-xs font-medium text-surface-400 w-16 shrink-0">{opt.type === 'channel' ? '# Channel' : '💬 Konv.'}</span>
                          <span className="truncate text-surface-800 dark:text-surface-200">{opt.name}</span>
                        </label>
                      ));
                    })()}
                  </div>
                  {/* Selection count */}
                  {selectedChats.size > 0 && (
                    <div className="border-t border-surface-200 px-4 py-1.5 text-xs text-primary-600 dark:border-surface-700 dark:text-primary-400">
                      {selectedChats.size} ausgewählt
                    </div>
                  )}
                </div>
              )}
            </div>

            {error && (
              <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</p>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 border-t border-surface-200 px-6 py-4 dark:border-surface-700">
            <button type="button" onClick={onClose} className="rounded-lg border border-surface-200 px-4 py-2 text-sm text-surface-600 hover:bg-surface-50 dark:border-surface-700 dark:text-surface-300 dark:hover:bg-surface-800">
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-5 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
            >
              {submitting && <Loader2 size={14} className="animate-spin" />}
              {submitting ? 'Erstelle…' : 'Umfrage erstellen & teilen'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
