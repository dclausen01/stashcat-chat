import { useState, useEffect, useRef } from 'react';
import { subscribeConnectionState } from './useRealtimeEvents';

type ConnectionStatus = 'connected' | 'disconnected' | 'reconnected';

/** Tracks SSE connection health and exposes a status for UI display.
 *
 *  - 'connected'    → normal, no banner shown
 *  - 'disconnected' → SSE wirklich weg (länger als DISCONNECT_GRACE_MS),
 *                     Banner mit Spinner wird gezeigt
 *  - 'reconnected'  → kam gerade zurück; kurze Erfolgsanzeige, auto-dismiss
 *                     nach 2 s. Wird nur angezeigt, wenn vorher tatsächlich
 *                     ein 'disconnected'-Banner sichtbar war — beim ersten
 *                     SSE-Connect nach App-Start *nicht*.
 */

// Grace-Period: SSE braucht bei App-Start regelmäßig 1–2 s zum Aufbau.
// Erst nach diesem Zeitraum gilt der Zustand wirklich als "disconnected".
const DISCONNECT_GRACE_MS = 4000;
const RECONNECT_AUTO_DISMISS_MS = 2000;

export function useConnectionState(enabled: boolean): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>('connected');
  const wasDisconnectedRef = useRef(false);
  const disconnectTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;

    const unsubscribe = subscribeConnectionState((connected) => {
      if (connected) {
        // Wenn vorher noch kein "disconnected" gefeuert wurde (Grace-Period
        // läuft noch oder Erstverbindung), kein "reconnected"-Banner zeigen.
        if (disconnectTimerRef.current != null) {
          window.clearTimeout(disconnectTimerRef.current);
          disconnectTimerRef.current = null;
        }
        if (wasDisconnectedRef.current) {
          wasDisconnectedRef.current = false;
          setStatus('reconnected');
        } else {
          setStatus('connected');
        }
      } else {
        // Disconnect: erst nach Grace-Period sichtbar machen.
        if (disconnectTimerRef.current != null) return;
        disconnectTimerRef.current = window.setTimeout(() => {
          wasDisconnectedRef.current = true;
          setStatus('disconnected');
          disconnectTimerRef.current = null;
        }, DISCONNECT_GRACE_MS);
      }
    });

    return () => {
      unsubscribe();
      if (disconnectTimerRef.current != null) {
        window.clearTimeout(disconnectTimerRef.current);
        disconnectTimerRef.current = null;
      }
    };
  }, [enabled]);

  // Auto-dismiss "reconnected"-Banner nach 2 s
  useEffect(() => {
    if (status !== 'reconnected') return;
    const timer = window.setTimeout(() => setStatus('connected'), RECONNECT_AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [status]);

  return status;
}
