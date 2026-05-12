import * as api from '../api';
import type { ChatTarget } from '../types';
import { getCleanName } from './subchannels';
import { formatUserName } from './userName';

function formatDateLabel(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString('de-DE', {
    hour: '2-digit', minute: '2-digit',
  });
}

/** Fetch all messages of a chat, render them as Markdown, and trigger a download. */
export async function exportChatAsMarkdown(chat: ChatTarget): Promise<void> {
  const msgs = await api.getMessages(chat.id, chat.type, 9999);
  const sorted = [...msgs].sort(
    (a, b) => (Number(a.time) || 0) - (Number(b.time) || 0)
  );

  const dateExport = new Date().toLocaleDateString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
  const timeStart = sorted.length > 0
    ? formatTime(Number(sorted[0].time) || 0)
    : '--:--';
  const timeEnd = sorted.length > 0
    ? formatTime(Number(sorted[sorted.length - 1].time) || 0)
    : '--:--';

  const lines: string[] = [];
  lines.push(`# ${getCleanName(chat.name)}\n`);
  lines.push(`*Exportiert am ${dateExport} von ${timeStart} bis ${timeEnd}*\n`);
  lines.push('---\n');

  let lastDay = '';

  for (const msg of sorted) {
    const t = Number(msg.time) || 0;
    const day = formatDateLabel(t);
    const time = formatTime(t);

    if (day !== lastDay) {
      lines.push(`\n### ${day}\n`);
      lastDay = day;
    }

    const author = formatUserName(msg.sender);
    const text = msg.text || '';
    const kind = msg.kind;

    if (kind === 'forward') {
      lines.push(`**[${time}] ${author}** (weitergeleitet)\n${text}\n`);
    } else if (kind === 'joined' || kind === 'left' || kind === 'removed') {
      const actionText =
        kind === 'joined' ? 'ist dem Channel beigetreten'
        : kind === 'left' ? 'ist ausgetreten'
        : 'wurde entfernt';
      lines.push(`*[System: ${author} ${actionText}]*\n`);
    } else {
      lines.push(`**[${time}] ${author}**\n${text}\n`);

      const reactions = (msg as unknown as { reactions?: Record<string, number> }).reactions;
      if (reactions && Object.keys(reactions).length > 0) {
        const reactionStr = Object.entries(reactions)
          .map(([emoji, count]) => `${emoji} ${count}`)
          .join(' | ');
        lines.push(`Reactions: ${reactionStr}\n`);
      }

      if (msg.files && msg.files.length > 0) {
        for (const f of msg.files) {
          const name = f.name || 'Datei';
          const url = (f as unknown as { url?: string }).url || '#';
          lines.push(`[📎 ${name}](${url})\n`);
        }
      }
    }

    lines.push('---\n');
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${getCleanName(chat.name).replace(/[^a-zA-Z0-9ÄÖÜäöüß0-9_-]/g, '-')}-${dateExport.replace(/\./g, '-')}.md`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
