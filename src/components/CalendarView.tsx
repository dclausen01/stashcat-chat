import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ChevronLeft, ChevronRight, Plus, X, Loader2,
  MapPin, Clock, Repeat, Check, XCircle, HelpCircle,
  Eye, EyeOff, ChevronDown, Pencil, Trash2, Users, Hash, PanelRight,
} from 'lucide-react';
import { clsx } from 'clsx';
import * as api from '../api';
import type { CalendarEvent } from '../api';
import { useAuth } from '../context/AuthContext';
import CreateEventModal from './CreateEventModal';

type ViewMode = 'month' | 'week';

// Color palette for calendar sources
const CALENDAR_COLORS = [
  { bg: 'bg-blue-100 dark:bg-blue-900/30', text: 'text-blue-700 dark:text-blue-300', dot: 'bg-blue-500', border: 'border-blue-300 dark:border-blue-700' },
  { bg: 'bg-green-100 dark:bg-green-900/30', text: 'text-green-700 dark:text-green-300', dot: 'bg-green-500', border: 'border-green-300 dark:border-green-700' },
  { bg: 'bg-purple-100 dark:bg-purple-900/30', text: 'text-purple-700 dark:text-purple-300', dot: 'bg-purple-500', border: 'border-purple-300 dark:border-purple-700' },
  { bg: 'bg-amber-100 dark:bg-amber-900/30', text: 'text-amber-700 dark:text-amber-300', dot: 'bg-amber-500', border: 'border-amber-300 dark:border-amber-700' },
  { bg: 'bg-rose-100 dark:bg-rose-900/30', text: 'text-rose-700 dark:text-rose-300', dot: 'bg-rose-500', border: 'border-rose-300 dark:border-rose-700' },
  { bg: 'bg-cyan-100 dark:bg-cyan-900/30', text: 'text-cyan-700 dark:text-cyan-300', dot: 'bg-cyan-500', border: 'border-cyan-300 dark:border-cyan-700' },
  { bg: 'bg-indigo-100 dark:bg-indigo-900/30', text: 'text-indigo-700 dark:text-indigo-300', dot: 'bg-indigo-500', border: 'border-indigo-300 dark:border-indigo-700' },
  { bg: 'bg-orange-100 dark:bg-orange-900/30', text: 'text-orange-700 dark:text-orange-300', dot: 'bg-orange-500', border: 'border-orange-300 dark:border-orange-700' },
];

const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
function startOfWeek(d: Date): Date {
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day; // Monday = start
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + diff);
}
function endOfWeek(d: Date): Date {
  const s = startOfWeek(d);
  return new Date(s.getFullYear(), s.getMonth(), s.getDate() + 6);
}
function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}
function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

interface CalendarSource {
  id: string; // 'personal' or channel_id
  name: string;
  type: 'personal' | 'channel' | 'company';
  colorIndex: number;
  visible: boolean;
}

interface CalendarViewProps {
  eventIdToOpen?: string | null;
  onEventOpened?: () => void;
  onOpenSidebar?: () => void;
}

export default function CalendarView({ eventIdToOpen, onEventOpened }: CalendarViewProps) {
  const { user } = useAuth();
  const userId = user?.id ?? '';

  const [viewMode, setViewMode] = useState<ViewMode>('month');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);

  // Calendar sources (filters)
  const [sources, setSources] = useState<CalendarSource[]>([
    { id: 'personal', name: 'Persönlich', type: 'personal', colorIndex: 0, visible: true },
  ]);

  // Category collapsed state
  const [personalCollapsed, setPersonalCollapsed] = useState(false);
  const [channelsCollapsed, setChannelsCollapsed] = useState(false);

  // Detail modal
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [createDate, setCreateDate] = useState<Date | null>(null);
  // Edit modal
  const [editEvent, setEditEvent] = useState<CalendarEvent | null>(null);

  // Agenda sidebar
  const [agendaOpen, setAgendaOpen] = useState(true);
  const [agendaEvents, setAgendaEvents] = useState<CalendarEvent[]>([]);
  const [agendaLoading, setAgendaLoading] = useState(false);
  const [agendaFocusDate, setAgendaFocusDate] = useState<Date | null>(null);

  // Map of all channel IDs → names (for resolving names in event details)
  const [allChannelNames, setAllChannelNames] = useState<Map<string, string>>(new Map());

  // When an event ID is passed from notifications, open its detail modal
  useEffect(() => {
    if (!eventIdToOpen || events.length === 0) return;
    const evt = events.find((e) => String(e.id) === eventIdToOpen);
    if (evt) {
      setSelectedEvent(evt);
      onEventOpened?.();
    }
  }, [eventIdToOpen, events]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load channel calendars + all channel names on mount
  useEffect(() => {
    api.getCompanies().then((companies) => {
      const cids = companies.map((c) => String(c.id));

      // Load channels with events (for calendar sources)
      Promise.all(cids.map((cid) => api.getCalendarChannels(cid))).then((results) => {
        const channelSources: CalendarSource[] = [];
        let colorIdx = 1; // 0 is personal
        for (const channels of results) {
          for (const ch of channels) {
            channelSources.push({
              id: String(ch.id),
              name: String(ch.name ?? 'Channel'),
              type: 'channel',
              colorIndex: colorIdx % CALENDAR_COLORS.length,
              visible: true,
            });
            colorIdx++;
          }
        }
        setSources((prev) => [...prev, ...channelSources]);
      }).catch(() => {});

      // Load ALL channels (for name resolution in event details)
      Promise.all(cids.map((cid) => api.getChannels(cid))).then((results) => {
        const nameMap = new Map<string, string>();
        for (const channels of results) {
          for (const ch of channels) {
            nameMap.set(String(ch.id), String(ch.name ?? ''));
          }
        }
        setAllChannelNames(nameMap);
      }).catch(() => {});
    }).catch(() => {});
  }, []);

  // Compute date range for API query
  const { rangeStart, rangeEnd } = useMemo(() => {
    if (viewMode === 'month') {
      const monthStart = startOfMonth(currentDate);
      const monthEnd = endOfMonth(currentDate);
      // Include surrounding weeks for grid display
      const gridStart = startOfWeek(monthStart);
      const gridEnd = endOfWeek(monthEnd);
      return {
        rangeStart: Math.floor(gridStart.getTime() / 1000),
        rangeEnd: Math.floor(gridEnd.getTime() / 1000) + 86400,
      };
    } else {
      const ws = startOfWeek(currentDate);
      const we = endOfWeek(currentDate);
      return {
        rangeStart: Math.floor(ws.getTime() / 1000),
        rangeEnd: Math.floor(we.getTime() / 1000) + 86400,
      };
    }
  }, [viewMode, currentDate]);

  // Load events when date range changes
  const loadEvents = useCallback(() => {
    setLoading(true);
    api.listCalendarEvents(rangeStart, rangeEnd)
      .then((evts) => setEvents(evts))
      .catch((err) => console.error('Failed to load events:', err))
      .finally(() => setLoading(false));
  }, [rangeStart, rangeEnd]);

  useEffect(() => { loadEvents(); }, [loadEvents]);

  // Load agenda events (today + 30 days)
  const loadAgendaEvents = useCallback(() => {
    const now = new Date();
    const start = Math.floor(new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000);
    const end = start + 30 * 86400;
    setAgendaLoading(true);
    api.listCalendarEvents(start, end)
      .then((evts) => setAgendaEvents(evts))
      .catch((err) => console.error('Failed to load agenda:', err))
      .finally(() => setAgendaLoading(false));
  }, []);

  useEffect(() => { loadAgendaEvents(); }, [loadAgendaEvents]);

  // Filter events by visible sources
  const visibleSourceIds = useMemo(() => new Set(sources.filter((s) => s.visible).map((s) => s.id)), [sources]);
  const filteredEvents = useMemo(() => {
    return events.filter((e) => {
      if (e.type === 'personal') return visibleSourceIds.has('personal');
      if (e.type === 'channel' && e.type_id) return visibleSourceIds.has(String(e.type_id));
      return visibleSourceIds.has('personal'); // fallback
    });
  }, [events, visibleSourceIds]);

  const filteredAgendaEvents = useMemo(() => {
    return agendaEvents.filter((e) => {
      if (e.type === 'personal') return visibleSourceIds.has('personal');
      if (e.type === 'channel' && e.type_id) return visibleSourceIds.has(String(e.type_id));
      return visibleSourceIds.has('personal');
    });
  }, [agendaEvents, visibleSourceIds]);

  // Group events by date
  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const evt of filteredEvents) {
      const d = new Date(evt.start * 1000);
      const key = dateKey(d);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(evt);
    }
    return map;
  }, [filteredEvents]);

  // Get color for an event based on its source
  const getEventColor = useCallback((e: CalendarEvent) => {
    const sourceId = e.type === 'personal' ? 'personal' : String(e.type_id ?? 'personal');
    const source = sources.find((s) => s.id === sourceId);
    return CALENDAR_COLORS[source?.colorIndex ?? 0];
  }, [sources]);

  // Navigation
  const navigate = (dir: -1 | 1) => {
    if (viewMode === 'month') {
      setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + dir, 1));
    } else {
      const d = new Date(currentDate);
      d.setDate(d.getDate() + dir * 7);
      setCurrentDate(d);
    }
  };

  const goToday = () => setCurrentDate(new Date());

  const toggleSource = (id: string) => {
    setSources((prev) => prev.map((s) => s.id === id ? { ...s, visible: !s.visible } : s));
  };

  // Category-wise toggle
  const toggleCategory = (type: 'personal' | 'channel') => {
    const categorySources = sources.filter((s) => s.type === type);
    const allVisible = categorySources.every((s) => s.visible);
    setSources((prev) => prev.map((s) => s.type === type ? { ...s, visible: !allVisible } : s));
  };

  // Check if event is owned by current user
  const isOwnEvent = (e: CalendarEvent): boolean => {
    return String(e.creator?.id) === userId;
  };

  // Generate grid days for month view
  const monthGrid = useMemo(() => {
    if (viewMode !== 'month') return [];
    const monthStart = startOfMonth(currentDate);
    const gridStart = startOfWeek(monthStart);
    const days: Date[] = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart);
      d.setDate(d.getDate() + i);
      days.push(d);
    }
    return days;
  }, [viewMode, currentDate]);

  // Generate days for week view
  const weekDays = useMemo(() => {
    if (viewMode !== 'week') return [];
    const ws = startOfWeek(currentDate);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(ws);
      d.setDate(d.getDate() + i);
      return d;
    });
  }, [viewMode, currentDate]);

  const today = new Date();

  // RSVP
  const handleRespond = async (eventId: number, status: 'accepted' | 'declined') => {
    try {
      await api.respondToCalendarEvent(String(eventId), status);
      const evts = await api.listCalendarEvents(rangeStart, rangeEnd);
      setEvents(evts);
      if (selectedEvent?.id === eventId) {
        const updated = evts.find((e) => e.id === eventId);
        if (updated) setSelectedEvent(updated);
      }
    } catch (err) {
      alert(`Fehler: ${err instanceof Error ? err.message : err}`);
    }
  };

  // Delete
  const handleDelete = async (eventId: number) => {
    if (!confirm('Termin wirklich löschen?')) return;
    try {
      await api.deleteCalendarEvent(String(eventId));
      setSelectedEvent(null);
      loadEvents();
    } catch (err) {
      alert(`Fehler: ${err instanceof Error ? err.message : err}`);
    }
  };

  // Title
  const title = viewMode === 'month'
    ? `${MONTHS[currentDate.getMonth()]} ${currentDate.getFullYear()}`
    : `KW ${getWeekNumber(currentDate)} · ${currentDate.getFullYear()}`;

  // Separate sources by category
  const personalSources = sources.filter((s) => s.type === 'personal');
  const channelSources = sources.filter((s) => s.type === 'channel');

  return (
    <div className="flex h-full flex-1 overflow-hidden">
      {/* Sidebar — Calendar filters — hidden on mobile */}
      <div className="hidden w-56 shrink-0 flex-col border-r border-surface-200 bg-surface-50 dark:border-surface-700 dark:bg-surface-900 md:flex">
        <div className="shrink-0 border-b border-surface-200 px-4 py-3 dark:border-surface-700">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-600">Kalender</h3>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {/* Personal calendar category */}
          <div className="mb-1">
            <button
              onClick={() => setPersonalCollapsed(!personalCollapsed)}
              className="flex w-full items-center gap-1 rounded-md px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-wider text-surface-600 hover:bg-surface-200 dark:hover:bg-surface-800"
            >
              {personalCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
              <span className="flex-1">Persönlich</span>
              <button
                onClick={(e) => { e.stopPropagation(); toggleCategory('personal'); }}
                className="rounded p-0.5 hover:bg-surface-200 dark:hover:bg-surface-700"
                title={personalSources.every((s) => s.visible) ? 'Alle ausblenden' : 'Alle einblenden'}
              >
                {personalSources.every((s) => s.visible) ? <Eye size={11} className="text-surface-600" /> : <EyeOff size={11} className="text-surface-400" />}
              </button>
            </button>
            {!personalCollapsed && personalSources.map((src) => {
              const color = CALENDAR_COLORS[src.colorIndex];
              return (
                <button
                  key={src.id}
                  onClick={() => toggleSource(src.id)}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 pl-6 text-left text-sm transition hover:bg-surface-200 dark:hover:bg-surface-800"
                >
                  <span className={clsx('h-2.5 w-2.5 shrink-0 rounded-full', src.visible ? color.dot : 'bg-surface-300 dark:bg-surface-600')} />
                  <span className={clsx('min-w-0 flex-1 truncate', src.visible ? 'text-surface-900 dark:text-surface-100' : 'text-surface-600 line-through')}>
                    {src.name}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Channel calendars category */}
          {channelSources.length > 0 && (
            <div className="mb-1">
              <button
                onClick={() => setChannelsCollapsed(!channelsCollapsed)}
                className="flex w-full items-center gap-1 rounded-md px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-wider text-surface-600 hover:bg-surface-200 dark:hover:bg-surface-800"
              >
                {channelsCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                <span className="flex-1">Channel-Kalender</span>
                <button
                  onClick={(e) => { e.stopPropagation(); toggleCategory('channel'); }}
                  className="rounded p-0.5 hover:bg-surface-200 dark:hover:bg-surface-700"
                  title={channelSources.every((s) => s.visible) ? 'Alle ausblenden' : 'Alle einblenden'}
                >
                  {channelSources.every((s) => s.visible) ? <Eye size={11} className="text-surface-600" /> : <EyeOff size={11} className="text-surface-400" />}
                </button>
              </button>
              {!channelsCollapsed && channelSources.map((src) => {
                const color = CALENDAR_COLORS[src.colorIndex];
                return (
                  <button
                    key={src.id}
                    onClick={() => toggleSource(src.id)}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 pl-6 text-left text-sm transition hover:bg-surface-200 dark:hover:bg-surface-800"
                  >
                    <span className={clsx('h-2.5 w-2.5 shrink-0 rounded-full', src.visible ? color.dot : 'bg-surface-300 dark:bg-surface-600')} />
                    <span className={clsx('min-w-0 flex-1 truncate', src.visible ? 'text-surface-900 dark:text-surface-100' : 'text-surface-600 line-through')}>
                      {src.name}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Mini month for quick nav */}
        <div className="shrink-0 border-t border-surface-200 p-3 dark:border-surface-700">
          <button onClick={goToday} className="w-full rounded-lg bg-primary-600 py-1.5 text-xs font-medium text-white hover:bg-primary-700">
            Heute
          </button>
        </div>
      </div>

      {/* Main calendar area */}
      <div className="flex min-w-0 flex-1 flex-col bg-white dark:bg-surface-950">
        {/* Toolbar */}
        <div className="flex shrink-0 items-center gap-3 border-b border-surface-200 px-4 py-2.5 dark:border-surface-700">
          <div className="flex items-center gap-1">
            <button onClick={() => navigate(-1)} className="rounded-lg p-1.5 text-surface-600 hover:bg-surface-200 dark:hover:bg-surface-800">
              <ChevronLeft size={18} />
            </button>
            <button onClick={() => navigate(1)} className="rounded-lg p-1.5 text-surface-600 hover:bg-surface-200 dark:hover:bg-surface-800">
              <ChevronRight size={18} />
            </button>
          </div>

          <h2 className="text-lg font-semibold text-surface-900 dark:text-white">{title}</h2>

          <div className="flex-1" />

          {/* View toggle */}
          <div className="flex rounded-lg bg-surface-100 p-0.5 dark:bg-surface-800">
            <button
              onClick={() => setViewMode('month')}
              className={clsx(
                'rounded-md px-3 py-1 text-xs font-medium transition',
                viewMode === 'month'
                  ? 'bg-white text-surface-900 shadow-sm dark:bg-surface-700 dark:text-white'
                  : 'text-surface-600 hover:text-surface-700 dark:text-surface-400',
              )}
            >
              Monat
            </button>
            <button
              onClick={() => setViewMode('week')}
              className={clsx(
                'rounded-md px-3 py-1 text-xs font-medium transition',
                viewMode === 'week'
                  ? 'bg-white text-surface-900 shadow-sm dark:bg-surface-700 dark:text-white'
                  : 'text-surface-600 hover:text-surface-700 dark:text-surface-400',
              )}
            >
              Woche
            </button>
          </div>

          <button
            onClick={() => { setCreateDate(new Date()); setShowCreate(true); }}
            className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700"
          >
            <Plus size={14} /> Termin
          </button>

          <button
            onClick={() => setAgendaOpen((o) => !o)}
            title="Agenda ein-/ausblenden"
            className={clsx(
              'rounded-lg p-1.5 transition',
              agendaOpen
                ? 'bg-primary-100 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400'
                : 'text-surface-600 hover:bg-surface-200 dark:hover:bg-surface-800',
            )}
          >
            <PanelRight size={16} />
          </button>

          {loading && <Loader2 size={16} className="animate-spin text-primary-400" />}
        </div>

        {/* Grid */}
        {viewMode === 'month' ? (
          <div className="flex min-h-0 flex-1 flex-col">
            {/* Weekday headers */}
            <div className="grid shrink-0 grid-cols-7 border-b border-surface-200 dark:border-surface-700">
              {WEEKDAYS.map((wd) => (
                <div key={wd} className="border-r border-surface-200 px-2 py-1.5 text-center text-xs font-semibold text-surface-600 last:border-r-0 dark:border-surface-800">
                  {wd}
                </div>
              ))}
            </div>

            {/* Day cells */}
            <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
              {monthGrid.map((day, i) => {
                const key = dateKey(day);
                const dayEvents = eventsByDate.get(key) || [];
                const isCurrentMonth = day.getMonth() === currentDate.getMonth();
                const isToday = isSameDay(day, today);

                return (
                  <div
                    key={i}
                    onClick={() => { setAgendaFocusDate(day); if (!agendaOpen) setAgendaOpen(true); setCreateDate(day); setShowCreate(true); }}
                    className={clsx(
                      'flex min-h-0 cursor-pointer flex-col border-b border-r border-surface-200 p-1 transition hover:bg-surface-50 dark:border-surface-800 dark:hover:bg-surface-900',
                      !isCurrentMonth && 'bg-surface-50/50 dark:bg-surface-950/50',
                    )}
                  >
                    <div className={clsx(
                      'mb-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium',
                      isToday ? 'bg-primary-600 text-white' : isCurrentMonth ? 'text-surface-700 dark:text-surface-400' : 'text-surface-600',
                    )}>
                      {day.getDate()}
                    </div>
                    <div className="min-h-0 flex-1 space-y-0.5 overflow-hidden">
                      {dayEvents.slice(0, 3).map((evt) => {
                        const color = getEventColor(evt);
                        const isAllDay = evt.allday === '1';
                        return (
                          <button
                            key={evt.id}
                            onClick={(e) => { e.stopPropagation(); setSelectedEvent(evt); }}
                            className={clsx(
                              'flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left text-[10px] leading-tight transition hover:opacity-80',
                              color.bg, color.text,
                            )}
                          >
                            {!isAllDay && <span className="shrink-0 font-medium">{formatTime(evt.start)}</span>}
                            <span className="truncate">{evt.name}</span>
                          </button>
                        );
                      })}
                      {dayEvents.length > 3 && (
                        <div className="px-1 text-[10px] font-medium text-surface-600">+{dayEvents.length - 3} weitere</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          /* Week view — time grid */
          <div className="flex min-h-0 flex-1 flex-col">
            {/* Day headers */}
            <div className="grid shrink-0 grid-cols-[60px_repeat(7,1fr)] border-b border-surface-200 dark:border-surface-700">
              <div className="border-r border-surface-200 dark:border-surface-800" /> {/* time column header */}
              {weekDays.map((day) => {
                const isToday = isSameDay(day, today);
                return (
                  <div key={dateKey(day)} className="border-r border-surface-200 px-2 py-2 text-center last:border-r-0 dark:border-surface-800">
                    <div className="text-xs text-surface-600">{WEEKDAYS[(day.getDay() + 6) % 7]}</div>
                    <div className={clsx(
                      'mx-auto mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold',
                      isToday ? 'bg-primary-600 text-white' : 'text-surface-900 dark:text-surface-100',
                    )}>
                      {day.getDate()}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Time slots */}
            <div className="flex-1 overflow-y-auto">
              <div className="grid grid-cols-[60px_repeat(7,1fr)]">
                {Array.from({ length: 24 }, (_, hour) => (
                  <div key={hour} className="contents">
                    <div className="flex h-12 items-start justify-end border-b border-r border-surface-200 pr-2 pt-0.5 text-[10px] text-surface-600 dark:border-surface-800">
                      {String(hour).padStart(2, '0')}:00
                    </div>
                    {weekDays.map((day) => {
                      const key = dateKey(day);
                      const dayEvents = eventsByDate.get(key) || [];
                      const hourEvents = dayEvents.filter((e) => {
                        if (e.allday === '1') return hour === 0;
                        const h = new Date(e.start * 1000).getHours();
                        return h === hour;
                      });

                      return (
                        <div
                          key={`${key}-${hour}`}
                          onClick={() => {
                            const d = new Date(day);
                            d.setHours(hour, 0, 0, 0);
                            setCreateDate(d);
                            setShowCreate(true);
                          }}
                          className="relative h-12 cursor-pointer border-b border-r border-surface-200 hover:bg-surface-50 last:border-r-0 dark:border-surface-800 dark:hover:bg-surface-900"
                        >
                          {hourEvents.map((evt) => {
                            const color = getEventColor(evt);
                            return (
                              <button
                                key={evt.id}
                                onClick={(e) => { e.stopPropagation(); setSelectedEvent(evt); }}
                                className={clsx(
                                  'absolute inset-x-0.5 z-10 truncate rounded px-1 py-0.5 text-left text-[10px] leading-tight',
                                  color.bg, color.text, color.border, 'border-l-2',
                                )}
                                style={{ top: 1 }}
                              >
                                <span className="font-medium">{formatTime(evt.start)}</span> {evt.name}
                              </button>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Agenda Sidebar */}
      {agendaOpen && (
        <div className="flex w-72 shrink-0 flex-col border-l border-surface-200 bg-surface-50 dark:border-surface-700 dark:bg-surface-900">
          <div className="flex shrink-0 items-center justify-between border-b border-surface-200 px-4 py-3 dark:border-surface-700">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-600">Agenda · nächste 30 Tage</h3>
            <button
              onClick={() => setAgendaOpen(false)}
              className="rounded p-0.5 text-surface-600 hover:bg-surface-200 dark:hover:bg-surface-700"
            >
              <X size={14} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <AgendaPanel
              events={filteredAgendaEvents}
              focusDate={agendaFocusDate}
              loading={agendaLoading}
              getEventColor={getEventColor}
              onEventClick={setSelectedEvent}
            />
          </div>
        </div>
      )}

      {/* Event Detail Modal */}
      {selectedEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setSelectedEvent(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-surface-900">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold text-surface-900 dark:text-white">{selectedEvent.name}</h3>
                {selectedEvent.type === 'channel' && (
                  <span className="text-xs text-surface-600">Channel: {String(
                    (selectedEvent.channel as Record<string, unknown>)?.name
                    ?? allChannelNames.get(String((selectedEvent.channel as Record<string, unknown>)?.id ?? selectedEvent.type_id))
                    ?? sources.find((s) => s.id === String((selectedEvent.channel as Record<string, unknown>)?.id ?? selectedEvent.type_id))?.name
                    ?? ''
                  )}</span>
                )}
              </div>
              <button onClick={() => setSelectedEvent(null)} className="rounded-lg p-1 text-surface-600 hover:bg-surface-200 dark:hover:bg-surface-800">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2 text-surface-600 dark:text-surface-400">
                <Clock size={15} className="shrink-0" />
                <span>
                  {selectedEvent.allday === '1'
                    ? `${formatDate(selectedEvent.start)} (ganztägig)`
                    : `${formatDate(selectedEvent.start)} ${formatTime(selectedEvent.start)} – ${formatTime(selectedEvent.end)}`}
                </span>
              </div>

              {selectedEvent.location && (
                <div className="flex items-center gap-2 text-surface-600 dark:text-surface-400">
                  <MapPin size={15} className="shrink-0" />
                  <span>{selectedEvent.location}</span>
                </div>
              )}

              {selectedEvent.repeat && selectedEvent.repeat !== 'none' && (
                <div className="flex items-center gap-2 text-surface-600 dark:text-surface-400">
                  <Repeat size={15} className="shrink-0" />
                  <span>Wiederholung: {selectedEvent.repeat}</span>
                </div>
              )}

              {selectedEvent.description && (
                <div className="rounded-lg bg-surface-50 p-3 text-surface-700 dark:bg-surface-800 dark:text-surface-400">
                  {selectedEvent.description}
                </div>
              )}

              {/* Invites / RSVP */}
              {selectedEvent.invites && selectedEvent.invites.length > 0 && (
                <div className="mt-2">
                  <div className="mb-1 flex items-center gap-1 text-xs font-semibold text-surface-600 uppercase">
                    <Users size={12} />
                    Einladungen ({selectedEvent.invites.length})
                  </div>
                  <div className="space-y-1">
                    {selectedEvent.invites.map((inv) => {
                      const name = `${inv.user.first_name ?? ''} ${inv.user.last_name ?? ''}`.trim() || String(inv.user.id);
                      const isMe = String(inv.user.id) === userId;
                      return (
                        <div key={inv.id} className="flex items-center gap-2">
                          {inv.status === 'accepted' && <Check size={13} className="text-green-500" />}
                          {inv.status === 'declined' && <XCircle size={13} className="text-red-500" />}
                          {inv.status === 'open' && <HelpCircle size={13} className="text-amber-500" />}
                          <span className={clsx('text-sm', isMe && 'font-semibold')}>{name}</span>
                          {isMe && inv.status === 'open' && (
                            <div className="ml-auto flex gap-1">
                              <button onClick={() => handleRespond(selectedEvent.id, 'accepted')} className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-700 hover:bg-green-200 dark:bg-green-900/30 dark:text-green-400">
                                Zusagen
                              </button>
                              <button onClick={() => handleRespond(selectedEvent.id, 'declined')} className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-700 hover:bg-red-200 dark:bg-red-900/30 dark:text-red-400">
                                Absagen
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Shared channels (main channel + channel_invites, deduplicated) */}
              {(() => {
                const sharedChannels: Array<{ id: string; name: string }> = [];
                const seenIds = new Set<string>();
                // Main channel (type_id)
                if (selectedEvent.type === 'channel' && selectedEvent.channel) {
                  const ch = selectedEvent.channel as Record<string, unknown>;
                  const cid = String(ch.id ?? selectedEvent.type_id);
                  seenIds.add(cid);
                  sharedChannels.push({
                    id: cid,
                    name: String(ch.name ?? allChannelNames.get(cid) ?? sources.find((s) => s.id === cid)?.name ?? 'Channel'),
                  });
                }
                // Channel invites
                if (selectedEvent.channel_invites) {
                  for (const ci of selectedEvent.channel_invites as Array<Record<string, unknown>>) {
                    const ch = ci.channel as Record<string, unknown> | undefined;
                    const cid = String(ci.channel_id ?? ch?.id ?? ci.id);
                    if (seenIds.has(cid)) continue;
                    seenIds.add(cid);
                    sharedChannels.push({
                      id: cid,
                      name: String(ch?.name ?? ci.name ?? allChannelNames.get(cid) ?? sources.find((s) => s.id === cid)?.name ?? `Channel ${cid}`),
                    });
                  }
                }
                if (sharedChannels.length === 0) return null;
                return (
                  <div className="mt-2">
                    <div className="mb-1 flex items-center gap-1 text-xs font-semibold text-surface-600 uppercase">
                      <Hash size={12} />
                      Geteilte Channels ({sharedChannels.length})
                    </div>
                    <div className="space-y-1">
                      {sharedChannels.map((sc) => (
                        <div key={sc.id} className="flex items-center gap-2 text-sm text-surface-600 dark:text-surface-400">
                          <Hash size={13} className="text-surface-600" />
                          <span>{sc.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Creator */}
              {selectedEvent.creator && (
                <div className="text-xs text-surface-600">
                  Erstellt von: {selectedEvent.creator.first_name} {selectedEvent.creator.last_name}
                </div>
              )}
            </div>

            {/* Actions — Point 5: only show edit/delete for own events */}
            <div className="mt-4 flex justify-end gap-2">
              {isOwnEvent(selectedEvent) && (
                <>
                  <button
                    onClick={() => {
                      setEditEvent(selectedEvent);
                      setSelectedEvent(null);
                    }}
                    className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-primary-600 hover:bg-primary-50 dark:text-primary-400 dark:hover:bg-primary-900/20"
                  >
                    <Pencil size={13} /> Bearbeiten
                  </button>
                  <button
                    onClick={() => handleDelete(selectedEvent.id)}
                    className="flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                  >
                    <Trash2 size={13} /> Löschen
                  </button>
                </>
              )}
              <button
                onClick={() => setSelectedEvent(null)}
                className="rounded-lg bg-surface-100 px-3 py-1.5 text-xs font-medium text-surface-700 hover:bg-surface-200 dark:bg-surface-800 dark:text-surface-400"
              >
                Schließen
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Event Modal */}
      {showCreate && <CreateEventModal
        initialDate={createDate}
        onClose={() => setShowCreate(false)}
        onCreated={() => {
          setShowCreate(false);
          loadEvents();
        }}
      />}

      {/* Edit Event Modal */}
      {editEvent && <CreateEventModal
        initialDate={null}
        editingEvent={editEvent}
        onClose={() => setEditEvent(null)}
        onCreated={() => {
          setEditEvent(null);
          loadEvents();
        }}
      />}
    </div>
  );
}

// Helper: get ISO week number
function getWeekNumber(d: Date): number {
  const date = new Date(d.getTime());
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const week1 = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(((date.getTime() - week1.getTime()) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
}

// ── Agenda Panel ─────────────────────────────────────────────────────────────

function AgendaPanel({
  events,
  focusDate,
  loading,
  getEventColor,
  onEventClick,
}: {
  events: CalendarEvent[];
  focusDate: Date | null;
  loading: boolean;
  getEventColor: (e: CalendarEvent) => typeof CALENDAR_COLORS[0];
  onEventClick: (e: CalendarEvent) => void;
}) {
  const dayRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // Build 30-day list: always include today, only other days if they have events
  const groups = useMemo(() => {
    const todayDate = new Date();
    const result: Array<{ date: Date; key: string; dayEvents: CalendarEvent[] }> = [];
    for (let i = 0; i < 30; i++) {
      const d = new Date(todayDate.getFullYear(), todayDate.getMonth(), todayDate.getDate() + i);
      const key = dateKey(d);
      const dayEvents = events
        .filter((e) => dateKey(new Date(e.start * 1000)) === key)
        .sort((a, b) => a.start - b.start);
      if (i === 0 || dayEvents.length > 0) {
        result.push({ date: d, key, dayEvents });
      }
    }
    return result;
  }, [events]);

  // Scroll to focusDate when it changes
  useEffect(() => {
    if (!focusDate) return;
    const key = dateKey(focusDate);
    const el = dayRefs.current.get(key);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focusDate]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 size={16} className="animate-spin text-primary-400" />
      </div>
    );
  }

  const today = new Date();

  return (
    <div className="h-full overflow-y-auto">
      {groups.map(({ date, key, dayEvents }) => {
        const isToday = isSameDay(date, today);
        const isFocused = focusDate ? isSameDay(date, focusDate) : false;
        const label = isToday
          ? 'Heute'
          : date.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });

        return (
          <div key={key} ref={(el) => { if (el) dayRefs.current.set(key, el); else dayRefs.current.delete(key); }}>
            {/* Day header */}
            <div className={clsx(
              'sticky top-0 z-10 border-b px-4 py-2',
              isFocused
                ? 'bg-primary-50 border-primary-200 dark:bg-primary-900/20 dark:border-primary-800'
                : 'bg-surface-50 border-surface-200 dark:bg-surface-900 dark:border-surface-700',
            )}>
              <span className={clsx(
                'text-xs font-semibold',
                isToday ? 'text-primary-600 dark:text-primary-400' : 'text-surface-600 dark:text-surface-400',
              )}>
                {label}
              </span>
            </div>

            {/* Events for this day */}
            <div className="space-y-0.5 px-2 py-1.5">
              {dayEvents.length === 0 ? (
                <div className="py-1 pl-2 text-xs text-surface-600">Keine Termine</div>
              ) : dayEvents.map((evt) => {
                const color = getEventColor(evt);
                const isAllDay = evt.allday === '1';
                return (
                  <button
                    key={evt.id}
                    onClick={() => onEventClick(evt)}
                    className="flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition hover:bg-surface-200 dark:hover:bg-surface-800"
                  >
                    <span className={clsx('mt-1.5 h-2 w-2 shrink-0 rounded-full', color.dot)} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-surface-900 dark:text-surface-100">
                        {evt.name}
                      </div>
                      <div className="text-xs text-surface-600">
                        {isAllDay ? 'Ganztägig' : `${formatTime(evt.start)} – ${formatTime(evt.end)}`}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

