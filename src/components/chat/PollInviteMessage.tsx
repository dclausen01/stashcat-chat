import { memo, type ReactNode } from 'react';
import type { Message } from '../../types';

const POLL_INVITE_KINDS = new Set([
  'channel_invited_to_survey', 'survey_invitation', 'poll_invite',
  'invited_to_poll', 'channel_survey_invite', 'survey_invite',
]);

export function isPollInviteMessage(msg: Message): boolean {
  if (POLL_INVITE_KINDS.has(msg.kind ?? '')) return true;
  const text = msg.text ?? '';
  if (text.includes('[%poll:') && text.includes('%]')) return true;
  const lower = text.toLowerCase();
  if (lower.includes('neue umfrage') || lower.includes('umfrage eingeladen') ||
      lower.includes('teilnahme an einer umfrage') || lower.includes('survey')) return true;
  return false;
}

function extractPollId(msg: Message): string | undefined {
  const raw = msg as unknown as Record<string, unknown>;
  if (raw.poll_id) return String(raw.poll_id);
  if (raw.target_id) return String(raw.target_id);
  if (raw.survey_id) return String(raw.survey_id);
  const match = (msg.text ?? '').match(/\[%poll:([^%]+)%\]$/);
  return match?.[1];
}

function renderPollText(text: string): ReactNode[] {
  if (!text) return [];
  const clean = text
    .replace(/\s*\[%poll:[^%]+%\]\s*$/, '')
    .replace(/\s*Klicke hier,? um teilzunehmen\.?\s*$/gim, '')
    .trim();
  if (!clean.includes('**')) return [clean];
  const parts: ReactNode[] = [];
  const regex = /\*\*(.+?)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = regex.exec(clean)) !== null) {
    if (match.index > lastIndex) {
      parts.push(clean.slice(lastIndex, match.index).replace(/\*\*/g, ''));
    }
    parts.push(<span key={key++} className="font-semibold">{match[1]}</span>);
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < clean.length) {
    parts.push(clean.slice(lastIndex).replace(/\*\*/g, ''));
  }
  return parts.length > 0 ? parts : [clean];
}

function PollInviteMessageImpl({ msg, onOpenPolls, onOpenPoll }: { msg: Message; onOpenPolls?: () => void; onOpenPoll?: (pollId: string) => void }) {
  const time = msg.time
    ? new Date(msg.time * 1000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })
    : '';

  const pollId = extractPollId(msg);

  const handleClick = () => {
    if (pollId && onOpenPoll) {
      onOpenPoll(pollId);
    } else if (onOpenPolls) {
      onOpenPolls();
    }
  };

  return (
    <div className="flex justify-center py-2 px-4">
      <div className="rounded-xl bg-surface-700 px-5 py-3 text-center dark:bg-surface-800 max-w-xs shadow">
        <p className="text-sm text-surface-100 dark:text-surface-200 whitespace-pre-wrap">
          {renderPollText(msg.text ?? '')}
        </p>
        {(onOpenPolls || onOpenPoll) && (
          <button
            onClick={handleClick}
            className="mt-1 block text-sm font-semibold text-yellow-400 hover:text-yellow-300 dark:text-yellow-400 dark:hover:text-yellow-300 transition"
          >
            Klicke hier
          </button>
        )}
        {time && <p className="mt-1 text-xs text-surface-600">{time}</p>}
      </div>
    </div>
  );
}

export const PollInviteMessage = memo(PollInviteMessageImpl);
