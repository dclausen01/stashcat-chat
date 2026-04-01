import { useState, useEffect } from 'react';
import { ExternalLink, Globe } from 'lucide-react';
import { clsx } from 'clsx';
import * as api from '../api';

interface LinkPreviewCardProps {
  url: string;
  isOwn: boolean;
}

// Module-level cache so previews persist across re-renders
const previewCache = new Map<string, api.LinkPreview | null>();

export default function LinkPreviewCard({ url, isOwn }: LinkPreviewCardProps) {
  const [preview, setPreview] = useState<api.LinkPreview | null>(previewCache.get(url) ?? null);
  const [loaded, setLoaded] = useState(previewCache.has(url));

  useEffect(() => {
    if (previewCache.has(url)) {
      setPreview(previewCache.get(url) ?? null);
      setLoaded(true);
      return;
    }
    let cancelled = false;
    api.getLinkPreview(url).then((data) => {
      if (cancelled) return;
      previewCache.set(url, data);
      setPreview(data);
      setLoaded(true);
    }).catch(() => {
      if (cancelled) return;
      previewCache.set(url, null);
      setLoaded(true);
    });
    return () => { cancelled = true; };
  }, [url]);

  if (!loaded || !preview || (!preview.title && !preview.description)) return null;

  // Extract hostname for display
  let hostname = '';
  try { hostname = new URL(url).hostname.replace(/^www\./, ''); } catch { /* */ }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={clsx(
        'mt-1.5 flex overflow-hidden rounded-xl border transition hover:shadow-md',
        isOwn
          ? 'border-primary-500/30 bg-primary-700/50 hover:bg-primary-700/70'
          : 'border-surface-200 bg-white hover:bg-surface-50 dark:border-surface-600 dark:bg-surface-800 dark:hover:bg-surface-750',
      )}
    >
      {/* Image thumbnail */}
      {preview.image && (
        <div className="hidden sm:block w-28 shrink-0">
          <img
            src={preview.image}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
          />
        </div>
      )}

      {/* Text content */}
      <div className="min-w-0 flex-1 px-3 py-2.5">
        {/* Site name */}
        <div className={clsx(
          'mb-0.5 flex items-center gap-1 text-xs',
          isOwn ? 'text-primary-200' : 'text-surface-500 dark:text-surface-500',
        )}>
          <Globe size={11} className="shrink-0" />
          <span className="truncate">{preview.siteName || hostname}</span>
        </div>

        {/* Title */}
        {preview.title && preview.title !== url && (
          <div className={clsx(
            'line-clamp-2 text-sm font-semibold leading-snug',
            isOwn ? 'text-white' : 'text-surface-900 dark:text-surface-100',
          )}>
            {preview.title}
          </div>
        )}

        {/* Description */}
        {preview.description && (
          <div className={clsx(
            'mt-0.5 line-clamp-2 text-xs leading-relaxed',
            isOwn ? 'text-primary-100/80' : 'text-surface-500 dark:text-surface-500',
          )}>
            {preview.description}
          </div>
        )}
      </div>

      {/* External link icon */}
      <div className={clsx(
        'flex shrink-0 items-center px-2.5',
        isOwn ? 'text-primary-200' : 'text-surface-400 dark:text-surface-400',
      )}>
        <ExternalLink size={14} />
      </div>
    </a>
  );
}
