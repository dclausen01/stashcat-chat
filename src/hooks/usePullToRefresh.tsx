import { useCallback, useEffect, useRef, useState } from 'react';
import { bridge } from '../lib/flutterBridge';
import { useLayoutMode } from './useLayoutMode';

/**
 * Pull-to-refresh-Geste für scrollbare Container.
 *
 * Aktiv nur auf `layoutMode === 'mobile'` — Desktop und Tablet werden komplett
 * ignoriert, der Container verhält sich dort wie immer.
 *
 * Verwendung:
 *   const { containerRef, indicator } = usePullToRefresh(async () => {
 *     await refetch();
 *   });
 *   return (
 *     <div ref={containerRef} className="overflow-y-auto ...">
 *       {indicator}
 *       ... Inhalt ...
 *     </div>
 *   );
 */
export interface PullToRefreshResult {
  containerRef: React.RefCallback<HTMLElement>;
  /** Vorgerendertes Indicator-Element, das im Container ganz oben einzufügen ist. */
  indicator: React.ReactNode;
  isRefreshing: boolean;
}

const THRESHOLD = 70;   // px ab denen ausgelöst wird
const MAX_PULL = 120;   // px sichtbarer Hub

export function usePullToRefresh(
  onRefresh: () => void | Promise<void>,
  options: { enabled?: boolean } = {},
): PullToRefreshResult {
  const layoutMode = useLayoutMode();
  const enabled = (options.enabled ?? true) && layoutMode === 'mobile';

  const elRef = useRef<HTMLElement | null>(null);
  const startY = useRef<number | null>(null);
  const lastY = useRef<number>(0);
  const pulling = useRef<boolean>(false);
  const [pull, setPull] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const hapticFiredRef = useRef(false);

  const trigger = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    bridge.haptic('medium');
    try {
      await onRefresh();
    } finally {
      // Kurze Verzögerung, damit der Indicator nicht abrupt verschwindet
      setTimeout(() => {
        setIsRefreshing(false);
        setPull(0);
      }, 250);
    }
  }, [isRefreshing, onRefresh]);

  // Touch-Handler an das Element binden (passive: false, damit wir
  // bei aktivem Pull preventDefault rufen können).
  useEffect(() => {
    const el = elRef.current;
    if (!el || !enabled) return;

    const onTouchStart = (e: TouchEvent) => {
      if (isRefreshing) return;
      if (el.scrollTop > 0) return; // nur am oberen Rand
      startY.current = e.touches[0]?.clientY ?? null;
      lastY.current = startY.current ?? 0;
      pulling.current = false;
      hapticFiredRef.current = false;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (startY.current === null || isRefreshing) return;
      const y = e.touches[0]?.clientY ?? 0;
      lastY.current = y;
      const dy = y - startY.current;
      if (dy <= 0) return;
      // Sobald gepullt wird, das native Scroll-Refresh unterdrücken.
      if (e.cancelable) e.preventDefault();
      pulling.current = true;
      // Dampfung nach 50% des Maxes
      const damped = dy < MAX_PULL ? dy : MAX_PULL + (dy - MAX_PULL) * 0.2;
      setPull(Math.min(damped, MAX_PULL + 30));
      if (!hapticFiredRef.current && damped >= THRESHOLD) {
        bridge.haptic('selection');
        hapticFiredRef.current = true;
      } else if (hapticFiredRef.current && damped < THRESHOLD) {
        // zurück unter den Threshold → bereit, beim nächsten Crossing wieder zu feuern
        hapticFiredRef.current = false;
      }
    };
    const onTouchEnd = () => {
      if (!pulling.current) {
        startY.current = null;
        return;
      }
      pulling.current = false;
      const dy = lastY.current - (startY.current ?? lastY.current);
      startY.current = null;
      if (dy >= THRESHOLD) {
        void trigger();
      } else {
        setPull(0);
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd, { passive: true });
    el.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [enabled, isRefreshing, trigger]);

  const containerRef = useCallback((node: HTMLElement | null) => {
    elRef.current = node;
  }, []);

  const progress = Math.min(1, pull / THRESHOLD);

  const indicator = enabled && (pull > 0 || isRefreshing) ? (
    <div
      aria-hidden={!isRefreshing}
      className="pointer-events-none flex items-center justify-center overflow-hidden text-primary-600 dark:text-primary-400"
      style={{
        height: isRefreshing ? 48 : pull,
        transition: pulling.current ? 'none' : 'height 200ms ease-out',
      }}
    >
      <svg
        viewBox="0 0 24 24"
        width={24}
        height={24}
        className={isRefreshing ? 'animate-spin' : ''}
        style={{
          transform: isRefreshing ? undefined : `rotate(${progress * 360}deg)`,
          opacity: Math.max(0.4, progress),
        }}
      >
        <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="50 70" />
      </svg>
    </div>
  ) : null;

  return { containerRef, indicator, isRefreshing };
}
