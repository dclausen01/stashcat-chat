import { useState, useEffect } from 'react';
import { subscribeConnectionState } from './useRealtimeEvents';

type ConnectionStatus = 'connected' | 'disconnected' | 'reconnected';

/** Tracks SSE connection health and exposes a status for UI display.
 *
 *  - 'connected'    → normal, no banner shown
 *  - 'disconnected' → SSE dropped, banner with spinner shown
 *  - 'reconnected'  → just came back, brief success banner auto-dismisses after 3s
 */
export function useConnectionState(enabled: boolean): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>('connected');

  useEffect(() => {
    if (!enabled) return;

    const unsubscribe = subscribeConnectionState((connected) => {
      if (connected) {
        setStatus('reconnected');
      } else {
        setStatus('disconnected');
      }
    });

    return unsubscribe;
  }, [enabled]);

  // Auto-dismiss "reconnected" banner after 3 seconds
  useEffect(() => {
    if (status !== 'reconnected') return;
    const timer = setTimeout(() => setStatus('connected'), 3000);
    return () => clearTimeout(timer);
  }, [status]);

  return status;
}
