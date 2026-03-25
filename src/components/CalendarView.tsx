import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ChevronLeft, ChevronRight, Plus, X, Loader2,
  MapPin, Clock, Repeat, Check, XCircle, HelpCircle,
  Eye, EyeOff, ChevronDown, Pencil, Trash2, Users, Hash, Search,
} from 'lucide-react';
import { clsx } from 'clsx';
import * as api from '../api';
import type { CalendarEvent } from '../api';
import { useAuth } from '../context/AuthContext';

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

export default function CalendarView() {
  const { user } = useAuth();
  const userId = String((user as Record<string, unknown>)?.id ?? '');

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

  // Map of all channel IDs → names (for resolving names in event details)
  const [allChannelNames, setAllChannelNames] = useState<Map<string, string>>(new Map());

  // Load channel calendars + all channel names on mount
  useEffect(() => {
    api.getCompanies().then((companies) => {
      const cids = (companies as Array<Record<string, unknown>>).map((c) => String(c.id));

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
          for (const ch of channels as Array<Record<string, unknown>>) {
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

  // Filter events by visible sources
  const visibleSourceIds = useMemo(() => new Set(sources.filter((s) => s.visible).map((s) => s.id)), [sources]);
  const filteredEvents = useMemo(() => {
    return events.filter((e) => {
      if (e.type === 'personal') return visibleSourceIds.has('personal');
      if (e.type === 'channel' && e.type_id) return visibleSourceIds.has(String(e.type_id));
      return visibleSourceIds.has('personal'); // fallback
    });
  }, [events, visibleSourceIds]);

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
      {/* Sidebar — Calendar filters */}
      <div className="flex w-56 shrink-0 flex-col border-r border-surface-200 bg-surface-50 dark:border-surface-700 dark:bg-surface-900">
        <div className="shrink-0 border-b border-surface-200 px-4 py-3 dark:border-surface-700">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-surface-500">Kalender</h3>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {/* Personal calendar category */}
          <div className="mb-1">
            <button
              onClick={() => setPersonalCollapsed(!personalCollapsed)}
              className="flex w-full items-center gap-1 rounded-md px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-wider text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800"
            >
              {personalCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
              <span className="flex-1">Persönlich</span>
              <button
                onClick={(e) => { e.stopPropagation(); toggleCategory('personal'); }}
                className="rounded p-0.5 hover:bg-surface-200 dark:hover:bg-surface-700"
                title={personalSources.every((s) => s.visible) ? 'Alle ausblenden' : 'Alle einblenden'}
              >
                {personalSources.every((s) => s.visible) ? <Eye size={11} className="text-surface-400" /> : <EyeOff size={11} className="text-surface-300" />}
              </button>
            </button>
            {!personalCollapsed && personalSources.map((src) => {
              const color = CALENDAR_COLORS[src.colorIndex];
              return (
                <button
                  key={src.id}
                  onClick={() => toggleSource(src.id)}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 pl-6 text-left text-sm transition hover:bg-surface-100 dark:hover:bg-surface-800"
                >
                  <span className={clsx('h-2.5 w-2.5 shrink-0 rounded-full', src.visible ? color.dot : 'bg-surface-300 dark:bg-surface-600')} />
                  <span className={clsx('min-w-0 flex-1 truncate', src.visible ? 'text-surface-900 dark:text-surface-100' : 'text-surface-400 line-through')}>
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
                className="flex w-full items-center gap-1 rounded-md px-2 py-1 text-left text-[11px] font-semibold uppercase tracking-wider text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800"
              >
                {channelsCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                <span className="flex-1">Channel-Kalender</span>
                <button
                  onClick={(e) => { e.stopPropagation(); toggleCategory('channel'); }}
                  className="rounded p-0.5 hover:bg-surface-200 dark:hover:bg-surface-700"
                  title={channelSources.every((s) => s.visible) ? 'Alle ausblenden' : 'Alle einblenden'}
                >
                  {channelSources.every((s) => s.visible) ? <Eye size={11} className="text-surface-400" /> : <EyeOff size={11} className="text-surface-300" />}
                </button>
              </button>
              {!channelsCollapsed && channelSources.map((src) => {
                const color = CALENDAR_COLORS[src.colorIndex];
                return (
                  <button
                    key={src.id}
                    onClick={() => toggleSource(src.id)}
                    className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 pl-6 text-left text-sm transition hover:bg-surface-100 dark:hover:bg-surface-800"
                  >
                    <span className={clsx('h-2.5 w-2.5 shrink-0 rounded-full', src.visible ? color.dot : 'bg-surface-300 dark:bg-surface-600')} />
                    <span className={clsx('min-w-0 flex-1 truncate', src.visible ? 'text-surface-900 dark:text-surface-100' : 'text-surface-400 line-through')}>
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
            <button onClick={() => navigate(-1)} className="rounded-lg p-1.5 text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800">
              <ChevronLeft size={18} />
            </button>
            <button onClick={() => navigate(1)} className="rounded-lg p-1.5 text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800">
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
                  : 'text-surface-500 hover:text-surface-700 dark:text-surface-400',
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
                  : 'text-surface-500 hover:text-surface-700 dark:text-surface-400',
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

          {loading && <Loader2 size={16} className="animate-spin text-primary-400" />}
        </div>

        {/* Grid */}
        {viewMode === 'month' ? (
          <div className="flex min-h-0 flex-1 flex-col">
            {/* Weekday headers */}
            <div className="grid shrink-0 grid-cols-7 border-b border-surface-200 dark:border-surface-700">
              {WEEKDAYS.map((wd) => (
                <div key={wd} className="border-r border-surface-100 px-2 py-1.5 text-center text-xs font-semibold text-surface-500 last:border-r-0 dark:border-surface-800">
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
                    onClick={() => { setCreateDate(day); setShowCreate(true); }}
                    className={clsx(
                      'flex min-h-0 cursor-pointer flex-col border-b border-r border-surface-100 p-1 transition hover:bg-surface-50 dark:border-surface-800 dark:hover:bg-surface-900',
                      !isCurrentMonth && 'bg-surface-50/50 dark:bg-surface-950/50',
                    )}
                  >
                    <div className={clsx(
                      'mb-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium',
                      isToday ? 'bg-primary-600 text-white' : isCurrentMonth ? 'text-surface-700 dark:text-surface-300' : 'text-surface-400',
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
                        <div className="px-1 text-[10px] font-medium text-surface-400">+{dayEvents.length - 3} weitere</div>
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
              <div className="border-r border-surface-100 dark:border-surface-800" /> {/* time column header */}
              {weekDays.map((day) => {
                const isToday = isSameDay(day, today);
                return (
                  <div key={dateKey(day)} className="border-r border-surface-100 px-2 py-2 text-center last:border-r-0 dark:border-surface-800">
                    <div className="text-xs text-surface-500">{WEEKDAYS[(day.getDay() + 6) % 7]}</div>
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
                    <div className="flex h-12 items-start justify-end border-b border-r border-surface-100 pr-2 pt-0.5 text-[10px] text-surface-400 dark:border-surface-800">
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
                          className="relative h-12 cursor-pointer border-b border-r border-surface-100 hover:bg-surface-50 last:border-r-0 dark:border-surface-800 dark:hover:bg-surface-900"
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

      {/* Event Detail Modal */}
      {selectedEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setSelectedEvent(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-surface-900">
            <div className="mb-4 flex items-start justify-between">
              <div>
                <h3 className="text-lg font-semibold text-surface-900 dark:text-white">{selectedEvent.name}</h3>
                {selectedEvent.type === 'channel' && (
                  <span className="text-xs text-surface-400">Channel: {String(
                    (selectedEvent.channel as Record<string, unknown>)?.name
                    ?? allChannelNames.get(String((selectedEvent.channel as Record<string, unknown>)?.id ?? selectedEvent.type_id))
                    ?? sources.find((s) => s.id === String((selectedEvent.channel as Record<string, unknown>)?.id ?? selectedEvent.type_id))?.name
                    ?? ''
                  )}</span>
                )}
              </div>
              <button onClick={() => setSelectedEvent(null)} className="rounded-lg p-1 text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800">
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3 text-sm">
              <div className="flex items-center gap-2 text-surface-600 dark:text-surface-300">
                <Clock size={15} className="shrink-0" />
                <span>
                  {selectedEvent.allday === '1'
                    ? `${formatDate(selectedEvent.start)} (ganztägig)`
                    : `${formatDate(selectedEvent.start)} ${formatTime(selectedEvent.start)} – ${formatTime(selectedEvent.end)}`}
                </span>
              </div>

              {selectedEvent.location && (
                <div className="flex items-center gap-2 text-surface-600 dark:text-surface-300">
                  <MapPin size={15} className="shrink-0" />
                  <span>{selectedEvent.location}</span>
                </div>
              )}

              {selectedEvent.repeat && selectedEvent.repeat !== 'none' && (
                <div className="flex items-center gap-2 text-surface-600 dark:text-surface-300">
                  <Repeat size={15} className="shrink-0" />
                  <span>Wiederholung: {selectedEvent.repeat}</span>
                </div>
              )}

              {selectedEvent.description && (
                <div className="rounded-lg bg-surface-50 p-3 text-surface-700 dark:bg-surface-800 dark:text-surface-300">
                  {selectedEvent.description}
                </div>
              )}

              {/* Invites / RSVP */}
              {selectedEvent.invites && selectedEvent.invites.length > 0 && (
                <div className="mt-2">
                  <div className="mb-1 flex items-center gap-1 text-xs font-semibold text-surface-500 uppercase">
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
                    <div className="mb-1 flex items-center gap-1 text-xs font-semibold text-surface-500 uppercase">
                      <Hash size={12} />
                      Geteilte Channels ({sharedChannels.length})
                    </div>
                    <div className="space-y-1">
                      {sharedChannels.map((sc) => (
                        <div key={sc.id} className="flex items-center gap-2 text-sm text-surface-600 dark:text-surface-300">
                          <Hash size={13} className="text-surface-400" />
                          <span>{sc.name}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* Creator */}
              {selectedEvent.creator && (
                <div className="text-xs text-surface-400">
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
                className="rounded-lg bg-surface-100 px-3 py-1.5 text-xs font-medium text-surface-700 hover:bg-surface-200 dark:bg-surface-800 dark:text-surface-300"
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

// ── Create / Edit Event Modal ────────────────────────────────────────────────

interface RawUser {
  id?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  image?: string;
}

interface RawChannel {
  id?: string;
  name?: string;
}

function CreateEventModal({ initialDate, editingEvent, onClose, onCreated }: {
  initialDate: Date | null;
  editingEvent?: CalendarEvent;
  onClose: () => void;
  onCreated: () => void;
}) {
  const isEdit = !!editingEvent;

  const [name, setName] = useState(editingEvent?.name ?? '');
  const [description, setDescription] = useState(editingEvent?.description ?? '');
  const [location, setLocation] = useState(editingEvent?.location ?? '');
  const [allday, setAllday] = useState(editingEvent?.allday === '1');
  const [repeat, setRepeat] = useState(editingEvent?.repeat ?? 'none');
  const [saving, setSaving] = useState(false);
  const [companyId, setCompanyId] = useState('');

  // Point 7: Event type/category
  type EventCategory = 'personal' | 'channel';
  const [category, setCategory] = useState<EventCategory>(
    editingEvent?.type === 'channel' ? 'channel' : 'personal'
  );
  const [selectedChannelId, setSelectedChannelId] = useState(
    editingEvent?.type === 'channel' ? String(editingEvent.type_id ?? '') : ''
  );

  // Invite selections
  const [inviteUserIds, setInviteUserIds] = useState<string[]>([]);
  const [inviteChannelIds, setInviteChannelIds] = useState<string[]>([]);

  // Data for pickers
  const [channels, setChannels] = useState<RawChannel[]>([]);
  const [searchResults, setSearchResults] = useState<RawUser[]>([]);
  const [loadingPicker, setLoadingPicker] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showPersonPicker, setShowPersonPicker] = useState(false);
  const [showChannelPicker, setShowChannelPicker] = useState(false);
  const [userSearchTimer, setUserSearchTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  // Cache of resolved user names for selected user IDs
  const [resolvedUsers, setResolvedUsers] = useState<Map<string, RawUser>>(new Map());

  // Default start/end from initialDate or editing event
  const defStart = editingEvent
    ? new Date(editingEvent.start * 1000)
    : (initialDate ?? new Date());
  const defEnd = editingEvent
    ? new Date(editingEvent.end * 1000)
    : new Date(defStart.getTime() + 3600_000); // +1h

  const [startStr, setStartStr] = useState(formatLocalDatetime(defStart));
  const [endStr, setEndStr] = useState(formatLocalDatetime(defEnd));

  // Get company ID and load channels on mount
  useEffect(() => {
    api.getCompanies().then((c) => {
      const arr = c as Array<Record<string, unknown>>;
      if (arr.length > 0) {
        const cid = String(arr[0].id);
        setCompanyId(cid);
        // Load channels for the channel picker
        api.getChannels(cid).then((chs) => {
          setChannels(chs as RawChannel[]);
        }).catch(() => {});
      }
    }).catch(() => {});
  }, []);

  // Search company users with debounce
  const searchUsers = useCallback((query: string) => {
    if (!companyId) return;
    setLoadingPicker(true);
    api.searchCompanyMembers(companyId, { search: query, limit: 50 }).then((result) => {
      setSearchResults(result.users as unknown as RawUser[]);
      // Cache resolved users for tag display
      setResolvedUsers((prev) => {
        const next = new Map(prev);
        for (const u of result.users) next.set(String(u.id), u as unknown as RawUser);
        return next;
      });
    }).catch(() => {}).finally(() => setLoadingPicker(false));
  }, [companyId]);

  // Trigger search on query change when picker is open
  useEffect(() => {
    if (!showPersonPicker) return;
    if (userSearchTimer) clearTimeout(userSearchTimer);
    const timer = setTimeout(() => searchUsers(searchQuery), searchQuery ? 300 : 0);
    setUserSearchTimer(timer);
    return () => clearTimeout(timer);
  }, [searchQuery, showPersonPicker]); // eslint-disable-line react-hooks/exhaustive-deps

  const filteredChannels = useMemo(() => {
    if (!searchQuery) return channels;
    const q = searchQuery.toLowerCase();
    return channels.filter((c) => c.name?.toLowerCase().includes(q));
  }, [channels, searchQuery]);

  const toggleInviteUser = (uid: string) => {
    setInviteUserIds((prev) => prev.includes(uid) ? prev.filter((x) => x !== uid) : [...prev, uid]);
  };

  const toggleInviteChannel = (cid: string) => {
    setInviteChannelIds((prev) => {
      const next = prev.includes(cid) ? prev.filter((x) => x !== cid) : [...prev, cid];
      // First selected channel becomes the type_id
      setSelectedChannelId(next.length > 0 ? next[0] : '');
      return next;
    });
  };

  const handleSave = async () => {
    if (!name.trim() || !companyId) return;
    if (category === 'channel' && inviteChannelIds.length === 0 && !selectedChannelId) {
      alert('Bitte wähle mindestens einen Channel aus.');
      return;
    }
    setSaving(true);
    try {
      const start = Math.floor(new Date(startStr).getTime() / 1000);
      const end = Math.floor(new Date(endStr).getTime() / 1000);
      const eventData: Record<string, unknown> = {
        name: name.trim(),
        description,
        location,
        start,
        end,
        type: category,
        type_id: category === 'channel' ? (inviteChannelIds[0] ?? selectedChannelId) : '',
        company_id: companyId,
        allday,
        repeat,
        invite_user_ids: category === 'personal' ? inviteUserIds : [],
        invite_channel_ids: category === 'channel' ? inviteChannelIds.slice(1) : [],
      };

      if (isEdit && editingEvent) {
        await api.editCalendarEvent(String(editingEvent.id), eventData);
      } else {
        await api.createCalendarEvent(eventData);
      }
      onCreated();
    } catch (err) {
      alert(`Fehler: ${err instanceof Error ? err.message : err}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl dark:bg-surface-900">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-surface-900 dark:text-white">
            {isEdit ? 'Termin bearbeiten' : 'Neuer Termin'}
          </h3>
          <button onClick={onClose} className="rounded-lg p-1 text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-3">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Titel *"
            autoFocus
            className="w-full rounded-lg bg-surface-100 px-3 py-2 text-sm text-surface-900 outline-none placeholder:text-surface-400 dark:bg-surface-800 dark:text-white"
          />

          {/* Point 7: Category selector */}
          <div>
            <label className="mb-1 block text-xs text-surface-500">Kategorie</label>
            <div className="flex rounded-lg bg-surface-100 p-0.5 dark:bg-surface-800">
              <button
                type="button"
                onClick={() => setCategory('personal')}
                className={clsx(
                  'flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition',
                  category === 'personal'
                    ? 'bg-white text-surface-900 shadow-sm dark:bg-surface-700 dark:text-white'
                    : 'text-surface-500 hover:text-surface-700 dark:text-surface-400',
                )}
              >
                Persönlich
              </button>
              <button
                type="button"
                onClick={() => setCategory('channel')}
                className={clsx(
                  'flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition',
                  category === 'channel'
                    ? 'bg-white text-surface-900 shadow-sm dark:bg-surface-700 dark:text-white'
                    : 'text-surface-500 hover:text-surface-700 dark:text-surface-400',
                )}
              >
                Channel
              </button>
            </div>
          </div>

          {/* Channel selector removed — channels are selected below in the unified picker */}

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-surface-600 dark:text-surface-400">
              <input type="checkbox" checked={allday} onChange={(e) => setAllday(e.target.checked)} className="rounded" />
              Ganztägig
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs text-surface-500">Start</label>
              <input
                type={allday ? 'date' : 'datetime-local'}
                value={allday ? startStr.slice(0, 10) : startStr}
                onChange={(e) => setStartStr(allday ? e.target.value + 'T00:00' : e.target.value)}
                className="w-full rounded-lg bg-surface-100 px-3 py-1.5 text-sm text-surface-900 outline-none dark:bg-surface-800 dark:text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-surface-500">Ende</label>
              <input
                type={allday ? 'date' : 'datetime-local'}
                value={allday ? endStr.slice(0, 10) : endStr}
                onChange={(e) => setEndStr(allday ? e.target.value + 'T23:59' : e.target.value)}
                className="w-full rounded-lg bg-surface-100 px-3 py-1.5 text-sm text-surface-900 outline-none dark:bg-surface-800 dark:text-white"
              />
            </div>
          </div>

          <input
            type="text"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            placeholder="Ort"
            className="w-full rounded-lg bg-surface-100 px-3 py-2 text-sm text-surface-900 outline-none placeholder:text-surface-400 dark:bg-surface-800 dark:text-white"
          />

          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Beschreibung"
            rows={3}
            className="w-full rounded-lg bg-surface-100 px-3 py-2 text-sm text-surface-900 outline-none placeholder:text-surface-400 dark:bg-surface-800 dark:text-white resize-none"
          />

          <div>
            <label className="mb-1 block text-xs text-surface-500">Wiederholung</label>
            <select
              value={repeat}
              onChange={(e) => setRepeat(e.target.value)}
              className="w-full rounded-lg bg-surface-100 px-3 py-2 text-sm text-surface-900 outline-none dark:bg-surface-800 dark:text-white"
            >
              <option value="none">Keine</option>
              <option value="daily">Täglich</option>
              <option value="weekly">Wöchentlich</option>
              <option value="monthly">Monatlich</option>
              <option value="yearly">Jährlich</option>
            </select>
          </div>

          {/* Context-dependent invite section */}
          {!isEdit && category === 'personal' && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-xs text-surface-500">Personen einladen</label>
                <button
                  type="button"
                  onClick={() => { setShowPersonPicker(!showPersonPicker); setSearchQuery(''); }}
                  className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400"
                >
                  <Users size={12} /> {showPersonPicker ? 'Schließen' : 'Auswählen'}
                </button>
              </div>

              {inviteUserIds.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1">
                  {inviteUserIds.map((uid) => {
                    const u = resolvedUsers.get(uid);
                    const uname = u ? `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() : uid;
                    return (
                      <span key={uid} className="flex items-center gap-1 rounded-full bg-primary-100 px-2 py-0.5 text-xs text-primary-700 dark:bg-primary-900/30 dark:text-primary-300">
                        {uname}
                        <button onClick={() => toggleInviteUser(uid)} className="hover:text-primary-900"><X size={10} /></button>
                      </span>
                    );
                  })}
                </div>
              )}

              {showPersonPicker && (
                <div className="rounded-lg border border-surface-200 dark:border-surface-700">
                  <div className="flex items-center gap-2 border-b border-surface-200 px-3 py-1.5 dark:border-surface-700">
                    <Search size={13} className="text-surface-400" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Name oder E-Mail..."
                      className="w-full bg-transparent text-sm outline-none placeholder:text-surface-400 text-surface-900 dark:text-white"
                    />
                  </div>
                  <div className="max-h-36 overflow-y-auto p-1">
                    {loadingPicker ? (
                      <div className="flex justify-center py-3"><Loader2 size={16} className="animate-spin text-primary-400" /></div>
                    ) : searchResults.length === 0 ? (
                      <p className="py-2 text-center text-xs text-surface-400">{searchQuery ? 'Keine Treffer' : 'Name eingeben...'}</p>
                    ) : (
                      searchResults.map((u) => {
                        const uid = String(u.id);
                        const uname = `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() || u.email || uid;
                        const selected = inviteUserIds.includes(uid);
                        return (
                          <button
                            key={uid}
                            type="button"
                            onClick={() => toggleInviteUser(uid)}
                            className={clsx(
                              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition',
                              selected ? 'bg-primary-50 dark:bg-primary-900/20' : 'hover:bg-surface-100 dark:hover:bg-surface-800',
                            )}
                          >
                            <div className={clsx(
                              'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                              selected ? 'border-primary-500 bg-primary-500 text-white' : 'border-surface-300 dark:border-surface-600',
                            )}>
                              {selected && <Check size={10} />}
                            </div>
                            <span className="truncate text-surface-900 dark:text-surface-100">{uname}</span>
                            {u.email && <span className="ml-auto truncate text-xs text-surface-400">{u.email}</span>}
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Channel type: additional channel invites */}
          {!isEdit && category === 'channel' && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-xs text-surface-500">Channels auswählen *</label>
                <button
                  type="button"
                  onClick={() => { setShowChannelPicker(!showChannelPicker); setSearchQuery(''); }}
                  className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 dark:text-primary-400"
                >
                  <Hash size={12} /> {showChannelPicker ? 'Schließen' : 'Auswählen'}
                </button>
              </div>

              {inviteChannelIds.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1">
                  {inviteChannelIds.map((cid) => {
                    const ch = channels.find((x) => String(x.id) === cid);
                    return (
                      <span key={cid} className="flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900/30 dark:text-green-300">
                        # {ch?.name ?? cid}
                        <button onClick={() => toggleInviteChannel(cid)} className="hover:text-green-900"><X size={10} /></button>
                      </span>
                    );
                  })}
                </div>
              )}

              {showChannelPicker && (
                <div className="rounded-lg border border-surface-200 dark:border-surface-700">
                  <div className="flex items-center gap-2 border-b border-surface-200 px-3 py-1.5 dark:border-surface-700">
                    <Search size={13} className="text-surface-400" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Channel suchen..."
                      className="w-full bg-transparent text-sm outline-none placeholder:text-surface-400 text-surface-900 dark:text-white"
                    />
                  </div>
                  <div className="max-h-36 overflow-y-auto p-1">
                    {filteredChannels.length === 0 ? (
                      <p className="py-2 text-center text-xs text-surface-400">Keine Channels</p>
                    ) : (
                      filteredChannels.map((ch) => {
                        const cid = String(ch.id);
                        const selected = inviteChannelIds.includes(cid);
                        return (
                          <button
                            key={cid}
                            type="button"
                            onClick={() => toggleInviteChannel(cid)}
                            className={clsx(
                              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition',
                              selected ? 'bg-green-50 dark:bg-green-900/20' : 'hover:bg-surface-100 dark:hover:bg-surface-800',
                            )}
                          >
                            <div className={clsx(
                              'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                              selected ? 'border-green-500 bg-green-500 text-white' : 'border-surface-300 dark:border-surface-600',
                            )}>
                              {selected && <Check size={10} />}
                            </div>
                            <Hash size={13} className="shrink-0 text-surface-400" />
                            <span className="truncate text-surface-900 dark:text-surface-100">{ch.name}</span>
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-surface-600 hover:bg-surface-100 dark:text-surface-400 dark:hover:bg-surface-800">
            Abbrechen
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !name.trim()}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : isEdit ? 'Speichern' : 'Erstellen'}
          </button>
        </div>
      </div>
    </div>
  );
}

function formatLocalDatetime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
