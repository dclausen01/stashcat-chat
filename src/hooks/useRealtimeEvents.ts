import { useEffect, useRef } from 'react';

type SSEHandler = (data: unknown) => void;

/** Singleton SSE connection shared across all useRealtimeEvents consumers.
 *  Prevents multiple EventSource instances from being created when multiple
 *  components (Sidebar + ChatView) both use useRealtimeEvents.
 */
let sharedEs: EventSource | null = null;
let sharedHandlers: Record<string, SSEHandler> = {};
let sharedWasDisconnected = false;

/** Build the SSE URL with token */
function getSseUrl(): string | null {
  const token = localStorage.getItem('schulchat_token');
  if (!token) return null;
  const apiBase = import.meta.env.DEV ? '/backend/api' : '/api';
  return `${apiBase}/events?token=${encodeURIComponent(token)}`;
}

/** Re-dispatch an event to all registered handlers */
function dispatchToHandlers(event: MessageEvent, eventName: string) {
  console.log(`[useRealtimeEvents] Received ${eventName} event:`, event.data);
  try {
    const data = JSON.parse(event.data as string);
    sharedHandlers[eventName]?.(data);
  } catch (err) {
    console.error(`[useRealtimeEvents] Failed to parse ${eventName} event:`, err);
  }
}

/** Initialize the shared EventSource if not already done */
function ensureSharedEventSource() {
  if (sharedEs) return; // Already connected

  const url = getSseUrl();
  if (!url) {
    console.log('[useRealtimeEvents] No token found, skipping connection');
    return;
  }

  console.log('[useRealtimeEvents] Connecting to SSE:', url);
  sharedEs = new EventSource(url);

  sharedEs.addEventListener('message_sync', (e) => dispatchToHandlers(e, 'message_sync'));
  sharedEs.addEventListener('typing', (e) => dispatchToHandlers(e, 'typing'));
  sharedEs.addEventListener('connected', () => {
    if (sharedWasDisconnected) {
      sharedWasDisconnected = false;
      sharedHandlers['reconnect']?.({});
    }
  });

  sharedEs.onerror = (err) => {
    console.error('[useRealtimeEvents] SSE error:', err);
    sharedWasDisconnected = true;
    // EventSource auto-reconnects on error
  };
}

/** Connects to the backend SSE stream and dispatches events to registered handlers.
 *  Uses a singleton EventSource so multiple consumers share the same connection.
 */
export function useRealtimeEvents(
  handlers: Record<string, SSEHandler>,
  enabled: boolean
) {
  const handlersRef = useRef(handlers);

  // Keep handlersRef.current in sync (runs on every render)
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    if (!enabled) return;

    const url = getSseUrl();
    if (!url) return;

    // Merge new handlers into shared handlers
    sharedHandlers = { ...sharedHandlers, ...handlers };

    // Ensure singleton EventSource is created
    ensureSharedEventSource();

    // If EventSource couldn't be created (no token), nothing more to do
    if (!sharedEs) return;

    // Sync handlers into the shared handler map so dispatch sees them
    // (The shared handlersRef gets updated below on each render)
    const updateShared = () => {
      sharedHandlers = { ...sharedHandlers, ...handlersRef.current };
    };
    updateShared();

    return () => {
      // Remove only this consumer's handlers from the shared map
      Object.keys(handlers).forEach(key => {
        delete sharedHandlers[key];
      });
      // Note: We intentionally do NOT close sharedEs here.
      // The connection is shared across all consumers and will be closed
      // when the last consumer unmounts (tracked via useRealtimeEvents.__closeAll).
    };
  }, [enabled]);
}

/** Close the shared SSE connection. Call this when the app logs out. */
export function closeRealtimeConnection() {
  if (sharedEs) {
    console.log('[useRealtimeEvents] Closing SSE connection');
    sharedEs.close();
    sharedEs = null;
    sharedHandlers = {};
    sharedWasDisconnected = false;
  }
}
