import { useState, useEffect, useRef } from 'react';
import { subscribeConnectionState } from './useRealtimeEvents';

export type ConnectionStatus = 'connected' | 'disconnected' | 'reconnected';

/**
 * Tracks SSE connection health and exposes a status for UI display.
 *
 * - 'connected'    → normal, no banner shown
 * - 'disconnected' → SSE genuinely gone (not expected reconnect), banner shown
 * - 'reconnected'  → came back after a visible disconnect; auto-dismissed after 2s
 *
 * Smart suppression: when the app comes back to foreground (visibilitychange),
 * SSE always needs to reconnect — that's expected, not an error. The banner is
 * suppressed for RESUME_GRACE_MS after foregrounding so users don't see a false
 * "connection lost" on every app open. If SSE still hasn't reconnected after the
 * resume grace, we fall through to the normal disconnect banner.
 */

const DISCONNECT_GRACE_MS = 4000;   // Foreground disconnect → banner after 4 s
const RESUME_GRACE_MS = 12000;      // After foregrounding → suppress for 12 s
const RECONNECT_AUTO_DISMISS_MS = 2000;

export function useConnectionState(enabled: boolean): ConnectionStatus {
  const [status, setStatus] = useState<ConnectionStatus>('connected');

  const wasDisconnectedRef  = useRef(false);
  const disconnectTimerRef  = useRef<number | null>(null);
  const resumeTimerRef      = useRef<number | null>(null);
  const isResumingRef       = useRef(false);
  const sseConnectedRef     = useRef(true);

  useEffect(() => {
    if (!enabled) return;

    // --- Visibility handler: suppress banner during expected post-background reconnect ---
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;

      // App just came to foreground — SSE reconnect is expected, not an error.
      isResumingRef.current = true;

      // Cancel any pending foreground-disconnect banner.
      if (disconnectTimerRef.current != null) {
        window.clearTimeout(disconnectTimerRef.current);
        disconnectTimerRef.current = null;
      }

      // Auto-expire the resume window; if SSE still not up by then, show banner.
      if (resumeTimerRef.current != null) window.clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = window.setTimeout(() => {
        isResumingRef.current = false;
        resumeTimerRef.current = null;
        if (!sseConnectedRef.current) {
          // Still not connected after resume grace → genuine failure → show banner.
          wasDisconnectedRef.current = true;
          setStatus('disconnected');
        }
      }, RESUME_GRACE_MS);
    };

    document.addEventListener('visibilitychange', onVisibilityChange);

    // --- SSE connection state subscriber ---
    const unsubscribe = subscribeConnectionState((connected) => {
      sseConnectedRef.current = connected;

      if (connected) {
        // Cancel all pending timers.
        if (disconnectTimerRef.current != null) {
          window.clearTimeout(disconnectTimerRef.current);
          disconnectTimerRef.current = null;
        }
        if (resumeTimerRef.current != null) {
          window.clearTimeout(resumeTimerRef.current);
          resumeTimerRef.current = null;
        }
        isResumingRef.current = false;

        if (wasDisconnectedRef.current) {
          // Only show "reconnected" banner if the user actually saw "disconnected".
          wasDisconnectedRef.current = false;
          setStatus('reconnected');
        } else {
          setStatus('connected');
        }
      } else {
        // Disconnected — suppress if we're in a resume window.
        if (isResumingRef.current) return;
        if (disconnectTimerRef.current != null) return;

        disconnectTimerRef.current = window.setTimeout(() => {
          disconnectTimerRef.current = null;
          // Re-check: might have reconnected while timer was running.
          if (!sseConnectedRef.current && !isResumingRef.current) {
            wasDisconnectedRef.current = true;
            setStatus('disconnected');
          }
        }, DISCONNECT_GRACE_MS);
      }
    });

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      unsubscribe();
      if (disconnectTimerRef.current != null) window.clearTimeout(disconnectTimerRef.current);
      if (resumeTimerRef.current != null) window.clearTimeout(resumeTimerRef.current);
    };
  }, [enabled]);

  // Auto-dismiss "reconnected" banner after 2 s
  useEffect(() => {
    if (status !== 'reconnected') return;
    const timer = window.setTimeout(() => setStatus('connected'), RECONNECT_AUTO_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [status]);

  return status;
}
