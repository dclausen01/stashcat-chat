import { useState, useEffect } from 'react';
import { Bell, X, Loader2, Hash, CalendarDays, Smartphone, Shield, UserPlus, MessageSquare, Trash2, BarChart3, Key, Check, Ban } from 'lucide-react';
import { clsx } from 'clsx';
import * as api from '../api';
import Avatar from './Avatar';
import { useSettings } from '../context/SettingsContext';

interface NotificationsPanelProps {
  onClose: () => void;
  onOpenPolls?: () => void;
  onOpenPoll?: (pollId: string) => void;
  onOpenCalendar?: () => void;
}

/** Map API notification types to user-friendly German labels + icons */
const TYPE_MAP: Record<string, { label: string; icon: React.ReactNode }> = {
  key_request:             { label: 'Schlüsselanfrage',                icon: <Key size={16} className="text-amber-500" /> },
  key_sync_request:        { label: 'Schlüsselanfrage',                icon: <Key size={16} className="text-amber-500" /> },
  new_device_connected:    { label: 'Neues Gerät verbunden',           icon: <Smartphone size={16} className="text-green-500" /> },
  device_disconnected:     { label: 'Gerät getrennt',                  icon: <Smartphone size={16} className="text-surface-500" /> },
  new_login:               { label: 'Neue Anmeldung',                  icon: <Shield size={16} className="text-blue-500" /> },
  channel_invite:          { label: 'Einladung in einen Channel',      icon: <Hash size={16} className="text-primary-500" /> },
  channel_membership_gained: { label: 'Channel beigetreten',           icon: <Hash size={16} className="text-green-500" /> },
  channel_membership_lost: { label: 'Channel verlassen',               icon: <Hash size={16} className="text-surface-500" /> },
  channel_created:         { label: 'Neuer Channel erstellt',          icon: <Hash size={16} className="text-primary-500" /> },
  channel_deleted:         { label: 'Channel gelöscht',                icon: <Hash size={16} className="text-red-400" /> },
  channel_modified:        { label: 'Channel aktualisiert',            icon: <Hash size={16} className="text-amber-500" /> },
  new_invite:              { label: 'Neue Einladung',                  icon: <UserPlus size={16} className="text-primary-500" /> },
  event_invite:            { label: 'Einladung zu einem Termin',       icon: <CalendarDays size={16} className="text-amber-500" /> },
  event_changed:           { label: 'Termin aktualisiert',             icon: <CalendarDays size={16} className="text-amber-500" /> },
  event_deleted:           { label: 'Termin abgesagt',                 icon: <CalendarDays size={16} className="text-red-400" /> },
  message_sync:            { label: 'Neue Nachricht',                  icon: <MessageSquare size={16} className="text-primary-500" /> },
  notification:            { label: 'Benachrichtigung',                icon: <Bell size={16} className="text-primary-500" /> },
  // Poll / Survey types
  survey_invite:           { label: 'Einladung zu einer Umfrage',      icon: <BarChart3 size={16} className="text-primary-500" /> },
  poll_invite:             { label: 'Einladung zu einer Umfrage',      icon: <BarChart3 size={16} className="text-primary-500" /> },
  survey_created:          { label: 'Neue Umfrage erstellt',           icon: <BarChart3 size={16} className="text-primary-500" /> },
  survey_changed:          { label: 'Umfrage aktualisiert',            icon: <BarChart3 size={16} className="text-amber-500" /> },
  survey_published:        { label: 'Umfrage veröffentlicht',          icon: <BarChart3 size={16} className="text-green-500" /> },
  survey_closed:           { label: 'Umfrage beendet',                 icon: <BarChart3 size={16} className="text-surface-500" /> },
};

function getTypeInfo(type: string): { label: string; icon: React.ReactNode } {
  // Defensive: handle undefined/null/empty type
  const safeType = type || '';
  if (TYPE_MAP[safeType]) return TYPE_MAP[safeType];
  // Fuzzy match
  if (safeType.includes('key')) return { label: 'Schlüsselanfrage', icon: <Key size={16} className="text-amber-500" /> };
  if (safeType.includes('survey') || safeType.includes('poll')) return { label: 'Umfrage', icon: <BarChart3 size={16} className="text-primary-500" /> };
  if (safeType.includes('channel')) return { label: 'Channel-Benachrichtigung', icon: <Hash size={16} className="text-primary-500" /> };
  if (safeType.includes('event') || safeType.includes('calendar')) return { label: 'Kalender-Benachrichtigung', icon: <CalendarDays size={16} className="text-amber-500" /> };
  if (safeType.includes('device') || safeType.includes('login')) return { label: 'Geräte-Benachrichtigung', icon: <Smartphone size={16} className="text-green-500" /> };
  if (safeType.includes('invite')) return { label: 'Einladung', icon: <UserPlus size={16} className="text-primary-500" /> };
  // Fallback: humanize the snake_case type
  const humanized = safeType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return { label: humanized || 'Benachrichtigung', icon: <Bell size={16} className="text-surface-500" /> };
}

/** Parse key_request/key_sync_request notification content → requester user info */
function parseKeyRequestUser(content: unknown): { id: string; first_name: string; last_name: string; image?: string } | null {
  if (!content) return null;
  let parsed = content;
  if (typeof content === 'string') {
    try { parsed = JSON.parse(content); } catch { return null; }
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  if (!obj.id || !obj.first_name) return null;
  return {
    id: String(obj.id),
    first_name: String(obj.first_name || ''),
    last_name: String(obj.last_name || ''),
    image: obj.image ? String(obj.image) : undefined,
  };
}

/** Parse event notification content → event title + organizer */
function formatEventNotification(content: unknown): { title: string; organizer?: string } | null {
  if (!content || typeof content !== 'object') return null;
  const obj = content as Record<string, unknown>;
  // Must look like an event object (has id + name, but NOT poll-specific fields)
  if (!('id' in obj) || !('name' in obj)) return null;
  // Exclude poll/survey objects
  if ('creator' in obj && ('options' in obj || 'votes' in obj || 'status' in obj)) return null;
  // Exclude device objects
  if ('device_id' in obj || 'app_name' in obj) return null;

  // Check for event-like properties (start, end, location, organizer, creator with first/last name)
  const hasEventProps = 'start' in obj || 'end' in obj || 'location' in obj ||
    (obj.creator && typeof obj.creator === 'object' &&
     ('first_name' in (obj.creator as Record<string, unknown>)));

  if (!hasEventProps) return null;

  const title = `Termin: „${String(obj.name)}"`;
  const creator = obj.creator && typeof obj.creator === 'object'
    ? (obj.creator as Record<string, unknown>)
    : null;
  const organizer = creator
    ? `${String(creator.first_name ?? '')} ${String(creator.last_name ?? '')}`.trim()
    : undefined;

  return { title, organizer: organizer || undefined };
}

/** Parse poll/survey notification content → creator name + poll title */
function formatPollNotification(content: unknown): { title: string; creator?: string } | null {
  if (!content || typeof content !== 'object') return null;
  const obj = content as Record<string, unknown>;
  // Must look like a poll object (has id + creator or name)
  if (!('id' in obj) || (!('creator' in obj) && !('name' in obj))) return null;
  // Exclude device objects
  if ('device_id' in obj || 'app_name' in obj) return null;
  // Exclude event objects (events have start/end/location, polls have options/votes/status)
  if ('start' in obj || 'end' in obj || 'location' in obj) return null;

  const name = obj.name ? String(obj.name) : undefined;
  const creator = obj.creator && typeof obj.creator === 'object'
    ? (obj.creator as Record<string, unknown>)
    : null;
  const creatorName = creator
    ? `${String(creator.first_name ?? '')} ${String(creator.last_name ?? '')}`.trim()
    : undefined;

  return {
    title: name ? `Umfrage: „${name}"` : 'Umfrage',
    creator: creatorName || undefined,
  };
}

function formatTime(dateStr?: string) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffH = diffMs / 3600000;
  if (diffH < 1) return `vor ${Math.max(1, Math.round(diffMs / 60000))} Min.`;
  if (diffH < 24) return `vor ${Math.round(diffH)} Std.`;
  if (diffH < 48) return 'Gestern';
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

/** Format a timestamp (Unix seconds) to readable date */
function formatTimestamp(ts?: string | number) {
  if (!ts) return '';
  const num = typeof ts === 'string' ? Number(ts) : ts;
  if (isNaN(num) || num === 0) return '';
  const d = new Date(num * 1000);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

/** Parse and format device info from notification content */
function formatDeviceNotification(data: unknown): { title: string; details: string[] } | null {
  if (!data || typeof data !== 'object') return null;
  const obj = data as Record<string, unknown>;

  // Check if this looks like a device object
  if (!('device_id' in obj) && !('app_name' in obj)) return null;

  const details: string[] = [];
  const appName = String(obj.app_name || 'Unbekannte App');
  const ipAddress = obj.ip_address ? String(obj.ip_address) : null;
  const lastLogin = formatTimestamp(obj.last_login as string | number);

  if (ipAddress) details.push(`IP: ${ipAddress}`);
  if (lastLogin) details.push(`Zeitpunkt: ${lastLogin}`);

  return {
    title: `Gerät: ${appName}`,
    details,
  };
}

/** Try to parse content as JSON and format it nicely */
function formatNotificationContent(content: unknown): { text: string; subtext?: string } {
  if (!content) return { text: '' };

  // Parse JSON strings
  let parsed = content;
  if (typeof content === 'string') {
    try { parsed = JSON.parse(content); } catch { return { text: content }; }
  }

  // Try event/calendar notification first
  const eventInfo = formatEventNotification(parsed);
  if (eventInfo) {
    return {
      text: eventInfo.title,
      subtext: eventInfo.organizer ? `Eingeladen von ${eventInfo.organizer}` : undefined,
    };
  }

  // Try poll/survey notification
  const pollInfo = formatPollNotification(parsed);
  if (pollInfo) {
    return {
      text: pollInfo.title,
      subtext: pollInfo.creator ? `Eingeladen von ${pollInfo.creator}` : undefined,
    };
  }

  // Try device notification
  const deviceInfo = formatDeviceNotification(parsed);
  if (deviceInfo) {
    return {
      text: deviceInfo.title,
      subtext: deviceInfo.details.join(' · '),
    };
  }

  // Fallback: stringify but truncate
  try {
    const str = JSON.stringify(parsed);
    return { text: str.length > 120 ? str.slice(0, 120) + '…' : str };
  } catch {
    return { text: '[Objekt]' };
  }
}

export default function NotificationsPanel({ onClose, onOpenPolls, onOpenPoll, onOpenCalendar }: NotificationsPanelProps) {
  const [notifications, setNotifications] = useState<api.AppNotification[]>([]);
  const [loading, setLoading] = useState(true);
  const [keySyncState, setKeySyncState] = useState<Record<string, 'accepting' | 'accepted' | 'error'>>({});
  const { autoAcceptKeySync } = useSettings();

  useEffect(() => {
    api.getNotifications(50, 0)
      .then((data) => {
        const items = Array.isArray(data) ? data : [];
        // Ensure all items have required fields with defaults
        const safeItems = items.map((n: any) => ({
          id: String(n.id ?? Math.random()),
          type: String(n.type ?? ''),
          // Keep raw content/text for formatting
          text: n.text,
          content: n.content,
          time: n.time,
          created_at: n.created_at,
          channel: n.channel && typeof n.channel === 'object' ? { id: String(n.channel.id ?? ''), name: String(n.channel.name ?? '') } : undefined,
          event: n.event && typeof n.event === 'object' ? { id: String(n.event.id ?? ''), name: String(n.event.name ?? '') } : undefined,
          survey: n.survey && typeof n.survey === 'object' ? n.survey : undefined,
          sender: n.sender && typeof n.sender === 'object' ? { id: String(n.sender.id ?? ''), first_name: String(n.sender.first_name ?? ''), last_name: String(n.sender.last_name ?? ''), image: n.sender.image } : undefined,
          read: Boolean(n.read),
        }));
        setNotifications(safeItems as api.AppNotification[]);
      })
      .catch((err) => console.error('Failed to load notifications:', err))
      .finally(() => setLoading(false));
  }, []);

  const handleDelete = async (id: string) => {
    try {
      await api.deleteNotification(id);
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    } catch (err) {
      console.error('Failed to delete notification:', err);
    }
  };

  const handleDeleteAll = async () => {
    try {
      await api.deleteAllNotifications();
      setNotifications([]);
    } catch (err) {
      console.error('Failed to delete all notifications:', err);
    }
  };

  const handleAcceptKeySync = async (notificationId: string, userId: string) => {
    setKeySyncState((prev) => ({ ...prev, [notificationId]: 'accepting' }));
    try {
      await api.acceptKeySync(userId, notificationId);
      setKeySyncState((prev) => ({ ...prev, [notificationId]: 'accepted' }));
      setNotifications((prev) => prev.filter((n) => n.id !== notificationId));
    } catch (err) {
      console.error('Failed to accept key sync:', err);
      setKeySyncState((prev) => ({ ...prev, [notificationId]: 'error' }));
    }
  };

  return (
    <div className="flex h-full w-80 shrink-0 flex-col border-l border-surface-200 bg-white dark:border-surface-700 dark:bg-surface-900">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-surface-200 px-4 py-3 dark:border-surface-700">
        <Bell size={18} className="text-primary-500" />
        <h2 className="flex-1 text-sm font-semibold text-surface-900 dark:text-white">Benachrichtigungen</h2>
        {notifications.length > 0 && (
          <button
            onClick={handleDeleteAll}
            className="rounded-md px-2 py-1 text-xs text-surface-500 transition hover:bg-surface-200 hover:text-surface-600 dark:hover:bg-surface-800 dark:hover:text-surface-400"
            title="Alle löschen"
          >
            <Trash2 size={13} />
          </button>
        )}
        <button onClick={onClose} className="rounded-lg p-1.5 text-surface-500 hover:bg-surface-200 dark:hover:bg-surface-800">
          <X size={16} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 size={24} className="animate-spin text-primary-400" />
          </div>
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-surface-500">
            <Bell size={32} className="mb-2 opacity-50" />
            <p className="text-sm">Keine Benachrichtigungen</p>
          </div>
        ) : (
          <div className="divide-y divide-surface-100 dark:divide-surface-800">
            {notifications.map((n, i) => {
              const typeInfo = getTypeInfo(n.type);
              const isPollNotif = n.type?.includes('survey') || n.type?.includes('poll');
              const isEventNotif = n.type?.includes('event') || n.type?.includes('calendar');
              const isKeyReq = n.type?.includes('key');

              // Extract poll ID from survey object or content
              const pollId = n.survey && typeof n.survey === 'object' && 'id' in n.survey
                ? String(n.survey.id)
                : null;

              // Content: prefer survey object, then content field, then text
              const rawContent = n.survey ?? n.content ?? n.text;

              // Click handler: poll → open specific poll, event → open calendar
              const handleClick = () => {
                if (isPollNotif && pollId && onOpenPoll) {
                  onOpenPoll(pollId);
                  onClose();
                } else if (isPollNotif && onOpenPolls) {
                  onOpenPolls();
                  onClose();
                } else if (isEventNotif && onOpenCalendar) {
                  onOpenCalendar();
                  onClose();
                }
              };
              const isClickable = (isPollNotif && (onOpenPoll || onOpenPolls)) || (isEventNotif && onOpenCalendar);

              // Key sync request: parse requester user info
              const keyUser = isKeyReq ? parseKeyRequestUser(rawContent) : null;

              const formatted = keyUser ? null : formatNotificationContent(rawContent);

              // Safely extract channel/event names
              const channelName = n.channel && typeof n.channel.name === 'string' ? n.channel.name : undefined;
              const eventName = n.event && typeof n.event.name === 'string' ? n.event.name : undefined;

              const keySyncStatus = keySyncState[n.id];

              return (
                <div
                  key={n.id ?? `notif-${i}`}
                  onClick={handleClick}
                  className={clsx(
                    'group/notif flex gap-3 px-4 py-3 transition hover:bg-surface-50 dark:hover:bg-surface-800/50',
                    !n.read && 'bg-primary-50/50 dark:bg-primary-950/20',
                    isClickable && 'cursor-pointer',
                  )}
                >
                  <div className="shrink-0 pt-0.5">
                    {keyUser ? (
                      <Avatar name={`${keyUser.first_name} ${keyUser.last_name}`.trim() || 'Unbekannt'} image={keyUser.image} size="sm" />
                    ) : n.sender && (n.sender.first_name || n.sender.last_name) ? (
                      <Avatar name={`${n.sender.first_name ?? ''} ${n.sender.last_name ?? ''}`.trim() || 'Unbekannt'} image={n.sender.image} size="sm" />
                    ) : (
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-100 dark:bg-surface-800">
                        {typeInfo.icon}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-surface-500 dark:text-surface-500">
                        {typeInfo.label}
                      </span>
                      {!n.read && (
                        <span className="h-1.5 w-1.5 rounded-full bg-primary-500" />
                      )}
                    </div>

                    {keyUser ? (
                      <>
                        <p className="mt-0.5 text-sm text-surface-800 dark:text-surface-200">
                          <span className="font-medium">{keyUser.first_name} {keyUser.last_name}</span>{' '}
                          möchte Zugang zu verschlüsselten Nachrichten.
                        </p>
                        {autoAcceptKeySync ? (
                          <p className="mt-1 text-xs text-green-600 dark:text-green-400">
                            Wird automatisch bestätigt (Auto-Accept aktiv)
                          </p>
                        ) : (
                          <div className="mt-2 flex gap-2">
                            <button
                              onClick={(e) => { e.stopPropagation(); handleAcceptKeySync(n.id, keyUser.id); }}
                              disabled={keySyncStatus === 'accepting' || keySyncStatus === 'accepted'}
                              className={clsx(
                                'flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition',
                                keySyncStatus === 'accepted'
                                  ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                  : keySyncStatus === 'error'
                                  ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                                  : 'bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-60',
                              )}
                            >
                              {keySyncStatus === 'accepting' ? (
                                <Loader2 size={11} className="animate-spin" />
                              ) : keySyncStatus === 'accepted' ? (
                                <Check size={11} />
                              ) : (
                                <Check size={11} />
                              )}
                              {keySyncStatus === 'accepted' ? 'Bestätigt' : keySyncStatus === 'error' ? 'Fehler' : 'Zustimmen'}
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDelete(n.id); }}
                              className="flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium text-surface-600 transition hover:bg-surface-200 dark:hover:bg-surface-700 dark:text-surface-400"
                            >
                              <Ban size={11} />
                              Ablehnen
                            </button>
                          </div>
                        )}
                        {keySyncStatus === 'error' && (
                          <p className="mt-1 text-xs text-red-500">Endpoint nicht verfügbar — bitte Administrator informieren.</p>
                        )}
                      </>
                    ) : (
                      <>
                        {formatted?.text && (
                          <p className="mt-0.5 text-sm text-surface-800 dark:text-surface-200">
                            {formatted.text}
                          </p>
                        )}
                        {formatted?.subtext && (
                          <p className="mt-0.5 text-xs text-surface-500 dark:text-surface-500">
                            {formatted.subtext}
                          </p>
                        )}
                      </>
                    )}

                    <div className="mt-0.5 flex items-center gap-2 text-xs text-surface-500">
                      {channelName && (
                        <span className="flex items-center gap-0.5">
                          <Hash size={10} /> {channelName}
                        </span>
                      )}
                      {eventName && (
                        <span className="flex items-center gap-0.5">
                          <CalendarDays size={10} /> {eventName}
                        </span>
                      )}
                      <span>{formatTime(n.created_at)}</span>
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleDelete(n.id); }}
                    className="shrink-0 rounded-md p-1 text-surface-400 opacity-0 transition group-hover/notif:opacity-100 hover:bg-surface-200 hover:text-surface-500 dark:hover:bg-surface-800 dark:hover:text-surface-500"
                    title="Löschen"
                  >
                    <X size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
