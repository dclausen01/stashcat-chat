import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { BarChart3, Plus, Trash2, Archive, RefreshCw, Loader2, ChevronRight, ChevronLeft, Check, PieChart, ChevronDown, StopCircle } from 'lucide-react';
import { clsx } from 'clsx';
import * as api from '../api';
import type { Poll, PollQuestion } from '../api';
import { useAuth } from '../context/AuthContext';
import Avatar from './Avatar';
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

function PollDetail({ poll, companyId, onBack, onRefresh, onDelete }: { poll: Poll; companyId: string; onBack: () => void; onRefresh: () => void; onDelete: () => void }) {
  const { user } = useAuth();
  const [detail, setDetail] = useState<Poll | null>(null);
  const [loading, setLoading] = useState(true);
  // questionId → set of chosen answerIds
  const [selections, setSelections] = useState<Record<string, Set<string>>>({});
  const [submitting, setSubmitting] = useState<boolean>(false); // submitting in progress
  const [allSubmitted, setAllSubmitted] = useState(false);
  const [error, setError] = useState('');
  const [openVoterDropdown, setOpenVoterDropdown] = useState<string | null>(null);
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.getPoll(poll.id, companyId).then((d) => { setDetail(d); setLoading(false); }).catch(() => setLoading(false));
  }, [poll.id, companyId]);

  // Close voter dropdown on click outside
  useEffect(() => {
    if (!openVoterDropdown) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpenVoterDropdown(null);
        setDropdownPos(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [openVoterDropdown]);

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
    const currentSelections = selections;
    const questions = (detail ?? poll).questions ?? [];
    const unanswered = questions.filter(q => (currentSelections[q.id]?.size ?? 0) === 0);
    if (unanswered.length > 0) {
      setError(`Bitte beantworten Sie zuerst alle Fragen (${unanswered.length} fehlen noch).`);
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await Promise.all(
        questions.map(q =>
          api.submitPollAnswer(poll.id, q.id, [...(currentSelections[q.id] ?? [])])
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
  const userId = user?.id ?? '';
  const isCreator = String(d.creator?.id ?? '') === userId;
  const canSeeVoters = d.privacy_type === 'open' || (d.privacy_type === 'hidden' && isCreator);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Sub-header */}
      <div className="flex items-center gap-3 border-b border-surface-200 px-6 py-3 dark:border-surface-700">
        <button onClick={onBack} className="rounded-lg p-1.5 text-surface-600 hover:bg-surface-200 dark:hover:bg-surface-800">
          <ChevronLeft size={18} />
        </button>
        <div className="flex-1">
          <h2 className="font-semibold text-surface-900 dark:text-white">{d.name}</h2>
          <p className="text-xs text-surface-600">{formatDate(d.start_time)} – {formatDate(d.end_time)}</p>
        </div>
        <button onClick={onRefresh} className="rounded-lg p-1.5 text-surface-600 hover:bg-surface-200 dark:hover:bg-surface-800" title="Ergebnisse aktualisieren">
          <RefreshCw size={16} />
        </button>
        {isCreator && active && (
          <button
            onClick={async () => {
              if (!confirm('Umfrage jetzt beenden? (Abstimmen wird nicht mehr möglich sein)')) return;
              try {
                await api.closePoll(String(d.id), d.name, companyId, d.start_time ?? 0);
                onRefresh();
              } catch { /* ignore */ }
            }}
            className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-amber-600 hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-900/20"
            title="Umfrage beenden"
          >
            <StopCircle size={14} />
            Beenden
          </button>
        )}
        {isCreator && (
          <button
            onClick={() => {
              if (!confirm('Umfrage wirklich löschen?')) return;
              onDelete();
            }}
            className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
            title="Umfrage löschen"
          >
            <Trash2 size={14} />
            Löschen
          </button>
        )}
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
          const showResults = alreadyVoted || !active || isCreator;

          return (
            <div key={q.id} className="rounded-2xl border border-surface-200 bg-surface-50 p-5 dark:border-surface-700 dark:bg-surface-800">
              <div className="mb-4 flex items-start justify-between gap-2">
                <h3 className="font-medium text-surface-900 dark:text-white">{q.name}</h3>
                <span className="shrink-0 rounded-full bg-surface-200 px-2 py-0.5 text-xs text-surface-600 dark:bg-surface-700 dark:text-surface-400">
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
                        'relative w-full rounded-xl border px-4 py-2.5 text-left transition',
                        isChosen
                          ? 'border-primary-400 bg-primary-50 dark:border-primary-600 dark:bg-primary-900/30'
                          : 'border-surface-200 bg-white hover:border-surface-300 hover:bg-surface-50 dark:border-surface-600 dark:bg-surface-700 dark:hover:bg-surface-600',
                        (alreadyVoted || !active) && 'cursor-default',
                      )}
                    >
                      {/* Progress bar */}
                      {showResults && (
                        <div
                          className="absolute inset-y-0 left-0 overflow-hidden rounded-xl bg-primary-200/80 transition-all dark:bg-primary-700/40"
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
                          <div className="relative flex items-center gap-2">
                            <span className="text-lg font-bold text-primary-600 dark:text-primary-400">{pct}%</span>
                            {canSeeVoters && (a.users?.length ?? 0) > 0 ? (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (openVoterDropdown === a.id) {
                                    setOpenVoterDropdown(null);
                                    setDropdownPos(null);
                                  } else {
                                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                    setDropdownPos({ top: rect.bottom + 4, left: rect.right });
                                    setOpenVoterDropdown(a.id);
                                  }
                                }}
                                className="flex items-center gap-0.5 rounded-full bg-surface-200 px-2 py-0.5 text-xs font-semibold text-surface-600 transition hover:bg-primary-100 hover:text-primary-700 dark:bg-surface-700 dark:text-surface-400 dark:hover:bg-primary-900/30 dark:hover:text-primary-300"
                              >
                                {a.votes ?? 0} Stimme{(a.votes ?? 0) !== 1 ? 'n' : ''}
                                <ChevronDown size={11} className={clsx('transition-transform', openVoterDropdown === a.id && 'rotate-180')} />
                              </button>
                            ) : (
                              <span className="rounded-full bg-surface-200 px-2 py-0.5 text-xs font-semibold text-surface-600 dark:bg-surface-700 dark:text-surface-400">
                                {a.votes ?? 0} Stimme{(a.votes ?? 0) !== 1 ? 'n' : ''}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>

              {showResults && totalVotes > 0 && (
                <div className="mt-3 flex items-center justify-between rounded-lg bg-surface-100 px-3 py-2 dark:bg-surface-700/50">
                  <span className="text-sm font-medium text-surface-600 dark:text-surface-400">Gesamt</span>
                  <span className="text-base font-bold text-surface-800 dark:text-surface-200">
                    {totalVotes} Stimme{totalVotes !== 1 ? 'n' : ''}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {allSubmitted && (
        <div className="flex items-center justify-center gap-2 py-3 text-sm text-green-600 dark:text-green-400">
          <Check size={16} />
          Stimme{(d.questions?.length ?? 0) !== 1 ? 'n' : ''} abgegeben
        </div>
      )}
      {active && !allSubmitted && (
        <div className="sticky bottom-0 border-t border-surface-200 bg-white px-6 py-4 dark:border-surface-700 dark:bg-surface-900">
          <button
            onClick={submitAll}
            disabled={submitting || (d.questions ?? []).some(q => (selections[q.id]?.size ?? 0) === 0)}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {submitting && <Loader2 size={15} className="animate-spin" />}
            Abstimmen
          </button>
        </div>
      )}
      {/* Voter dropdown rendered via portal to escape overflow containers */}
      {openVoterDropdown && dropdownPos && (() => {
        const openAnswer = (d.questions ?? []).flatMap((q) => q.answers ?? []).find((a) => a.id === openVoterDropdown);
        if (!openAnswer?.users?.length) return null;
        return createPortal(
          <div
            ref={dropdownRef}
            className="fixed z-[9999] w-56 rounded-lg border border-surface-200 bg-white py-1.5 shadow-lg dark:border-surface-600 dark:bg-surface-800"
            style={{ top: dropdownPos.top, left: dropdownPos.left - 224 }}
          >
            {openAnswer.users.map((u) => (
              <div key={u.id} className="flex items-center gap-2 px-3 py-1.5">
                <Avatar name={`${u.first_name ?? ''} ${u.last_name ?? ''}`.trim()} image={u.image} size="xs" />
                <span className="truncate text-xs text-surface-700 dark:text-surface-300">
                  {u.first_name} {u.last_name}
                </span>
              </div>
            ))}
          </div>,
          document.body,
        );
      })()}
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
      const id = String(cs[0]?.id ?? '');
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
          onRefresh={async () => {
            const id = selectedPoll.id;
            setSelectedPoll(null);
            await loadPolls();
            // Re-fetch fresh detail data for the poll
            try {
              const fresh = await api.getPoll(id, companyId);
              setSelectedPoll(fresh);
            } catch { /* poll may have been deleted */ }
          }}
          onDelete={async () => {
            await api.deletePoll(String(selectedPoll.id)).catch(() => {});
            setSelectedPoll(null);
            loadPolls();
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
                : 'border-transparent text-surface-600 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-200',
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
            <BarChart3 size={40} className="mb-3 text-surface-400 dark:text-surface-400" />
            <p className="text-sm text-surface-600 dark:text-surface-400">
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
                    active ? 'bg-primary-100 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400' : 'bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-400',
                  )}>
                    <BarChart3 size={18} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium text-surface-900 dark:text-white">{poll.name}</span>
                      {active && <span className="shrink-0 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-400">Aktiv</span>}
                    </div>
                    {poll.description && (
                      <p className="truncate text-xs text-surface-600">{poll.description}</p>
                    )}
                    <p className="text-xs text-surface-600">{formatDate(poll.start_time)} – {formatDate(poll.end_time)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1 opacity-0 transition group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleArchive(poll); }}
                      className="rounded-lg p-1.5 text-surface-600 hover:bg-surface-200 hover:text-surface-600 dark:hover:bg-surface-700"
                      title={poll.status === 'archived' ? 'Wiederherstellen' : 'Archivieren'}
                    >
                      <Archive size={15} />
                    </button>
                    {tab !== 'invited' && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setSelectedPoll(poll); }}
                        className="rounded-lg p-1.5 text-surface-600 hover:bg-surface-200 hover:text-primary-600 dark:hover:bg-surface-700"
                        title={poll.status === 'archived' ? 'Ergebnisse anzeigen (archiviert)' : 'Ergebnisse anzeigen'}
                      >
                        <PieChart size={15} />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleDelete(poll.id); }}
                      className="rounded-lg p-1.5 text-surface-600 hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-900/20"
                      title="Löschen"
                    >
                      <Trash2 size={15} />
                    </button>
                    <ChevronRight size={15} className="text-surface-400" />
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
