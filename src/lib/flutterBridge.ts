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

export interface PickFilesOptions {
  /** Mehrfachauswahl erlauben. Default: true. */
  allowMultiple?: boolean;
  /** Filter für den Picker. Default: 'any'. */
  type?: 'image' | 'video' | 'audio' | 'any';
}

export interface PickedFileMeta {
  name: string;
  size: number;
  /** Datei-Inhalt als Base64. */
  base64: string;
}

/**
 * Haptic-Feedback-Intensitäten. Werden vom Flutter-Layer auf die
 * passenden plattformspezifischen Patterns gemappt (HapticFeedback.*).
 */
export type HapticStyle =
  | 'selection'   // leichtes Tippen, z.B. Tab-Wechsel
  | 'light'       // kleine Aktion, z.B. Button-Tap
  | 'medium'      // bestätigende Aktion, z.B. Long-Press, Send
  | 'heavy'       // gewichtige Aktion, z.B. Delete-Konfirmation
  | 'success'     // erfolgreiche Aktion (z.B. Nachricht gesendet)
  | 'warning'
  | 'error';

/** Outgoing API — Chat → Flutter. All calls no-op outside the bridge. */
export const bridge = {
  /** Signal that the Web app is mounted and authenticated (or anonymous). */
  ready: (info: { user?: string; locale?: string }) => call('bridgeReady', info),
  unread: (count: number) => call('unread', count),
  notify: (n: NotifyPayload) => call('notify', n as unknown as BridgePayload),
  openExternal: (url: string) => call('openExternal', url),
  /**
   * Öffnet den nativen Datei-Picker. Liefert URIs der ausgewählten Dateien.
   * Die URIs sind nicht direkt per `fetch()` lesbar — anschließend `readFile`
   * benutzen, um Bytes zu bekommen.
   */
  pickFiles: (opts: PickFilesOptions = {}) =>
    call<string[]>('pickFiles', opts as unknown as BridgePayload),
  /**
   * Öffnet die System-Kamera für eine Foto-Aufnahme. Liefert die URI des
   * gespeicherten Bildes (oder `null`/leeren String, wenn der User
   * abbricht). Bytes anschließend wie üblich über `readFile` holen.
   */
  captureImage: () => call<string | null>('captureImage'),
  /**
   * Öffnet die System-Kamera für eine Video-Aufnahme. Liefert die URI des
   * gespeicherten Videos (oder `null`/leeren String, wenn abgebrochen).
   */
  captureVideo: () => call<string | null>('captureVideo'),
  /** Liest eine via `pickFiles` / `captureImage` / `captureVideo`
   *  zurückgegebene URI als Base64. */
  readFile: (uri: string) => call<PickedFileMeta | null>('readFile', uri),
  logout: () => call('logout'),
  jitsi: (url: string) => call('jitsi', url),
  setBadge: (count: number) => call('setBadge', count),
  /** Signal an die Mobile-Shell, dass sich die "Route" (Active-View /
   *  -Chat) geändert hat — Shell kann darauf z.B. den nächsten Back-Tap
   *  vorab anders behandeln. No-op außerhalb der Bridge. */
  notifyRouteChange: (path: string) => call('notifyRouteChange', path),
  /**
   * Native Haptic-Feedback. No-op außerhalb des Bridges UND im
   * Web-Fallback (Vibration-API) wenn `Vibration` verfügbar.
   */
  haptic: (style: HapticStyle = 'selection') => {
    if (isMobileBridge()) return call('haptic', style);
    // Fallback: Web Vibration API (Android Chrome). iOS Safari ignoriert es.
    try {
      const nav = navigator as Navigator & { vibrate?: (p: number | number[]) => boolean };
      if (typeof nav.vibrate === 'function') {
        const pattern: Record<HapticStyle, number | number[]> = {
          selection: 8,
          light: 10,
          medium: 20,
          heavy: 35,
          success: [10, 30, 10],
          warning: [20, 40, 20],
          error: [30, 60, 30, 60, 30],
        };
        nav.vibrate(pattern[style] ?? 10);
      }
    } catch {
      /* manche Browser blocken vibrate() ohne User-Gesture — egal */
    }
    return Promise.resolve(undefined);
  },
};

// ── File-Picker-Wrapper ──────────────────────────────────────────────────────

function base64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  gif: 'image/gif', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif',
  svg: 'image/svg+xml',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', '3gp': 'video/3gpp',
  mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', wav: 'audio/wav',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  txt: 'text/plain', csv: 'text/csv', md: 'text/markdown',
  zip: 'application/zip',
};

function guessMime(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

/**
 * Öffnet im Mobile-Bridge-Modus den nativen File-Picker und liefert die
 * Auswahl als ganz normale `File[]`-Objekte zurück (binäridentisch mit
 * `<input type=file>`-Output, sodass der bestehende Upload-Pfad
 * unverändert greift). Außerhalb des Bridges: leeres Array.
 *
 * Aufrufer im Desktop-/Web-Modus sollten weiterhin `<input type=file>` benutzen.
 */
export async function pickFilesNative(opts: PickFilesOptions = {}): Promise<File[]> {
  if (!isMobileBridge()) return [];
  const inAppWebView = (window as unknown as { flutter_inappwebview?: InAppWebViewBridge }).flutter_inappwebview;
  if (!inAppWebView?.callHandler) return [];

  const uris = (await bridge.pickFiles(opts)) ?? [];
  if (!Array.isArray(uris) || uris.length === 0) return [];

  return urisToFiles(uris);
}

/**
 * Öffnet die System-Kamera (Foto oder Video, je nach `kind`) und gibt das
 * Resultat als ein-Element-`File[]` zurück. Außerhalb des Bridges bzw. wenn
 * der User abbricht: leeres Array.
 *
 * Die zugrunde liegende Bridge muss den passenden Handler (`captureImage` /
 * `captureVideo`) bereitstellen.
 */
export async function captureFromCameraNative(kind: 'image' | 'video'): Promise<File[]> {
  if (!isMobileBridge()) return [];
  const inAppWebView = (window as unknown as { flutter_inappwebview?: InAppWebViewBridge }).flutter_inappwebview;
  if (!inAppWebView?.callHandler) return [];

  const uri = kind === 'image' ? await bridge.captureImage() : await bridge.captureVideo();
  if (!uri || typeof uri !== 'string') return [];

  return urisToFiles([uri]);
}

/** URIs (via Bridge) → File[] (lokal lesbar) — gemeinsame Pipeline. */
async function urisToFiles(uris: string[]): Promise<File[]> {
  const files: File[] = [];
  for (const uri of uris) {
    try {
      const meta = await bridge.readFile(uri);
      if (!meta || !meta.base64) continue;
      const bytes = base64ToUint8(meta.base64);
      const mime = guessMime(meta.name);
      const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      const blob = new Blob([buf], { type: mime });
      files.push(new File([blob], meta.name, { type: mime }));
    } catch {
      /* einzelne Datei-Fehler ignorieren, nicht den ganzen Vorgang abbrechen */
    }
  }
  return files;
}

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
      handleBack(): boolean;
    };
  }
}

// ── Back-Handler-Stack ───────────────────────────────────────────────────────
// LIFO: zuletzt registrierter Handler bekommt den Back-Tap zuerst.
// Komponenten (Bottom-Sheets, Modals, Bubble-Action-Sheet) registrieren ihren
// eigenen Handler in useEffect, App.tsx registriert einen Fallback ganz unten
// im Stack.
const backHandlers: Array<() => boolean> = [];

/**
 * Registriert einen synchronen Back-Handler. Gibt der Handler `true` zurück,
 * gilt der Back-Gestus als konsumiert. Der Rückgabewert der Funktion ist
 * ein Unsubscribe-Callback, mit dem der Handler entfernt wird (typisch in
 * der Cleanup-Function eines useEffect).
 */
export function pushBackHandler(handler: () => boolean): () => void {
  backHandlers.push(handler);
  return () => {
    const idx = backHandlers.indexOf(handler);
    if (idx >= 0) backHandlers.splice(idx, 1);
  };
}

/** Wird ausschließlich von `window.bbzChat.handleBack()` aufgerufen. */
function runBackHandlers(): boolean {
  for (let i = backHandlers.length - 1; i >= 0; i--) {
    try {
      if (backHandlers[i]() === true) return true;
    } catch {
      /* defensiver Skip — nicht den ganzen Stack abbrechen */
    }
  }
  return false;
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
    handleBack(): boolean {
      return runBackHandlers();
    },
  };
}
