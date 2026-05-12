import { memo, type ReactNode } from 'react';
import type { Message } from '../../types';

export function isCalendarEventMessage(msg: Message): boolean {
  const text = msg.text ?? '';
  return text.includes('[%event:') && text.includes('%]');
}

function extractEventId(msg: Message): string | undefined {
  const raw = msg as unknown as Record<string, unknown>;
  if (raw.event_id) return String(raw.event_id);
  if (raw.target_id) return String(raw.target_id);
  const match = (msg.text ?? '').match(/\[%event:([^%]+)%\]$/);
  return match?.[1];
}

function renderEventText(text: string): ReactNode[] {
  if (!text) return [];
  const clean = text
    .replace(/\s*\[%event:[^%]+%\]\s*$/, '')
    .replace(/\s*Details im Kalender ansehen\.?\s*$/gim, '')
    .trim();
  if (!clean.includes('**')) return [clean];
  const parts: ReactNode[] = [];
  const regex = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = regex.exec(clean)) !== null) {
    if (match.index > lastIndex) parts.push(clean.slice(lastIndex, match.index).replace(/\*\*/g, ''));
    parts.push(<span key={key++} className="font-semibold">{match[1]}</span>);
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < clean.length) parts.push(clean.slice(lastIndex).replace(/\*\*/g, ''));
  return parts.length > 0 ? parts : [clean];
}

function CalendarEventCardImpl({ msg, onOpenCalendar, onOpenEvent }: { msg: Message; onOpenCalendar?: () => void; onOpenEvent?: (eventId: string) => void }) {
  const time = msg.time
    ? new Date(msg.time * 1000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    : '';

  const eventId = extractEventId(msg);

  const handleClick = () => {
    if (eventId && onOpenEvent) {
      onOpenEvent(eventId);
    } else if (onOpenCalendar) {
      onOpenCalendar();
    }
  };

  return (
    <div className="flex justify-center py-2 px-4">
      <div className="rounded-xl bg-surface-700 px-5 py-3 text-center dark:bg-surface-800 max-w-xs shadow">
        <p className="text-sm text-surface-100 dark:text-surface-200 whitespace-pre-wrap">
          {renderEventText(msg.text ?? '')}
        </p>
        {(onOpenCalendar || onOpenEvent) && (
          <button
            onClick={handleClick}
            className="mt-1 block text-sm font-semibold text-green-400 hover:text-green-300 dark:text-green-400 dark:hover:text-green-300 transition"
          >
            Im Kalender ansehen
          </button>
        )}
        {time && <p className="mt-1 text-xs text-surface-600">{time}</p>}
      </div>
    </div>
  );
}

export const CalendarEventCard = memo(CalendarEventCardImpl);
