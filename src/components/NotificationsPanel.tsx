import { useState, useEffect } from 'react';
import { Bell, X, Loader2, Hash, CalendarDays, Smartphone, Shield, UserPlus, MessageSquare, Trash2 } from 'lucide-react';
import { clsx } from 'clsx';
import * as api from '../api';
import Avatar from './Avatar';

interface NotificationsPanelProps {
  onClose: () => void;
}

/** Map API notification types to user-friendly German labels + icons */
const TYPE_MAP: Record<string, { label: string; icon: React.ReactNode }> = {
  new_device_connected:    { label: 'Neues Gerät verbunden',           icon: <Smartphone size={16} className="text-green-500" /> },
  device_disconnected:     { label: 'Gerät getrennt',                  icon: <Smartphone size={16} className="text-surface-400" /> },
  new_login:               { label: 'Neue Anmeldung',                  icon: <Shield size={16} className="text-blue-500" /> },
  channel_invite:          { label: 'Einladung in einen Channel',      icon: <Hash size={16} className="text-primary-500" /> },
  channel_membership_gained: { label: 'Channel beigetreten',           icon: <Hash size={16} className="text-green-500" /> },
  channel_membership_lost: { label: 'Channel verlassen',               icon: <Hash size={16} className="text-surface-400" /> },
  channel_created:         { label: 'Neuer Channel erstellt',          icon: <Hash size={16} className="text-primary-500" /> },
  channel_deleted:         { label: 'Channel gelöscht',                icon: <Hash size={16} className="text-red-400" /> },
  channel_modified:        { label: 'Channel aktualisiert',            icon: <Hash size={16} className="text-amber-500" /> },
  new_invite:              { label: 'Neue Einladung',                  icon: <UserPlus size={16} className="text-primary-500" /> },
  event_invite:            { label: 'Einladung zu einem Termin',       icon: <CalendarDays size={16} className="text-amber-500" /> },
  event_changed:           { label: 'Termin aktualisiert',             icon: <CalendarDays size={16} className="text-amber-500" /> },
  event_deleted:           { label: 'Termin abgesagt',                 icon: <CalendarDays size={16} className="text-red-400" /> },
  message_sync:            { label: 'Neue Nachricht',                  icon: <MessageSquare size={16} className="text-primary-500" /> },
  notification:            { label: 'Benachrichtigung',                icon: <Bell size={16} className="text-primary-500" /> },
};

function getTypeInfo(type: string): { label: string; icon: React.ReactNode } {
  // Defensive: handle undefined/null/empty type
  const safeType = type || '';
  if (TYPE_MAP[safeType]) return TYPE_MAP[safeType];
  // Fuzzy match
  if (safeType.includes('channel')) return { label: 'Channel-Benachrichtigung', icon: <Hash size={16} className="text-primary-500" /> };
  if (safeType.includes('event') || safeType.includes('calendar')) return { label: 'Kalender-Benachrichtigung', icon: <CalendarDays size={16} className="text-amber-500" /> };
  if (safeType.includes('device') || safeType.includes('login')) return { label: 'Geräte-Benachrichtigung', icon: <Smartphone size={16} className="text-green-500" /> };
  if (safeType.includes('invite')) return { label: 'Einladung', icon: <UserPlus size={16} className="text-primary-500" /> };
  // Fallback: humanize the snake_case type
  const humanized = safeType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  return { label: humanized || 'Benachrichtigung', icon: <Bell size={16} className="text-surface-400" /> };
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

export default function NotificationsPanel({ onClose }: NotificationsPanelProps) {
  const [notifications, setNotifications] = useState<api.AppNotification[]>([]);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getNotifications(50, 0)
      .then((data) => {
        const items = Array.isArray(data) ? data : [];
        // Ensure all items have required fields with defaults
        const safeItems = items.map((n: any) => ({
          id: String(n.id ?? Math.random()),
          type: String(n.type ?? ''),
          text: typeof n.text === 'string' ? n.text : n.text ? JSON.stringify(n.text) : undefined,
          content: typeof n.content === 'string' ? n.content : n.content ? JSON.stringify(n.content) : undefined,
          time: n.time,
          created_at: n.created_at,
          channel: n.channel && typeof n.channel === 'object' ? { id: String(n.channel.id ?? ''), name: String(n.channel.name ?? '') } : undefined,
          event: n.event && typeof n.event === 'object' ? { id: String(n.event.id ?? ''), name: String(n.event.name ?? '') } : undefined,
          sender: n.sender && typeof n.sender === 'object' ? { id: String(n.sender.id ?? ''), first_name: String(n.sender.first_name ?? ''), last_name: String(n.sender.last_name ?? ''), image: n.sender.image } : undefined,
          read: Boolean(n.read),
        }));
        setNotifications(safeItems as api.AppNotification[]);
      })
      .catch((err) => console.error('Failed to load notifications:', err))
      .finally(() => setLoading(false));
  }, []);

  const handleDismiss = (id: string) => {
    setDismissed((prev) => new Set(prev).add(id));
  };

  const handleDismissAll = () => {
    setDismissed(new Set(notifications.map((n) => n.id)));
  };

  const visible = notifications.filter((n) => !dismissed.has(n.id));

  return (
    <div className="flex h-full w-80 shrink-0 flex-col border-l border-surface-200 bg-white dark:border-surface-700 dark:bg-surface-900">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-surface-200 px-4 py-3 dark:border-surface-700">
        <Bell size={18} className="text-primary-500" />
        <h2 className="flex-1 text-sm font-semibold text-surface-900 dark:text-white">Benachrichtigungen</h2>
        {visible.length > 0 && (
          <button
            onClick={handleDismissAll}
            className="rounded-md px-2 py-1 text-xs text-surface-400 transition hover:bg-surface-100 hover:text-surface-600 dark:hover:bg-surface-800 dark:hover:text-surface-300"
            title="Alle ausblenden"
          >
            <Trash2 size={13} />
          </button>
        )}
        <button onClick={onClose} className="rounded-lg p-1.5 text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800">
          <X size={16} />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 size={24} className="animate-spin text-primary-400" />
          </div>
        ) : visible.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-surface-400">
            <Bell size={32} className="mb-2 opacity-50" />
            <p className="text-sm">Keine Benachrichtigungen</p>
          </div>
        ) : (
          <div className="divide-y divide-surface-100 dark:divide-surface-800">
            {visible.map((n, i) => {
              const typeInfo = getTypeInfo(n.type);
              // Use 'content' from API (actual field name) or fall back to 'text'
              // Ensure displayText is a string, not an object
              let displayText: string | undefined;
              const rawText = n.content || n.text;
              if (typeof rawText === 'string') {
                displayText = rawText;
              } else if (rawText && typeof rawText === 'object') {
                displayText = JSON.stringify(rawText);
              }

              // Safely extract channel/event names
              const channelName = n.channel && typeof n.channel.name === 'string' ? n.channel.name : undefined;
              const eventName = n.event && typeof n.event.name === 'string' ? n.event.name : undefined;

              return (
                <div
                  key={n.id ?? `notif-${i}`}
                  className={clsx(
                    'group/notif flex gap-3 px-4 py-3 transition hover:bg-surface-50 dark:hover:bg-surface-800/50',
                    !n.read && 'bg-primary-50/50 dark:bg-primary-950/20',
                  )}
                >
                  <div className="shrink-0 pt-0.5">
                    {n.sender && (n.sender.first_name || n.sender.last_name) ? (
                      <Avatar name={`${n.sender.first_name ?? ''} ${n.sender.last_name ?? ''}`.trim() || 'Unbekannt'} image={n.sender.image} size="sm" />
                    ) : (
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-100 dark:bg-surface-800">
                        {typeInfo.icon}
                      </div>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs font-semibold text-surface-500 dark:text-surface-400">
                        {typeInfo.label}
                      </span>
                      {!n.read && (
                        <span className="h-1.5 w-1.5 rounded-full bg-primary-500" />
                      )}
                    </div>
                    {displayText && (
                      <p className="mt-0.5 text-sm text-surface-800 dark:text-surface-200">
                        {displayText}
                      </p>
                    )}
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-surface-400">
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
                    onClick={() => handleDismiss(n.id)}
                    className="shrink-0 rounded-md p-1 text-surface-300 opacity-0 transition group-hover/notif:opacity-100 hover:bg-surface-100 hover:text-surface-500 dark:hover:bg-surface-800 dark:hover:text-surface-400"
                    title="Ausblenden"
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
