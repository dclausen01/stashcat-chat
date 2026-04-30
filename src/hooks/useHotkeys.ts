import { useEffect } from 'react';

export interface Hotkey {
  /** Key (lowercased), e.g. "k", ",", "/", "?" */
  key: string;
  /** Require Ctrl on Windows/Linux or Cmd on macOS */
  mod?: boolean;
  /** Require Shift */
  shift?: boolean;
  /** Require Alt/Option */
  alt?: boolean;
  /** Handler — called with the event for preventDefault control */
  handler: (e: KeyboardEvent) => void;
}

const isEditable = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
};

export function useHotkeys(hotkeys: Hotkey[], enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const handler = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      // On macOS, Option+letter produces special chars (e.g. Option+B → '∫').
      // Fall back to the physical key code so Alt shortcuts still match.
      const codeKey = e.code.startsWith('Key') ? e.code.slice(3).toLowerCase() : key;
      const mod = e.ctrlKey || e.metaKey;
      for (const hk of hotkeys) {
        if (hk.key !== key && hk.key !== codeKey) continue;
        if (Boolean(hk.mod) !== mod) continue;
        if (Boolean(hk.shift) !== e.shiftKey) continue;
        if (Boolean(hk.alt) !== e.altKey) continue;
        // Skip plain-letter shortcuts when typing in editable fields, but allow Ctrl/Cmd/Alt-modified ones
        if (!hk.mod && !hk.alt && isEditable(e.target)) continue;
        hk.handler(e);
        return;
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [hotkeys, enabled]);
}
