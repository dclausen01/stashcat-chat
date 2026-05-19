import { useState, useEffect } from 'react';

export type LayoutMode = 'mobile' | 'tablet' | 'desktop';

const isElectron = typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron');

function isDeviceLandscape(): boolean {
  // screen.orientation uses actual device orientation — unaffected by keyboard resize.
  // Falls back to screen dimensions (also stable) for older browsers / iOS < 16.4.
  if (screen.orientation?.type) return screen.orientation.type.startsWith('landscape');
  return window.screen.width > window.screen.height;
}

function detectMode(): LayoutMode {
  if (isElectron) return 'desktop';
  const width = window.innerWidth;
  if (width >= 1200) return 'desktop';
  // Tablets in landscape get desktop layout (same as before), but the check
  // uses screen.orientation instead of window aspect-ratio so keyboards don't
  // accidentally flip a phone into 'desktop' mode when the viewport shrinks.
  if (width >= 768) return isDeviceLandscape() ? 'desktop' : 'tablet';
  return 'mobile';
}

export function useLayoutMode(): LayoutMode {
  const [mode, setMode] = useState<LayoutMode>(detectMode);

  useEffect(() => {
    const update = () => setMode(detectMode());
    window.addEventListener('resize', update);
    screen.orientation?.addEventListener('change', update);
    return () => {
      window.removeEventListener('resize', update);
      screen.orientation?.removeEventListener('change', update);
    };
  }, []);

  return mode;
}
