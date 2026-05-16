import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  X, Loader2, Check, Users, Hash, Search,
} from 'lucide-react';
import { FocusTrap } from 'focus-trap-react';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { clsx } from 'clsx';
import * as api from '../api';
import type { CalendarEvent } from '../api';
import type { ChatTarget, RawUser } from '../types';
import { getCleanName } from '../utils/subchannels';
import MobileSheet from './MobileSheet';

interface RawChannel {
  id?: string;
  name?: string;
}

function formatLocalDatetime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function CreateEventModal({ initialDate, editingEvent, preselectedChat, onClose, onCreated }: {
  initialDate: Date | null;
  editingEvent?: CalendarEvent;
  preselectedChat?: ChatTarget;
  onClose: () => void;
  onCreated: (eventId?: string) => void;
}) {
  useEscapeKey(onClose);
  const isEdit = !!editingEvent;

  const [name, setName] = useState(editingEvent?.name ?? '');
  const [description, setDescription] = useState(editingEvent?.description ?? '');
  const [location, setLocation] = useState(editingEvent?.location ?? '');
  const [allday, setAllday] = useState(editingEvent?.allday === '1');
  const [repeat, setRepeat] = useState(editingEvent?.repeat ?? 'none');
  const [saving, setSaving] = useState(false);
  const [companyId, setCompanyId] = useState('');

  // Event type/category
  type EventCategory = 'personal' | 'channel';
  const [category, setCategory] = useState<EventCategory>(
    editingEvent?.type === 'channel' ? 'channel'
      : preselectedChat?.type === 'channel' ? 'channel'
      : 'personal'
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

  // Existing invitees on the event being edited (used to mark them as already invited)
  const existingInvitedUserIds = useMemo<Set<string>>(() => {
    if (!editingEvent?.invites) return new Set();
    return new Set(editingEvent.invites.map((inv) => String(inv.user.id)));
  }, [editingEvent]);

  const existingInvitedChannelIds = useMemo<Set<string>>(() => {
    const ids = new Set<string>();
    if (editingEvent?.type === 'channel' && editingEvent.type_id) {
      ids.add(String(editingEvent.type_id));
    }
    if (editingEvent?.channel_invites) {
      for (const ci of editingEvent.channel_invites as Array<Record<string, unknown>>) {
        const ch = ci.channel as Record<string, unknown> | undefined;
        const cid = String(ci.channel_id ?? ch?.id ?? ci.id ?? '');
        if (cid) ids.add(cid);
      }
    }
    return ids;
  }, [editingEvent]);

  // Get company ID and load channels on mount
  useEffect(() => {
    api.getCompanies().then((c) => {
      if (c.length > 0) {
        const cid = String(c[0].id);
        setCompanyId(cid);
        // Load channels for the channel picker
        api.getChannels(cid).then((chs) => {
          setChannels(chs as RawChannel[]);
        }).catch(() => {});
      }
    }).catch(() => {});
  }, []);

  // Preselect channel or conversation members
  useEffect(() => {
    if (!preselectedChat || isEdit) return;

    if (preselectedChat.type === 'channel') {
      const cid = preselectedChat.id;
      setInviteChannelIds([cid]);
      setSelectedChannelId(cid);
    } else if (preselectedChat.type === 'conversation') {
      // Load conversation members
      api.getConversation(preselectedChat.id).then((conv) => {
        const memberIds = conv.members.map((m) => String(m.id));
        setInviteUserIds(memberIds);
        // Cache member names for display
        setResolvedUsers((prev) => {
          const next = new Map(prev);
          for (const m of conv.members) {
            next.set(String(m.id), {
              id: String(m.id),
              first_name: m.first_name,
              last_name: m.last_name,
              image: m.image,
            });
          }
          return next;
        });
      }).catch(() => {});
    }
  }, [preselectedChat, isEdit]);

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
    return channels.filter((c) => getCleanName(c.name ?? '').toLowerCase().includes(q));
  }, [channels, searchQuery]);

  const toggleInviteUser = (uid: string) => {
    setInviteUserIds((prev) => prev.includes(uid) ? prev.filter((x) => x !== uid) : [...prev, uid]);
  };

  const toggleInviteChannel = (cid: string) => {
    setInviteChannelIds((prev) => {
      const next = prev.includes(cid) ? prev.filter((x) => x !== cid) : [...prev, cid];
      // In create mode, the first selected channel becomes the main type_id.
      // In edit mode, the original type_id stays; new selections are additive invites.
      if (!isEdit) {
        setSelectedChannelId(next.length > 0 ? next[0] : '');
      }
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

      // Identify truly new additions (for the notification messages).
      const newInviteUserIds = inviteUserIds.filter((uid) => !existingInvitedUserIds.has(uid));
      const newInviteChannelIds = inviteChannelIds.filter((cid) => !existingInvitedChannelIds.has(cid));

      // In edit mode preserve the original event type and main channel; in create mode use the selection.
      const effectiveType = isEdit && editingEvent ? editingEvent.type : category;
      const effectiveTypeId = isEdit && editingEvent
        ? String(editingEvent.type_id ?? '')
        : (category === 'channel' ? (inviteChannelIds[0] ?? selectedChannelId) : '');

      // For create: same semantics as before.
      // For edit: the backend REPLACES invite lists with the values it receives, so we must
      // re-send EVERY existing channel ID (including the main type_id — the original web
      // client includes it in invite_channel_ids too) plus any new ones.
      const existingChannelIdsAll = isEdit ? [...existingInvitedChannelIds] : [];
      const existingUserIds = isEdit ? [...existingInvitedUserIds] : [];

      const sendUserIds = isEdit
        ? [...existingUserIds, ...newInviteUserIds]
        : (category === 'personal' ? inviteUserIds : []);
      const sendChannelIds = isEdit
        ? [...existingChannelIdsAll, ...newInviteChannelIds]
        : (category === 'channel' ? inviteChannelIds.slice(1) : []);

      // Stashcat expects numeric IDs in the JSON arrays (the official web client sends
      // [4684531,...] not ["4684531",...]). Coerce string IDs to numbers, dropping anything
      // that isn't a finite integer.
      const toNumericIds = (ids: string[]): number[] => ids
        .map((s) => Number(s))
        .filter((n) => Number.isFinite(n));

      const eventData: Record<string, unknown> = {
        name: name.trim(),
        description,
        location,
        start,
        end,
        type: effectiveType,
        type_id: effectiveTypeId,
        company_id: companyId,
        allday,
        repeat,
        invite_user_ids: toNumericIds(sendUserIds),
        invite_channel_ids: toNumericIds(sendChannelIds),
        // notify_chat_id is intentionally omitted — the frontend sends chat notifications
        // itself (see the targets loop below) to avoid duplicate messages.
      };

      let savedEventId: string | undefined;
      if (isEdit && editingEvent) {
        await api.editCalendarEvent(String(editingEvent.id), eventData);
        savedEventId = String(editingEvent.id);

        // Notify newly added channels in chat (mirrors the create-mode behaviour).
        if (newInviteChannelIds.length > 0) {
          const startDate = new Date(start * 1000);
          const endDate = new Date(end * 1000);
          const dateStr = allday
            ? startDate.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
            : `${startDate.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}, ${startDate.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} – ${endDate.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
          const messageText = `**Termin geteilt: ${name.trim()}**\n📅 ${dateStr}${location ? `\n📍 ${location}` : ''}\n\nDetails im Kalender ansehen. [%event:${editingEvent.id}%]`;
          for (const cid of newInviteChannelIds) {
            try {
              await api.sendMessage(cid, 'channel', messageText);
            } catch {
              // Ignore — the event update already succeeded.
            }
          }
        }
      } else {
        const { id: eventId } = await api.createCalendarEvent(eventData);
        savedEventId = eventId ? String(eventId) : undefined;

        // Send notification messages to all relevant chats
        if (eventId) {
          const targets: Array<{ id: string; type: 'channel' | 'conversation' }> = [];

          if (category === 'channel') {
            for (const cid of inviteChannelIds) {
              if (!targets.some((t) => t.id === cid && t.type === 'channel')) {
                targets.push({ id: cid, type: 'channel' });
              }
            }
          }

          if (preselectedChat && !isEdit) {
            if (!targets.some((t) => t.id === preselectedChat.id && t.type === preselectedChat.type)) {
              targets.push({ id: preselectedChat.id, type: preselectedChat.type });
            }
          }

          const startDate = new Date(start * 1000);
          const endDate = new Date(end * 1000);
          const dateStr = allday
            ? startDate.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
            : `${startDate.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })}, ${startDate.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} – ${endDate.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;

          const messageText = `**Neuer Termin: ${name.trim()}**\n📅 ${dateStr}${location ? `\n📍 ${location}` : ''}\n\nDetails im Kalender ansehen. [%event:${eventId}%]`;

          for (const target of targets) {
            try {
              await api.sendMessage(target.id, target.type, messageText);
            } catch {
              // Ignore send errors — event was already created successfully
            }
          }
        }
      }
      onCreated(savedEventId);
    } catch (err) {
      alert(`Fehler: ${err instanceof Error ? err.message : err}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <MobileSheet open onClose={onClose} ariaLabel={isEdit ? 'Termin bearbeiten' : 'Neuer Termin'}>
      <FocusTrap focusTrapOptions={{ escapeDeactivates: false, allowOutsideClick: true }}>
      <div className="flex flex-col p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-surface-900 dark:text-white">
            {isEdit ? 'Termin bearbeiten' : 'Neuer Termin'}
          </h3>
          <button onClick={onClose} className="rounded-lg p-1 text-surface-600 hover:bg-surface-200 dark:hover:bg-surface-800">
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
            className="w-full rounded-lg bg-surface-100 px-3 py-2 text-sm text-surface-900 outline-none placeholder:text-surface-600 dark:bg-surface-800 dark:text-white"
          />

          {/* Category selector */}
          <div>
            <label className="mb-1 block text-xs text-surface-600">Kategorie</label>
            <div className="flex rounded-lg bg-surface-100 p-0.5 dark:bg-surface-800">
              <button
                type="button"
                onClick={() => setCategory('personal')}
                disabled={isEdit}
                className={clsx(
                  'flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition',
                  category === 'personal'
                    ? 'bg-white text-surface-900 shadow-sm dark:bg-surface-700 dark:text-white'
                    : 'text-surface-600 hover:text-surface-700 dark:text-surface-400',
                  isEdit && 'cursor-not-allowed opacity-60',
                )}
              >
                Persönlich
              </button>
              <button
                type="button"
                onClick={() => setCategory('channel')}
                disabled={isEdit}
                className={clsx(
                  'flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition',
                  category === 'channel'
                    ? 'bg-white text-surface-900 shadow-sm dark:bg-surface-700 dark:text-white'
                    : 'text-surface-600 hover:text-surface-700 dark:text-surface-400',
                  isEdit && 'cursor-not-allowed opacity-60',
                )}
              >
                Channel
              </button>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-surface-600 dark:text-surface-400">
              <input type="checkbox" checked={allday} onChange={(e) => setAllday(e.target.checked)} className="rounded" />
              Ganztägig
            </label>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-1 block text-xs text-surface-600">Start</label>
              <input
                type={allday ? 'date' : 'datetime-local'}
                value={allday ? startStr.slice(0, 10) : startStr}
                onChange={(e) => setStartStr(allday ? e.target.value + 'T00:00' : e.target.value)}
                className="w-full rounded-lg bg-surface-100 px-3 py-1.5 text-sm text-surface-900 outline-none dark:bg-surface-800 dark:text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs text-surface-600">Ende</label>
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
            className="w-full rounded-lg bg-surface-100 px-3 py-2 text-sm text-surface-900 outline-none placeholder:text-surface-600 dark:bg-surface-800 dark:text-white"
          />

          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Beschreibung"
            rows={3}
            className="w-full rounded-lg bg-surface-100 px-3 py-2 text-sm text-surface-900 outline-none placeholder:text-surface-600 dark:bg-surface-800 dark:text-white resize-none"
          />

          <div>
            <label className="mb-1 block text-xs text-surface-600">Wiederholung</label>
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
          {category === 'personal' && (
            <div>
              {isEdit && existingInvitedUserIds.size > 0 && (
                <p className="mb-1 text-xs text-surface-600 dark:text-surface-400">
                  {existingInvitedUserIds.size} Person{existingInvitedUserIds.size === 1 ? '' : 'en'} bereits eingeladen — bestehende Einladungen bleiben erhalten.
                </p>
              )}
              <div className="mb-1 flex items-center justify-between">
                <label className="text-xs text-surface-600">
                  {isEdit ? 'Weitere Personen einladen' : 'Personen einladen'}
                </label>
                <button
                  type="button"
                  onClick={() => { setShowPersonPicker(!showPersonPicker); setSearchQuery(''); }}
                  className={clsx(
                    'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium shadow-sm transition',
                    showPersonPicker
                      ? 'bg-surface-200 text-surface-700 hover:bg-surface-300 dark:bg-surface-700 dark:text-surface-200 dark:hover:bg-surface-600'
                      : 'bg-primary-500 text-white hover:bg-primary-600',
                  )}
                >
                  <Users size={13} /> {showPersonPicker ? 'Schließen' : 'Auswählen'}
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
                    <Search size={13} className="text-surface-600" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Name oder E-Mail..."
                      className="w-full bg-transparent text-sm outline-none placeholder:text-surface-600 text-surface-900 dark:text-white"
                    />
                  </div>
                  <div className="max-h-36 overflow-y-auto p-1">
                    {loadingPicker ? (
                      <div className="flex justify-center py-3"><Loader2 size={16} className="animate-spin text-primary-400" /></div>
                    ) : searchResults.length === 0 ? (
                      <p className="py-2 text-center text-xs text-surface-600">{searchQuery ? 'Keine Treffer' : 'Name eingeben...'}</p>
                    ) : (
                      searchResults.map((u) => {
                        const uid = String(u.id);
                        const uname = `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() || u.email || uid;
                        const alreadyInvited = existingInvitedUserIds.has(uid);
                        const selected = inviteUserIds.includes(uid);
                        return (
                          <button
                            key={uid}
                            type="button"
                            onClick={() => { if (!alreadyInvited) toggleInviteUser(uid); }}
                            disabled={alreadyInvited}
                            className={clsx(
                              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition',
                              alreadyInvited ? 'cursor-not-allowed opacity-60'
                                : selected ? 'bg-primary-50 dark:bg-primary-900/20'
                                : 'hover:bg-surface-200 dark:hover:bg-surface-800',
                            )}
                          >
                            <div className={clsx(
                              'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                              alreadyInvited ? 'border-surface-400 bg-surface-300 text-surface-600 dark:border-surface-600 dark:bg-surface-700'
                                : selected ? 'border-primary-500 bg-primary-500 text-white'
                                : 'border-surface-300 dark:border-surface-600',
                            )}>
                              {(selected || alreadyInvited) && <Check size={10} />}
                            </div>
                            <span className="truncate text-surface-900 dark:text-surface-100">{uname}</span>
                            {alreadyInvited && <span className="ml-auto shrink-0 text-xs text-surface-600">bereits eingeladen</span>}
                            {!alreadyInvited && u.email && <span className="ml-auto truncate text-xs text-surface-600">{u.email}</span>}
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
          {category === 'channel' && (
            <div>
              {isEdit && existingInvitedChannelIds.size > 0 && (
                <p className="mb-1 text-xs text-surface-600 dark:text-surface-400">
                  Bereits geteilt mit {existingInvitedChannelIds.size} Channel{existingInvitedChannelIds.size === 1 ? '' : 's'} — bestehende Freigaben bleiben erhalten.
                </p>
              )}
              <div className="mb-1 flex items-center justify-between">
                <label className="text-xs text-surface-600">
                  {isEdit ? 'Mit weiteren Channels teilen' : 'Channels auswählen *'}
                </label>
                <button
                  type="button"
                  onClick={() => { setShowChannelPicker(!showChannelPicker); setSearchQuery(''); }}
                  className={clsx(
                    'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium shadow-sm transition',
                    showChannelPicker
                      ? 'bg-surface-200 text-surface-700 hover:bg-surface-300 dark:bg-surface-700 dark:text-surface-200 dark:hover:bg-surface-600'
                      : 'bg-primary-500 text-white hover:bg-primary-600',
                  )}
                >
                  <Hash size={13} /> {showChannelPicker ? 'Schließen' : 'Auswählen'}
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
                    <Search size={13} className="text-surface-600" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Channel suchen..."
                      className="w-full bg-transparent text-sm outline-none placeholder:text-surface-600 text-surface-900 dark:text-white"
                    />
                  </div>
                  <div className="max-h-36 overflow-y-auto p-1">
                    {filteredChannels.length === 0 ? (
                      <p className="py-2 text-center text-xs text-surface-600">Keine Channels</p>
                    ) : (
                      filteredChannels.map((ch) => {
                        const cid = String(ch.id);
                        const alreadyInvited = existingInvitedChannelIds.has(cid);
                        const selected = inviteChannelIds.includes(cid);
                        return (
                          <button
                            key={cid}
                            type="button"
                            onClick={() => { if (!alreadyInvited) toggleInviteChannel(cid); }}
                            disabled={alreadyInvited}
                            className={clsx(
                              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition',
                              alreadyInvited ? 'cursor-not-allowed opacity-60'
                                : selected ? 'bg-green-50 dark:bg-green-900/20'
                                : 'hover:bg-surface-200 dark:hover:bg-surface-800',
                            )}
                          >
                            <div className={clsx(
                              'flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                              alreadyInvited ? 'border-surface-400 bg-surface-300 text-surface-600 dark:border-surface-600 dark:bg-surface-700'
                                : selected ? 'border-green-500 bg-green-500 text-white'
                                : 'border-surface-300 dark:border-surface-600',
                            )}>
                              {(selected || alreadyInvited) && <Check size={10} />}
                            </div>
                            <Hash size={13} className="shrink-0 text-surface-600" />
                            <span className="truncate text-surface-900 dark:text-surface-100">{getCleanName(ch.name)}</span>
                            {alreadyInvited && <span className="ml-auto shrink-0 text-xs text-surface-600">bereits geteilt</span>}
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
          <button onClick={onClose} className="rounded-lg px-4 py-2 text-sm text-surface-600 hover:bg-surface-200 dark:text-surface-400 dark:hover:bg-surface-800">
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
      </FocusTrap>
    </MobileSheet>
  );
}
