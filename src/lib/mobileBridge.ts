// Mobile-Bridge detection + early-bootstrap side effects.
//
// Activated by `?bridge=mobile` in the URL OR `localStorage.bbz_bridge='mobile'`
// (so reloads from inside the Flutter WebView stay in mobile mode).
// When active:
//   * `<html data-bridge="mobile">` is set so Tailwind's `mobile:` variant fires.
//   * Any registered service workers are unregistered and caches cleared
//     (the desktop PWA is incompatible with native push delivery).

const STORAGE_KEY = 'bbz_bridge';

let cached: boolean | null = null;

function detect(): boolean {
  try {
    const params = new URLSearchParams(window.location.search);
    const fromQuery = params.get('bridge') === 'mobile';
    const fromStorage = window.localStorage.getItem(STORAGE_KEY) === 'mobile';
    // A Flutter InAppWebView injects this global before the page boots — treat
    // its presence as a hint even without the query string.
    const fromUA = !!(window as unknown as { flutter_inappwebview?: unknown }).flutter_inappwebview;
    return fromQuery || fromStorage || fromUA;
  } catch {
    return false;
  }
}

export function isMobileBridge(): boolean {
  if (cached === null) cached = detect();
  return cached;
}

/** Force the bridge flag (used by tests, never in app code). */
export function __setMobileBridgeForTesting(value: boolean | null): void {
  cached = value;
}

/**
 * Must run before React mounts. Persists the flag, sets the data attribute,
 * and tears down anything that conflicts with WebView delivery (service worker,
 * caches).
 */
export function bootstrapMobileBridge(): void {
  if (!isMobileBridge()) return;

  try {
    window.localStorage.setItem(STORAGE_KEY, 'mobile');
  } catch {
    /* localStorage may be unavailable; the data attribute still gates UI */
  }

  document.documentElement.dataset.bridge = 'mobile';

  // Tear down service workers (Vite-PWA registers one for desktop). Push is
  // delivered through FCM via the native shell, so no SW is needed.
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .getRegistrations()
      .then((regs) => Promise.all(regs.map((r) => r.unregister())))
      .catch(() => {});
  }
  if (typeof caches !== 'undefined') {
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .catch(() => {});
  }
}

/** Convenience for any code that needs to clear the flag (e.g. dev resets). */
export function clearMobileBridge(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* noop */
  }
  delete document.documentElement.dataset.bridge;
  cached = false;
}
