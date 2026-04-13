import { useEffect, useRef } from 'react';

type SSEHandler = (data: unknown) => void;

/** Singleton SSE connection shared across all useRealtimeEvents consumers.
 *  Prevents multiple EventSource instances from being created when multiple
 *  components (Sidebar + ChatView) both use useRealtimeEvents.
 *
 *  Includes resilience features:
 *  - Checks readyState (not just null) to detect dead connections
 *  - Heartbeat watchdog: detects silent TCP drops
 *  - visibilitychange handler: reconnects after tab wakeup
 *  - Robust onerror: recreates EventSource if auto-reconnect fails
 */
let sharedEs: EventSource | null = null;
let sharedHandlers: Record<string, SSEHandler> = {};
let sharedWasDisconnected = false;

/** Timestamp of the last received SSE event (any type, including heartbeat) */
let lastEventTime = 0;

/** Interval ID for the heartbeat watchdog */
let watchdogInterval: ReturnType<typeof setInterval> | null = null;

/** How long (ms) without any SSE event before we consider the connection dead.
 *  Server sends heartbeats every 25s, so 45s gives ample margin. */
const WATCHDOG_TIMEOUT = 45_000;

/** How often (ms) the watchdog checks for staleness */
const WATCHDOG_INTERVAL = 15_000;

/** Build the SSE URL with token */
function getSseUrl(): string | null {
  const token = localStorage.getItem('schulchat_token');
  if (!token) return null;
  const apiBase = import.meta.env.DEV ? '/backend/api' : '/api';
  return `${apiBase}/events?token=${encodeURIComponent(token)}`;
}

/** Re-dispatch an event to all registered handlers */
function dispatchToHandlers(event: MessageEvent, eventName: string) {
  lastEventTime = Date.now();
  try {
    const data = JSON.parse(event.data as string);
    sharedHandlers[eventName]?.(data);
  } catch (err) {
    console.error(`[useRealtimeEvents] Failed to parse ${eventName} event:`, err);
  }
}

/** Tear down the current EventSource completely */
function destroyEventSource() {
  if (sharedEs) {
    sharedEs.close();
    sharedEs = null;
  }
}

/** Start the heartbeat watchdog */
function startWatchdog() {
  stopWatchdog();
  lastEventTime = Date.now();
  watchdogInterval = setInterval(() => {
    if (!sharedEs) return;
    const elapsed = Date.now() - lastEventTime;
    if (elapsed > WATCHDOG_TIMEOUT) {
      console.warn(`[useRealtimeEvents] No SSE event received for ${Math.round(elapsed / 1000)}s — reconnecting`);
      // Connection is likely dead — tear down and recreate
      destroyEventSource();
      sharedWasDisconnected = true;
      ensureSharedEventSource();
    }
  }, WATCHDOG_INTERVAL);
}

/** Stop the heartbeat watchdog */
function stopWatchdog() {
  if (watchdogInterval !== null) {
    clearInterval(watchdogInterval);
    watchdogInterval = null;
  }
}

/** Initialize the shared EventSource if not already done (or if connection is dead) */
function ensureSharedEventSource() {
  // Check if we have a healthy connection already
  if (sharedEs) {
    if (sharedEs.readyState === EventSource.OPEN || sharedEs.readyState === EventSource.CONNECTING) {
      return; // Connection is alive or reconnecting — nothing to do
    }
    // readyState is CLOSED — the old EventSource is dead, tear it down
    console.warn('[useRealtimeEvents] EventSource is CLOSED, recreating connection');
    destroyEventSource();
  }

  const url = getSseUrl();
  if (!url) {
    console.log('[useRealtimeEvents] No token found, skipping connection');
    return;
  }

  console.log('[useRealtimeEvents] Connecting to SSE:', url);
  sharedEs = new EventSource(url);

  sharedEs.addEventListener('message_sync', (e) => dispatchToHandlers(e, 'message_sync'));
  sharedEs.addEventListener('typing', (e) => dispatchToHandlers(e, 'typing'));
  sharedEs.addEventListener('heartbeat', () => {
    // Server sends named heartbeat events — just update the watchdog timestamp
    lastEventTime = Date.now();
  });
  sharedEs.addEventListener('connected', () => {
    lastEventTime = Date.now();
    if (sharedWasDisconnected) {
      sharedWasDisconnected = false;
      sharedHandlers['reconnect']?.({});
    }
  });

  // Also track the generic 'message' event to catch heartbeat comments
  // SSE comment lines (`: heartbeat\n\n`) don't trigger addEventListener,
  // but the onmessage handler catches unnamed events. We use this
  // only to update the watchdog timestamp.
  sharedEs.onmessage = () => {
    lastEventTime = Date.now();
  };

  sharedEs.onerror = () => {
    console.error('[useRealtimeEvents] SSE error, readyState:', sharedEs?.readyState);
    sharedWasDisconnected = true;
    // If the EventSource has transitioned to CLOSED, auto-reconnect has given up.
    // Tear down and schedule a manual reconnect.
    if (sharedEs && sharedEs.readyState === EventSource.CLOSED) {
      console.warn('[useRealtimeEvents] EventSource CLOSED — will retry via watchdog');
      destroyEventSource();
      // The watchdog will recreate the connection on its next check
    }
    // If readyState is CONNECTING, EventSource is trying to auto-reconnect — let it.
  };

  startWatchdog();
}

/** Check SSE health and reconnect if needed (called on visibilitychange) */
function checkAndReconnect() {
  if (!sharedEs) {
    // No connection at all — try to create one
    ensureSharedEventSource();
    return;
  }

  if (sharedEs.readyState === EventSource.CLOSED) {
    console.warn('[useRealtimeEvents] Tab woke up with CLOSED EventSource — reconnecting');
    destroyEventSource();
    sharedWasDisconnected = true;
    ensureSharedEventSource();
    return;
  }

  // If OPEN, check if we've been receiving events
  const elapsed = Date.now() - lastEventTime;
  if (elapsed > WATCHDOG_TIMEOUT) {
    console.warn(`[useRealtimeEvents] Tab woke up, no SSE events for ${Math.round(elapsed / 1000)}s — reconnecting`);
    destroyEventSource();
    sharedWasDisconnected = true;
    ensureSharedEventSource();
  }
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

    // Ensure singleton EventSource is created (or recreated if dead)
    ensureSharedEventSource();

    // If EventSource couldn't be created (no token), nothing more to do
    if (!sharedEs) return;

    // Sync handlers into the shared handler map so dispatch sees them
    // (The shared handlersRef gets updated below on each render)
    const updateShared = () => {
      sharedHandlers = { ...sharedHandlers, ...handlersRef.current };
    };
    updateShared();

    // visibilitychange handler: reconnect SSE after tab wakeup
    const onVisibilityChange = () => {
      if (!document.hidden) {
        // Small delay to let the browser settle after tab switch
        setTimeout(checkAndReconnect, 500);
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      // Remove only this consumer's handlers from the shared map
      Object.keys(handlers).forEach(key => {
        delete sharedHandlers[key];
      });
      document.removeEventListener('visibilitychange', onVisibilityChange);
      // Note: We intentionally do NOT close sharedEs here.
      // The connection is shared across all consumers and will be closed
      // via closeRealtimeConnection() on logout.
    };
  }, [enabled]);
}

/** Close the shared SSE connection. Call this when the app logs out. */
export function closeRealtimeConnection() {
  if (sharedEs) {
    console.log('[useRealtimeEvents] Closing SSE connection');
    sharedEs.close();
    sharedEs = null;
  }
  stopWatchdog();
  sharedHandlers = {};
  sharedWasDisconnected = false;
  lastEventTime = 0;
}