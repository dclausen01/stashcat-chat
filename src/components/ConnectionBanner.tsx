import { WifiOff, CheckCircle } from 'lucide-react';
import type { ConnectionStatus } from '../hooks/useConnectionState';

type Props = {
  status: ConnectionStatus;
};

/**
 * Connection state indicator — floating pill, always at the bottom.
 * Never covers the top navigation bar or back button.
 *
 * Only appears for genuine unexpected disconnects (not during normal
 * post-background SSE reconnect, which is suppressed by useConnectionState).
 */
export default function ConnectionBanner({ status }: Props) {
  if (status === 'connected') return null;

  const isDisconnected = status === 'disconnected';

  return (
    <div
      className={[
        'fixed bottom-6 left-1/2 z-50 -translate-x-1/2',
        'flex items-center gap-2 rounded-full px-4 py-2',
        'text-sm font-medium text-white shadow-lg',
        'transition-all duration-300 animate-in fade-in slide-in-from-bottom-2',
        isDisconnected
          ? 'bg-amber-500 dark:bg-amber-600'
          : 'bg-green-500 dark:bg-green-600',
      ].join(' ')}
      role="status"
      aria-live="polite"
    >
      {isDisconnected ? (
        <>
          <WifiOff className="size-4 shrink-0" />
          <span>Verbindung unterbrochen …</span>
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
