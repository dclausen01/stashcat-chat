import { useState, useEffect } from 'react';

export type LayoutMode = 'mobile' | 'desktop';

const isElectron = typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron');

function detectMode(): LayoutMode {
  if (isElectron) return 'desktop';
  const portrait = window.matchMedia('(orientation: portrait)').matches;
  // Portrait on screens narrower than 1200px → mobile layout (covers all tablet portrait sizes)
  const isTablet = window.innerWidth < 1200;
  return portrait && isTablet ? 'mobile' : 'desktop';
}

export function useLayoutMode(): LayoutMode {
  const [mode, setMode] = useState<LayoutMode>(detectMode);

  useEffect(() => {
    const mq = window.matchMedia('(orientation: portrait)');
    const update = () => setMode(detectMode());
    mq.addEventListener('change', update);
    window.addEventListener('resize', update);
    return () => {
      mq.removeEventListener('change', update);
      window.removeEventListener('resize', update);
    };
  }, []);

  return mode;
}
