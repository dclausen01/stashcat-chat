import { useState, useEffect, useCallback } from 'react';
import { BarChart3, Plus, Trash2, Archive, RefreshCw, Loader2, ChevronRight, ChevronLeft, Check } from 'lucide-react';
import { clsx } from 'clsx';
import * as api from '../api';
import type { Poll, PollQuestion } from '../api';
import CreatePollModal from './CreatePollModal';

type Tab = 'mine' | 'invited' | 'archived';

// live-verified 2026-03-27
const API_CONSTRAINT: Record<Tab, string> = {
  mine: 'created_by_and_not_archived',
  invited: 'invited_and_not_archived',
  archived: 'archived_or_over',
};

function formatDate(ts?: number) {
  if (!ts) return '–';
  return new Date(ts * 1000).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function isActive(poll: Poll): boolean {
  const now = Math.floor(Date.now() / 1000);
  const start = poll.start_time ?? 0;
  const end = poll.end_time ?? Infinity;
  return now >= start && now <= end && poll.status !== 'archived';
}

// ── Detail / Vote view ──────────────────────────────────────────────────────

function PollDetail({ poll, companyId, onBack, onRefresh }: { poll: Poll; companyId: string; onBack: () => void; onRefresh: () => void }) {
  const [detail, setDetail] = useState<Poll | null>(null);
  const [loading, setLoading] = useState(true);
  // questionId → set of chosen answerIds
  const [selections, setSelections] = useState<Record<string, Set<string>>>({});
  const [submitting, setSubmitting] = useState<boolean>(false); // submitting in progress
  const [allSubmitted, setAllSubmitted] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getPoll(poll.id, companyId).then((d) => { setDetail(d); setLoading(false); }).catch(() => setLoading(false));
  }, [poll.id, companyId]);

  function toggleAnswer(q: PollQuestion, answerId: string) {
    setSelections((prev) => {
      const current = new Set(prev[q.id] ?? []);
      if (q.answer_limit === 1) {
        return { ...prev, [q.id]: new Set([answerId]) };
      }
      if (current.has(answerId)) current.delete(answerId); else current.add(answerId);
      return { ...prev, [q.id]: current };
    });
  }

  async function submitAll() {
    const unanswered = d.questions?.filter(q => (selections[q.id] ?? []).length === 0) ?? [];
    if (unanswered.length > 0) {
      setError(`Bitte beantworten Sie zuerst alle Fragen (${unanswered.length} fehlen noch).`);
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await Promise.all(
        (d.questions ?? []).map(q =>
          api.submitPollAnswer(poll.id, q.id, [...(selections[q.id] ?? [])])
        )
      );
      setAllSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Abstimmen');
    } finally {
      setSubmitting(false);
    }
  }

  const active = isActive(poll);

  if (loading) return (
    <div className="flex flex-1 items-center justify-center">
      <Loader2 size={28} className="animate-spin text-primary-400" />
    </div>
  );

  const d = detail ?? poll;

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Sub-header */}
      <div className="flex items-center gap-3 border-b border-surface-200 px-6 py-3 dark:border-surface-700">
        <button onClick={onBack} className="rounded-lg p-1.5 text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800">
          <ChevronLeft size={18} />
        </button>
        <div className="flex-1">
          <h2 className="font-semibold text-surface-900 dark:text-white">{d.name}</h2>
          <p className="text-xs text-surface-400">{formatDate(d.start_time)} – {formatDate(d.end_time)}</p>
        </div>
        <button onClick={onRefresh} className="rounded-lg p-1.5 text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800" title="Ergebnisse aktualisieren">
          <RefreshCw size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
        {d.description && (
          <p className="text-sm text-surface-600 dark:text-surface-400">{d.description}</p>
        )}

        {!active && (
          <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:bg-amber-900/20 dark:text-amber-400">
            Diese Umfrage ist {poll.status === 'archived' ? 'archiviert' : 'beendet'} — Abstimmen nicht mehr möglich.
          </div>
        )}

        {error && <p className="rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">{error}</p>}

        {(d.questions ?? []).map((q) => {
          const alreadyVoted = (q.user_answers?.length ?? 0) > 0 || allSubmitted;
          const chosen = selections[q.id] ?? new Set<string>();
          const totalVotes = (q.answers ?? []).reduce((s, a) => s + (a.votes ?? 0), 0);
          const showResults = alreadyVoted || !active || d.hidden_results === false;

          return (
            <div key={q.id} className="rounded-2xl border border-surface-200 bg-surface-50 p-5 dark:border-surface-700 dark:bg-surface-800">
              <div className="mb-4 flex items-start justify-between gap-2">
                <h3 className="font-medium text-surface-900 dark:text-white">{q.name}</h3>
                <span className="shrink-0 rounded-full bg-surface-200 px-2 py-0.5 text-xs text-surface-500 dark:bg-surface-700 dark:text-surface-400">
                  {q.answer_limit === 1 ? 'Einfachauswahl' : 'Mehrfachauswahl'}
                </span>
              </div>

              <div className="space-y-2">
                {(q.answers ?? []).map((a) => {
                  const isChosen = chosen.has(a.id) || (q.user_answers ?? []).includes(a.id);
                  const pct = totalVotes > 0 ? Math.round(((a.votes ?? 0) / totalVotes) * 100) : 0;

                  return (
                    <button
                      key={a.id}
                      type="button"
                      disabled={alreadyVoted || !active}
                      onClick={() => !alreadyVoted && active && toggleAnswer(q, a.id)}
                      className={clsx(
                        'relative w-full overflow-hidden rounded-xl border px-4 py-2.5 text-left transition',
                        isChosen
                          ? 'border-primary-400 bg-primary-50 dark:border-primary-600 dark:bg-primary-900/30'
                          : 'border-surface-200 bg-white hover:border-surface-300 hover:bg-surface-50 dark:border-surface-600 dark:bg-surface-700 dark:hover:bg-surface-600',
                        (alreadyVoted || !active) && 'cursor-default',
                      )}
                    >
                      {/* Progress bar */}
                      {showResults && (
                        <div
                          className="absolute inset-y-0 left-0 bg-primary-100/60 transition-all dark:bg-primary-800/30"
                          style={{ width: `${pct}%` }}
                        />
                      )}
                      <div className="relative flex items-center gap-3">
                        <div className={clsx(
                          'flex h-4 w-4 shrink-0 items-center justify-center border-2',
                          q.answer_limit === 1 ? 'rounded-full' : 'rounded',
                          isChosen ? 'border-primary-500 bg-primary-500' : 'border-surface-300 dark:border-surface-500',
                        )}>
                          {isChosen && <Check size={10} className="text-white" strokeWidth={3} />}
                        </div>
                        <span className="flex-1 text-sm text-surface-800 dark:text-surface-200">{a.answer_text}</span>
                        {showResults && (
                          <span className="text-xs font-medium text-surface-400">{pct}% ({a.votes ?? 0})</span>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              {showResults && totalVotes > 0 && (
                <p className="mt-1 text-xs text-surface-400">{totalVotes} Stimme{totalVotes !== 1 ? 'n' : ''} gesamt</p>
              )}
            </div>
          );
        })}
      </div>
      {active && !allSubmitted && (
        <div className="sticky bottom-0 border-t border-surface-200 bg-white px-6 py-4 dark:border-surface-700 dark:bg-surface-900">
          <button
            onClick={submitAll}
            disabled={submitting || (d.questions ?? []).some(q => (selections[q.id] ?? []).length === 0)}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {submitting && <Loader2 size={15} className="animate-spin" />}
            Abstimmen
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main view ────────────────────────────────────────────────────────────────

interface PollsViewProps {
  pollIdToOpen?: string | null;
  onPollOpened?: () => void;
}

export default function PollsView({ pollIdToOpen, onPollOpened }: PollsViewProps) {
  const [tab, setTab] = useState<Tab>('mine');
  const [polls, setPolls] = useState<Poll[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedPoll, setSelectedPoll] = useState<Poll | null>(null);
  const [companyId, setCompanyId] = useState<string>('');

  // Load company_id once on mount
  useEffect(() => {
    api.getCompanies().then((cs) => {
      const id = String((cs[0] as Record<string, unknown>)?.id ?? '');
      setCompanyId(id);
    }).catch(() => {});
  }, []);

  const loadPolls = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const data = await api.listPolls(API_CONSTRAINT[tab], companyId);
      setPolls(data);
    } catch {
      setPolls([]);
    } finally {
      setLoading(false);
    }
  }, [tab, companyId]);

  useEffect(() => { loadPolls(); }, [loadPolls]);

  // If pollIdToOpen is provided, fetch and open that specific poll
  useEffect(() => {
    if (!pollIdToOpen || !companyId) return;
    api.getPoll(pollIdToOpen, companyId).then((poll) => {
      setSelectedPoll(poll);
      onPollOpened?.();
    }).catch(() => {
      onPollOpened?.();
    });
  }, [pollIdToOpen, companyId, onPollOpened]);

  async function handleDelete(id: string) {
    if (!confirm('Umfrage wirklich löschen?')) return;
    await api.deletePoll(id).catch(() => {});
    setPolls((p) => p.filter((x) => x.id !== id));
  }

  async function handleArchive(poll: Poll) {
    const archive = poll.status !== 'archived';
    await api.archivePoll(poll.id, archive).catch(() => {});
    loadPolls();
  }

  if (selectedPoll) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden bg-white dark:bg-surface-900">
        <PollDetail
          poll={selectedPoll}
          companyId={companyId}
          onBack={() => setSelectedPoll(null)}
          onRefresh={() => {
            const id = selectedPoll.id;
            setSelectedPoll(null);
            setTimeout(() => loadPolls(), 100);
            const found = polls.find((p) => p.id === id);
            if (found) setSelectedPoll(found);
          }}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-white dark:bg-surface-900">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-surface-200 px-6 py-4 dark:border-surface-700">
        <BarChart3 size={22} className="text-primary-500" />
        <h1 className="flex-1 text-lg font-semibold text-surface-900 dark:text-white">Umfragen</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700"
        >
          <Plus size={15} /> Neue Umfrage
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-surface-200 dark:border-surface-700">
        {([['mine', 'Meine'], ['invited', 'Eingeladen'], ['archived', 'Archiviert']] as [Tab, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={clsx(
              'px-5 py-2.5 text-sm font-medium transition border-b-2',
              tab === key
                ? 'border-primary-500 text-primary-600 dark:text-primary-400'
                : 'border-transparent text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-200',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex flex-1 items-center justify-center py-20">
            <Loader2 size={28} className="animate-spin text-primary-400" />
          </div>
        ) : polls.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <BarChart3 size={40} className="mb-3 text-surface-300 dark:text-surface-600" />
            <p className="text-sm text-surface-400 dark:text-surface-500">
              {tab === 'mine' ? 'Noch keine Umfragen erstellt.' : tab === 'invited' ? 'Keine Einladungen.' : 'Keine archivierten Umfragen.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-surface-100 dark:divide-surface-800">
            {polls.map((poll) => {
              const active = isActive(poll);
              return (
                <button
                  key={poll.id}
                  onClick={() => setSelectedPoll(poll)}
                  className="group flex w-full items-center gap-4 px-6 py-4 text-left transition hover:bg-surface-50 dark:hover:bg-surface-800"
                >
                  <div className={clsx(
                    'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                    active ? 'bg-primary-100 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400' : 'bg-surface-100 text-surface-400 dark:bg-surface-800 dark:text-surface-500',
                  )}>
                    <BarChart3 size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-surface-900 dark:text-white">{poll.name}</span>
                      {active && <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-400">Aktiv</span>}
                    </div>
                    {poll.description && (
                      <p className="truncate text-xs text-surface-400">{poll.description}</p>
                    )}
                    <p className="text-xs text-surface-400">{formatDate(poll.start_time)} – {formatDate(poll.end_time)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleArchive(poll); }}
                      className="rounded-lg p-1.5 text-surface-400 hover:bg-surface-200 hover:text-surface-600 dark:hover:bg-surface-700"
                      title={poll.status === 'archived' ? 'Wiederherstellen' : 'Archivieren'}
                    >
                      <Archive size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleDelete(poll.id); }}
                      className="rounded-lg p-1.5 text-surface-400 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
                      title="Löschen"
                    >
                      <Trash2 size={15} />
                    </button>
                    <ChevronRight size={15} className="text-surface-300" />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {showCreate && (
        <CreatePollModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); loadPolls(); }}
        />
      )}
    </div>
  );
}
