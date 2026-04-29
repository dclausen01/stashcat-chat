import { ExternalLink } from 'lucide-react';
import { clsx } from 'clsx';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import LinkPreviewCard from './LinkPreviewCard';

/** Extract all http(s) URLs from a text string */
export function extractUrls(text: string): string[] {
  const re = /https?:\/\/[^\s)>\]]+/g;
  const matches: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    let url = m[0];
    while (/[.,;:!?)>\]'"]$/.test(url)) url = url.slice(0, -1);
    if (!matches.includes(url)) matches.push(url);
  }
  return matches;
}

/** Convert plain URLs in text to markdown links so ReactMarkdown renders them */
export function autoLinkify(text: string): string {
  return text.replace(
    /(?<!\]\()(?<!\()(?<!\<)(https?:\/\/[^\s)>\]]+)/g,
    (url) => `[${url}](${url})`
  );
}

/**
 * Normalize backslashes that the original Stashcat app inserts at line
 * boundaries as hard-break markers (e.g. "text\\\nmore text").
 * We convert them to Markdown hard line breaks (two trailing spaces before \n)
 * so react-markdown renders an actual <br> instead of collapsing the newline.
 * Lines that consist of only a backslash are stripped (no visible content).
 */
export function normalizeBackslashArtifacts(text: string): string {
  return text
    .replace(/\\(\n)/g, '  $1')
    .replace(/(\n)\s*\\\s*(?=\n|$)/g, '$1')
    .replace(/\\$/g, '');
}

interface MarkdownContentProps {
  content: string;
  isOwn?: boolean;
  isEmojiOnly?: boolean;
  /** Render URL preview cards beneath the text. Default: true */
  showLinkPreviews?: boolean;
}

export default function MarkdownContent({
  content,
  isOwn = false,
  isEmojiOnly = false,
  showLinkPreviews = true,
}: MarkdownContentProps) {
  const urls = showLinkPreviews ? extractUrls(content) : [];
  const linkedContent = autoLinkify(content);
  const processedContent = normalizeBackslashArtifacts(linkedContent);

  return (
    <>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className={clsx('m-0 break-words', isEmojiOnly && 'text-5xl leading-tight')}>{children}</p>,
          strong: ({ children }) => <strong className="font-bold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          del: ({ children }) => <del className="line-through opacity-75">{children}</del>,
          code: ({ children, className }) => {
            const isBlock = className?.includes('language-');
            return isBlock ? (
              <code className={clsx(
                'block overflow-x-auto rounded-lg px-3 py-2 font-mono text-xs my-1',
                isOwn ? 'bg-primary-700 text-primary-100' : 'bg-surface-200 text-surface-800 dark:bg-surface-700 dark:text-surface-200',
              )}>{children}</code>
            ) : (
              <code className={clsx(
                'rounded px-1 py-0.5 font-mono text-xs',
                isOwn ? 'bg-primary-700 text-primary-100' : 'bg-surface-200 text-surface-800 dark:bg-surface-700 dark:text-surface-200',
              )}>{children}</code>
            );
          },
          h1: ({ children }) => <h1 className="text-lg font-bold mb-1 mt-0">{children}</h1>,
          h2: ({ children }) => <h2 className="text-base font-bold mb-1 mt-0">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-bold mb-0.5 mt-0">{children}</h3>,
          ul: ({ children }) => <ul className="my-1 ml-4 list-disc space-y-0.5">{children}</ul>,
          ol: ({ children }) => <ol className="my-1 ml-4 list-decimal space-y-0.5">{children}</ol>,
          li: ({ children }) => <li className="text-sm">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className={clsx(
              'my-1 border-l-2 pl-3 italic',
              isOwn ? 'border-primary-300 opacity-80' : 'border-surface-400',
            )}>{children}</blockquote>
          ),
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer"
              className={clsx(
                'underline break-all',
                isOwn ? 'text-primary-200 hover:text-white' : 'text-primary-600 hover:text-primary-800 dark:text-primary-400 dark:hover:text-primary-200',
              )}>
              <ExternalLink size={11} className="inline align-text-bottom mr-0.5 shrink-0" />
              {children}
            </a>
          ),
          hr: () => <hr className={clsx('my-1 border-t', isOwn ? 'border-primary-400' : 'border-surface-300 dark:border-surface-600')} />,
          pre: ({ children }) => <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-words">{children}</pre>,
        }}
      >
        {processedContent}
      </ReactMarkdown>
      {urls.map((url) => (
        <LinkPreviewCard key={url} url={url} isOwn={isOwn} />
      ))}
    </>
  );
}
