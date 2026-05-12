import { ExternalLink } from 'lucide-react';
import type { ReactNode } from 'react';

export function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query || query.trim().length < 2) return <>{text}</>;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase()
          ? <mark key={i} className="rounded bg-yellow-300 px-0.5 text-yellow-900 dark:bg-yellow-500 dark:text-yellow-950">{part}</mark>
          : part,
      )}
    </>
  );
}

/** Renders plain text with clickable https?:// URLs */
export function LinkifiedText({ text }: { text: string }) {
  const URL_RE = /https?:\/\/[^\s]+/g;
  const parts: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_RE.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    const url = match[0];
    parts.push(
      <a
        key={match.index}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-0.5 text-primary-600 underline hover:text-primary-800 dark:text-primary-400 dark:hover:text-primary-200"
      >
        <ExternalLink size={11} className="shrink-0" />
        {url}
      </a>,
    );
    last = match.index + url.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}
