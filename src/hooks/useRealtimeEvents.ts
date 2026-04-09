import { useEffect, useRef } from 'react';

type SSEHandler = (data: unknown) => void;

/** Connects to the backend SSE stream and dispatches events to registered handlers.
 *  Detects reconnections and dispatches a synthetic 'reconnect' event so consumers
 *  can re-fetch missed data.
 */
export function useRealtimeEvents(
  handlers: Record<string, SSEHandler>,
  enabled: boolean
) {
  const esRef = useRef<EventSource | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!enabled) return;

    const token = localStorage.getItem('schulchat_token');
    if (!token) return;

    let wasDisconnected = false;

    // EventSource doesn't support custom headers — pass token as query param
    const apiBase = import.meta.env.DEV ? '/backend/api' : '/api';
    const es = new EventSource(`${apiBase}/events?token=${encodeURIComponent(token)}`);
    esRef.current = es;

    const dispatch = (event: MessageEvent, eventName: string) => {
      try {
        const data = JSON.parse(event.data as string);
        handlersRef.current[eventName]?.(data);
      } catch { /* ignore parse errors */ }
    };

    es.addEventListener('message_sync', (e) => dispatch(e, 'message_sync'));
    es.addEventListener('typing', (e) => dispatch(e, 'typing'));
    es.addEventListener('connected', () => {
      // Server confirmed stream is ready — if this is a reconnection, re-fetch data
      if (wasDisconnected) {
        wasDisconnected = false;
        handlersRef.current['reconnect']?.({});
      }
    });

    es.onopen = () => {
      // onopen fires when HTTP headers received, but stream may not be fully ready.
      // Actual reconnect handling is done via the 'connected' event above.
    };

    es.onerror = () => {
      wasDisconnected = true;
      // EventSource auto-reconnects on error
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [enabled]);
}
