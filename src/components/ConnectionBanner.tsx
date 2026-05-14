import { WifiOff, CheckCircle } from 'lucide-react';

type Props = {
  status: 'connected' | 'disconnected' | 'reconnected';
};

/**
 * Connection state indicator.
 *
 * Layout:
 * - Desktop / Tablet (md+): bottom-floating Pill, wie bisher.
 * - Mobile (< md): Full-width Top-Banner unter safe-area-top. Liegt damit
 *   nicht über dem sticky Composer, und ist auf engem Screen deutlich
 *   sichtbarer.
 */
export default function ConnectionBanner({ status }: Props) {
  if (status === 'connected') return null;

  const isDisconnected = status === 'disconnected';

  return (
    <div
      className={[
        // Mobile: top sticky banner, full width.
        'fixed left-0 right-0 top-0 z-50 flex items-center justify-center gap-2 px-4 py-2',
        'bridge-sticky-top text-sm font-medium shadow-md transition-all duration-300',
        // Desktop reset: bottom-floating pill (unchanged from before).
        'md:left-1/2 md:right-auto md:top-auto md:bottom-4 md:-translate-x-1/2',
        'md:rounded-full md:shadow-lg md:px-4',
        isDisconnected
          ? 'bg-amber-500 text-white dark:bg-amber-600'
          : 'bg-green-500 text-white dark:bg-green-600',
      ].join(' ')}
      role="status"
      aria-live="polite"
    >
      {isDisconnected ? (
        <>
          <WifiOff className="size-4 shrink-0" />
          <span>Verbindung unterbrochen – wird wiederhergestellt …</span>
          {/* Pulsing dot to indicate active reconnect attempt */}
          <span className="size-2 rounded-full bg-white/60 animate-pulse shrink-0" />
        </>
      ) : (
        <>
          <CheckCircle className="size-4 shrink-0" />
          <span>Verbindung wiederhergestellt</span>
        </>
      )}
    </div>
  );
}
