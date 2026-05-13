// Bidirectional bridge between the Chat WebView and the Flutter shell.
//
// Outgoing calls go through `flutter_inappwebview.callHandler(name, payload)`.
// Incoming calls land on `window.bbzChat.*` which fans events out via
// `bridgeBus` so React contexts can react.

import { isMobileBridge } from './mobileBridge';
import { emit, BridgeEvents } from './bridgeBus';

type BridgePayload = Record<string, unknown> | string | number | boolean | null;

interface InAppWebViewBridge {
  callHandler?: (handler: string, ...args: BridgePayload[]) => Promise<unknown>;
}

function getHandler(): InAppWebViewBridge | null {
  const w = window as unknown as { flutter_inappwebview?: InAppWebViewBridge };
  return w.flutter_inappwebview ?? null;
}

async function call<T = void>(handler: string, payload?: BridgePayload): Promise<T> {
  if (!isMobileBridge()) return undefined as unknown as T;
  const bridge = getHandler();
  if (!bridge?.callHandler) return undefined as unknown as T;
  try {
    return (await bridge.callHandler(handler, payload ?? null)) as T;
  } catch {
    return undefined as unknown as T;
  }
}

export interface NotifyPayload {
  title: string;
  body: string;
  deeplink?: string;
}

/** Outgoing API — Chat → Flutter. All calls no-op outside the bridge. */
export const bridge = {
  /** Signal that the Web app is mounted and authenticated (or anonymous). */
  ready: (info: { user?: string; locale?: string }) => call('bridgeReady', info),
  unread: (count: number) => call('unread', count),
  notify: (n: NotifyPayload) => call('notify', n as unknown as BridgePayload),
  openExternal: (url: string) => call('openExternal', url),
  pickFiles: () => call<string[]>('pickFiles'),
  logout: () => call('logout'),
  jitsi: (url: string) => call('jitsi', url),
  setBadge: (count: number) => call('setBadge', count),
};

/** Parsed deeplink (subset of paths the native shell needs). */
export type Deeplink =
  | { kind: 'channel'; id: string }
  | { kind: 'conversation'; id: string }
  | { kind: 'view'; view: 'polls' | 'calendar' | 'chat' | 'notifications' }
  | { kind: 'unknown'; raw: string };

export function parseDeeplink(path: string): Deeplink {
  if (!path || typeof path !== 'string') return { kind: 'unknown', raw: String(path) };
  const clean = path.split('?')[0].split('#')[0];
  const channel = clean.match(/^\/c\/([^/]+)\/?$/);
  if (channel) return { kind: 'channel', id: channel[1] };
  const conv = clean.match(/^\/d\/([^/]+)\/?$/);
  if (conv) return { kind: 'conversation', id: conv[1] };
  if (clean === '/polls' || clean === '/polls/') return { kind: 'view', view: 'polls' };
  if (clean === '/calendar' || clean === '/calendar/') return { kind: 'view', view: 'calendar' };
  if (clean === '/notifications' || clean === '/notifications/') return { kind: 'view', view: 'notifications' };
  if (clean === '/' || clean === '') return { kind: 'view', view: 'chat' };
  return { kind: 'unknown', raw: path };
}

declare global {
  interface Window {
    bbzChat?: {
      setTheme(mode: 'light' | 'dark'): void;
      setToken(token: string): void;
      navigate(path: string): void;
      reload(): void;
    };
  }
}

/**
 * Registers `window.bbzChat` once, regardless of bridge mode. Outside the
 * mobile bridge the handlers still work (handy for in-browser debugging) but
 * `bridge.*` calls remain no-ops.
 */
export function installBbzChatGlobal(): void {
  if (typeof window === 'undefined') return;
  if (window.bbzChat) return;
  window.bbzChat = {
    setTheme(mode) {
      if (mode === 'light' || mode === 'dark') emit(BridgeEvents.setTheme, mode);
    },
    setToken(token) {
      if (typeof token === 'string' && token.length > 0) emit(BridgeEvents.setToken, token);
    },
    navigate(path) {
      const link = parseDeeplink(path);
      emit(BridgeEvents.navigate, link);
    },
    reload() {
      try {
        window.location.reload();
      } catch {
        /* noop */
      }
    },
  };
}
