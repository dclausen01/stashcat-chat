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

  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    if (!enabled) {
      console.log('[useRealtimeEvents] Not enabled, skipping connection');
      return;
    }

    const token = localStorage.getItem('schulchat_token');
    if (!token) {
      console.log('[useRealtimeEvents] No token found, skipping connection');
      return;
    }

    let wasDisconnected = false;

    // EventSource doesn't support custom headers — pass token as query param
    const apiBase = import.meta.env.DEV ? '/backend/api' : '/api';
    const url = `${apiBase}/events?token=${encodeURIComponent(token)}`;
    console.log('[useRealtimeEvents] Connecting to SSE:', url);
    
    const es = new EventSource(url);
    esRef.current = es;

    const dispatch = (event: MessageEvent, eventName: string) => {
      console.log(`[useRealtimeEvents] Received ${eventName} event:`, event.data);
      try {
        const data = JSON.parse(event.data as string);
        handlersRef.current[eventName]?.(data);
      } catch (err) { 
        console.error(`[useRealtimeEvents] Failed to parse ${eventName} event:`, err);
      }
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

    es.onerror = (err) => {
      console.error('[useRealtimeEvents] SSE error:', err);
      wasDisconnected = true;
      // EventSource auto-reconnects on error
    };

    return () => {
      console.log('[useRealtimeEvents] Closing SSE connection');
      es.close();
      esRef.current = null;
    };
  }, [enabled]);
}
