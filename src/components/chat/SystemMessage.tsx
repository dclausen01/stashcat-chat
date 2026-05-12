import { memo } from 'react';
import type { Message } from '../../types';

function SystemMessageImpl({ msg }: { msg: Message }) {
  const senderName = msg.sender ? `${msg.sender.first_name ?? ''} ${msg.sender.last_name ?? ''}`.trim() || 'Jemand' : 'Jemand';
  const time = msg.time
    ? new Date(msg.time * 1000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    : '';
  const date = msg.time
    ? new Date(msg.time * 1000).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' })
    : '';

  let text = '';
  switch (msg.kind) {
    case 'joined':
      text = `${senderName} ist dem Channel beigetreten.`;
      break;
    case 'left':
      text = `${senderName} hat den Channel verlassen.`;
      break;
    case 'removed':
      text = `${senderName} wurde aus dem Channel entfernt.`;
      break;
    case 'call_start':
      text = `${senderName} hat einen Anruf gestartet.`;
      break;
    case 'call_end':
      text = 'Der Anruf wurde beendet.';
      break;
    default:
      text = msg.text || `Systemnachricht (${msg.kind})`;
  }

  return (
    <div className="flex justify-center py-1">
      <div className="rounded-full bg-surface-100 px-4 py-1.5 text-xs text-surface-600 dark:bg-surface-800 dark:text-surface-400">
        <span className="font-medium">{text}</span>
        {time && <span className="ml-2 text-surface-600">{date}, {time}</span>}
      </div>
    </div>
  );
}

export const SystemMessage = memo(SystemMessageImpl);
