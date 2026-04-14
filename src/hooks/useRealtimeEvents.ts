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
 *  - Multi-consumer handler registry: no key collision between consumers
 *
 *  CRITICAL FIX (2026-04-13 v2): Previous version used a flat Record<string, SSEHandler>
 *  for sharedHandlers. When multiple consumers (Sidebar + ChatView) registered handlers
 *  for the same event (e.g. 'message_sync'), the later consumer OVERWROTE the earlier one.
 *  This caused Sidebar to stop receiving message_sync events as soon as ChatView mounted —
 *  meaning no unread count updates, no badge updates, no title updates.
 *
 *  Now uses a Map<string, Set<SSEHandler>> so all consumers receive events independently.
 *  Each consumer's handlers are tracked by a unique consumerId so they can be properly
 *  removed on unmount without affecting other consumers.
 */
let sharedEs: EventSource | null = null;

/** Multi-consumer handler registry: event name → set of handler functions.
 *  Multiple consumers (Sidebar, ChatView) can register handlers for the same
 *  event. All handlers for an event are called when that event arrives. */
let sharedHandlers = new Map<string, Set<SSEHandler>>();

/** Track which consumer registered which handlers, so we can remove only
 *  that consumer's handlers on unmount without affecting others.
 *  Maps consumerId → Map<eventName, handler> */
const consumerRegistry = new Map<string, Map<string, SSEHandler>>();

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

/** Auto-incrementing consumer ID generator */
let nextConsumerId = 0;

/** Build the SSE URL with token */
function getSseUrl(): string | null {
  const token = localStorage.getItem('schulchat_token');
  if (!token) return null;
  const apiBase = import.meta.env.DEV ? '/backend/api' : '/api';
  return `${apiBase}/events?token=${encodeURIComponent(token)}`;
}

/** Dispatch an event to ALL registered handlers for that event name.
 *  This is the core fix: every consumer gets the event, not just the last one. */
function dispatchToHandlers(event: MessageEvent, eventName: string) {
  lastEventTime = Date.now();
  try {
    const data = JSON.parse(event.data as string);
    const handlers = sharedHandlers.get(eventName);
    if (handlers) {
      for (const handler of handlers) {
        try {
          handler(data);
        } catch (err) {
          console.error(`[useRealtimeEvents] Handler error for ${eventName}:`, err);
        }
      }
    }
  } catch (err) {
    console.error(`[useRealtimeEvents] Failed to parse ${eventName} event:`, err);
  }
}

/** Dispatch a non-SSE event (e.g. 'reconnect') to all registered handlers */
function dispatchNamedEvent(eventName: string, data: unknown) {
  const handlers = sharedHandlers.get(eventName);
  if (handlers) {
    for (const handler of handlers) {
      try {
        handler(data);
      } catch (err) {
        console.error(`[useRealtimeEvents] Handler error for ${eventName}:`, err);
      }
    }
  }
}

/** Register a consumer's handlers into the shared handler map */
function registerConsumer(consumerId: string, handlers: Record<string, SSEHandler>) {
  const consumerHandlers = new Map<string, SSEHandler>();
  for (const [eventName, handler] of Object.entries(handlers)) {
    // Add to shared handler map
    if (!sharedHandlers.has(eventName)) {
      sharedHandlers.set(eventName, new Set());
    }
    sharedHandlers.get(eventName)!.add(handler);
    // Track for cleanup
    consumerHandlers.set(eventName, handler);
  }
  consumerRegistry.set(consumerId, consumerHandlers);
}

/** Unregister a consumer's handlers from the shared handler map */
function unregisterConsumer(consumerId: string) {
  const consumerHandlers = consumerRegistry.get(consumerId);
  if (!consumerHandlers) return;
  for (const [eventName, handler] of consumerHandlers) {
    const handlerSet = sharedHandlers.get(eventName);
    if (handlerSet) {
      handlerSet.delete(handler);
      // Clean up empty sets
      if (handlerSet.size === 0) {
        sharedHandlers.delete(eventName);
      }
    }
  }
  consumerRegistry.delete(consumerId);
}

/** Update a consumer's handlers (e.g. when re-render causes new handler refs).
 *  Removes old handlers and registers new ones, preserving other consumers.
 *
 *  IMPORTANT: handler replacement is atomic — we add the new handler BEFORE
 *  removing the old one to ensure no events are lost during the swap window. */
function updateConsumerHandlers(consumerId: string, newHandlers: Record<string, SSEHandler>) {
  const oldHandlers = consumerRegistry.get(consumerId);
  if (!oldHandlers) {
    // Not registered yet — do a full registration
    registerConsumer(consumerId, newHandlers);
    return;
  }

  // Phase 1: Add/update new handlers FIRST (atomic — no gap)
  for (const [eventName, newHandler] of Object.entries(newHandlers)) {
    const existingHandler = oldHandlers.get(eventName);
    if (existingHandler === newHandler) continue; // Same ref, no change

    if (!sharedHandlers.has(eventName)) {
      sharedHandlers.set(eventName, new Set());
    }
    // Add new handler before removing old one — prevents event loss
    sharedHandlers.get(eventName)!.add(newHandler);
    oldHandlers.set(eventName, newHandler);
  }

  // Phase 2: Remove old handlers that are no longer in the new set
  const toRemove: string[] = [];
  for (const [eventName] of oldHandlers) {
    if (!(eventName in newHandlers)) {
      toRemove.push(eventName);
    }
  }
  for (const eventName of toRemove) {
    const oldHandler = oldHandlers.get(eventName);
    if (oldHandler) {
      const handlerSet = sharedHandlers.get(eventName);
      if (handlerSet) {
        handlerSet.delete(oldHandler);
        if (handlerSet.size === 0) {
          sharedHandlers.delete(eventName);
        }
      }
      oldHandlers.delete(eventName);
    }
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
      dispatchNamedEvent('reconnect', {});
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
 *
 *  Multiple consumers can register handlers for the same event name — all will be
 *  called. This is critical because both Sidebar (for unread counts) and ChatView
 *  (for live message display) need 'message_sync' events simultaneously.
 */
export function useRealtimeEvents(
  handlers: Record<string, SSEHandler>,
  enabled: boolean
) {
  const handlersRef = useRef(handlers);
  // Stable consumer ID for this hook instance — survives re-renders
  const consumerIdRef = useRef<string | null>(null);

  // Keep handlersRef.current in sync (runs on every render)
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    if (!enabled) return;

    const url = getSseUrl();
    if (!url) return;

    // Assign a stable consumer ID on first mount
    if (!consumerIdRef.current) {
      consumerIdRef.current = `consumer_${nextConsumerId++}`;
    }
    const consumerId = consumerIdRef.current;

    // Register this consumer's handlers into the shared map
    registerConsumer(consumerId, handlers);

    // Ensure singleton EventSource is created (or recreated if dead)
    ensureSharedEventSource();

    // If EventSource couldn't be created (no token), nothing more to do
    if (!sharedEs) return;

    // visibilitychange handler: reconnect SSE after tab wakeup
    const onVisibilityChange = () => {
      if (!document.hidden) {
        // Small delay to let the browser settle after tab switch
        setTimeout(checkAndReconnect, 500);
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      // Remove ONLY this consumer's handlers — other consumers remain intact
      unregisterConsumer(consumerId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      // Note: We intentionally do NOT close sharedEs here.
      // The connection is shared across all consumers and will be closed
      // via closeRealtimeConnection() on logout.
    };
  }, [enabled]);

  // Keep handlers updated on every render so closures stay fresh.
  // This is important because handlers capture state (like user?.id)
  // that may change over time.
  useEffect(() => {
    if (!consumerIdRef.current) return;
    updateConsumerHandlers(consumerIdRef.current, handlersRef.current);
  });
}

/** Close the shared SSE connection. Call this when the app logs out. */
export function closeRealtimeConnection() {
  if (sharedEs) {
    console.log('[useRealtimeEvents] Closing SSE connection');
    sharedEs.close();
    sharedEs = null;
  }
  stopWatchdog();
  sharedHandlers.clear();
  consumerRegistry.clear();
  sharedWasDisconnected = false;
  lastEventTime = 0;
}