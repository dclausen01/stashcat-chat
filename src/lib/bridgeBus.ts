// Tiny event bus used to relay calls from `window.bbzChat` (which lives outside
// React) into context providers / components that subscribe at mount time.

type Handler<T = unknown> = (payload: T) => void;

const handlers = new Map<string, Set<Handler>>();

export function on<T = unknown>(event: string, handler: Handler<T>): () => void {
  let set = handlers.get(event);
  if (!set) {
    set = new Set();
    handlers.set(event, set);
  }
  set.add(handler as Handler);
  return () => {
    set!.delete(handler as Handler);
  };
}

export function emit<T = unknown>(event: string, payload?: T): void {
  const set = handlers.get(event);
  if (!set) return;
  for (const h of [...set]) {
    try {
      h(payload as T);
    } catch {
      /* swallow listener errors */
    }
  }
}

export const BridgeEvents = {
  setTheme: 'bridge:setTheme',
  setToken: 'bridge:setToken',
  navigate: 'bridge:navigate',
  reload: 'bridge:reload',
} as const;
