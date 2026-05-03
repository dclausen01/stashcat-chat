import { Wifi, WifiOff, CheckCircle } from 'lucide-react';

type Props = {
  status: 'connected' | 'disconnected' | 'reconnected';
};

export default function ConnectionBanner({ status }: Props) {
  if (status === 'connected') return null;

  const isDisconnected = status === 'disconnected';

  return (
    <div
      className={[
        'fixed bottom-4 left-1/2 -translate-x-1/2 z-50',
        'flex items-center gap-2 px-4 py-2 rounded-full shadow-lg',
        'text-sm font-medium transition-all duration-300',
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
