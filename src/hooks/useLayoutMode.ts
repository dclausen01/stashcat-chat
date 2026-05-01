import { useState, useEffect } from 'react';

export type LayoutMode = 'mobile' | 'tablet' | 'desktop';

const isElectron = typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron');

function detectMode(): LayoutMode {
  if (isElectron) return 'desktop';
  const portrait = window.matchMedia('(orientation: portrait)').matches;
  const width = window.innerWidth;
  if (!portrait || width >= 1200) return 'desktop';
  if (width >= 768) return 'tablet'; // portrait tablet — desktop layout, mobile chat-header
  return 'mobile';
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
