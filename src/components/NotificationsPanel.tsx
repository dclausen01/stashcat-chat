import { useState, useEffect } from 'react';
import { Bell, X, Loader2, Hash, CalendarDays, Users } from 'lucide-react';
import { clsx } from 'clsx';
import * as api from '../api';
import Avatar from './Avatar';

interface NotificationsPanelProps {
  onClose: () => void;
}

export default function NotificationsPanel({ onClose }: NotificationsPanelProps) {
  const [notifications, setNotifications] = useState<api.AppNotification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getNotifications(50, 0)
      .then((data) => {
        const items = Array.isArray(data) ? data : [];
        setNotifications(items);
      })
      .catch((err) => console.error('Failed to load notifications:', err))
      .finally(() => setLoading(false));
  }, []);

  const getIcon = (type: string) => {
    if (type.includes('channel') || type.includes('invite')) return <Hash size={16} className="text-primary-500" />;
    if (type.includes('event') || type.includes('calendar')) return <CalendarDays size={16} className="text-amber-500" />;
    return <Users size={16} className="text-surface-400" />;
  };

  const formatTime = (time?: number) => {
    if (!time) return '';
    const d = new Date(time * 1000);
    const now = new Date();
    const diffMs = now.getTime() - d.getTime();
    const diffH = diffMs / 3600000;
    if (diffH < 1) return `vor ${Math.max(1, Math.round(diffMs / 60000))} Min.`;
    if (diffH < 24) return `vor ${Math.round(diffH)} Std.`;
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
  };

  return (
    <div className="flex h-full w-80 shrink-0 flex-col border-l border-surface-200 bg-white dark:border-surface-700 dark:bg-surface-900">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-surface-200 px-4 py-3 dark:border-surface-700">
        <Bell size={18} className="text-primary-500" />
        <h2 className="flex-1 text-sm font-semibold text-surface-900 dark:text-white">Benachrichtigungen</h2>
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
        ) : notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-surface-400">
            <Bell size={32} className="mb-2 opacity-50" />
            <p className="text-sm">Keine Benachrichtigungen</p>
          </div>
        ) : (
          <div className="divide-y divide-surface-100 dark:divide-surface-800">
            {notifications.map((n, i) => (
              <div
                key={n.id || i}
                className={clsx(
                  'flex gap-3 px-4 py-3 transition hover:bg-surface-50 dark:hover:bg-surface-800/50',
                  !n.read && 'bg-primary-50/50 dark:bg-primary-950/20',
                )}
              >
                <div className="shrink-0 pt-0.5">
                  {n.sender ? (
                    <Avatar name={`${n.sender.first_name} ${n.sender.last_name}`} image={n.sender.image} size="sm" />
                  ) : (
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-surface-100 dark:bg-surface-800">
                      {getIcon(n.type)}
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-surface-800 dark:text-surface-200">
                    {n.text || n.type}
                  </p>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-surface-400">
                    {n.channel && (
                      <span className="flex items-center gap-0.5">
                        <Hash size={10} /> {n.channel.name}
                      </span>
                    )}
                    {n.event && (
                      <span className="flex items-center gap-0.5">
                        <CalendarDays size={10} /> {n.event.name}
                      </span>
                    )}
                    {n.time && <span>{formatTime(n.time)}</span>}
                  </div>
                </div>
                {!n.read && (
                  <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary-500" />
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
