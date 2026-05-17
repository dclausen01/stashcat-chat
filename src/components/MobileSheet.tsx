import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { isMobileBridge } from '../lib/mobileBridge';
import { useLayoutMode } from '../hooks/useLayoutMode';
import { bridge, pushBackHandler } from '../lib/flutterBridge';

/**
 * Generischer Bottom-Sheet-Wrapper für Mobile.
 *
 * Auf Phone (`useLayoutMode() === 'mobile'`) ODER im Bridge-Modus rendert die
 * Komponente einen vom unteren Bildschirmrand einfahrenden Sheet mit
 * Drag-Handle und Backdrop. Auf Desktop / Tablet (oder wenn der Aufrufer
 * `forceModal` setzt) verhält sie sich wie ein zentriertes Modal — der
 * bestehende Modal-Stil bleibt also automatisch erhalten.
 *
 * Bewusst minimal: kein eigener Header (Aufrufer rendert seinen eigenen),
 * keine fokus-trap-Magie hier — die Modal-Inhalte bringen sie ggf. selbst mit.
 */
interface MobileSheetProps {
  open: boolean;
  onClose: () => void;
  /** Sichtbares Aria-Label für Screenreader. */
  ariaLabel?: string;
  /** Inhalt des Sheets. Sollte sich an `flex-col` halten. */
  children: ReactNode;
  /** Tailwind-Höhenklasse für den Sheet — Default `max-h-[85vh]`. */
  maxHeightClass?: string;
  /** Auf Desktop-Layout zwingend als Center-Modal rendern (Default: ja). */
  forceModal?: boolean;
  /** Klein, wenn der Inhalt sehr kurz ist. */
  compact?: boolean;
}

export default function MobileSheet({
  open,
  onClose,
  ariaLabel,
  children,
  maxHeightClass = 'max-h-[85vh]',
  forceModal = true,
  compact = false,
}: MobileSheetProps) {
  const layoutMode = useLayoutMode();
  const isPhone = layoutMode === 'mobile' || isMobileBridge();
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const startY = useRef<number | null>(null);
  const [dragOffset, setDragOffset] = useState(0);

  // Esc schließt das Sheet
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Android-Back / iOS-Edge-Swipe (über window.bbzChat.handleBack()):
  // Sheet schließt den Tap und konsumiert die Geste, damit die App nicht
  // in den Hintergrund springt.
  useEffect(() => {
    if (!open) return;
    return pushBackHandler(() => { onClose(); return true; });
  }, [open, onClose]);

  // Body-Scroll auf Mobile pausieren, solange das Sheet offen ist
  useEffect(() => {
    if (!open || !isPhone) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open, isPhone]);

  if (!open) return null;

  // Drag-to-dismiss (nur Phone)
  const onTouchStart = (e: React.TouchEvent) => {
    startY.current = e.touches[0]?.clientY ?? null;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (startY.current === null) return;
    const dy = (e.touches[0]?.clientY ?? 0) - startY.current;
    if (dy > 0) setDragOffset(dy);
  };
  const onTouchEnd = () => {
    if (dragOffset > 120) {
      bridge.haptic('light');
      onClose();
    }
    setDragOffset(0);
    startY.current = null;
  };

  // Desktop / Center-Modal-Variante (Default für ≥ md, wenn forceModal === true)
  if (!isPhone && forceModal) {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <div className="w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-surface-800">
          <div className="flex-1 min-h-0 overflow-y-auto">
            {children}
          </div>
        </div>
      </div>
    );
  }

  // Phone Bottom-Sheet
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={sheetRef}
        className={[
          'relative w-full flex flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl dark:bg-surface-800',
          'animate-[slide-up_220ms_ease-out]',
          compact ? '' : maxHeightClass,
        ].join(' ')}
        style={{
          transform: dragOffset ? `translateY(${dragOffset}px)` : undefined,
          transition: startY.current === null ? 'transform 200ms ease-out' : 'none',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        {/* Drag-Handle */}
        <div className="flex shrink-0 items-center justify-center pt-2 pb-1">
          <div className="h-1.5 w-12 rounded-full bg-surface-300 dark:bg-surface-600" />
        </div>
        {/* Close-X für Accessibility (Drag funktioniert auch ohne) */}
        <button
          type="button"
          onClick={() => { bridge.haptic('light'); onClose(); }}
          aria-label="Schließen"
          className="touch-target absolute right-2 top-2 inline-flex items-center justify-center rounded-full p-1.5 text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-700"
        >
          <X size={18} />
        </button>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
          {children}
        </div>
      </div>
    </div>
  );
}
