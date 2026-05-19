import { useState, useEffect } from 'react';

export type LayoutMode = 'mobile' | 'tablet' | 'desktop';

const isElectron = typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron');

function detectMode(): LayoutMode {
  if (isElectron) return 'desktop';
  const width = window.innerWidth;
  if (width >= 1200) return 'desktop';
  if (width >= 768) return 'tablet';
  return 'mobile';
}

export function useLayoutMode(): LayoutMode {
  const [mode, setMode] = useState<LayoutMode>(detectMode);

  useEffect(() => {
    const update = () => setMode(detectMode());
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  return mode;
}
