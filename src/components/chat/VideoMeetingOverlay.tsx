import { Loader2, Video, RotateCw, X } from 'lucide-react';

export type VideoMeetingOverlayState =
  | { status: 'loading' }
  | { status: 'error'; message: string };

type Props = {
  state: VideoMeetingOverlayState;
  onRetry: () => void;
  onClose: () => void;
};

/**
 * In-App-Overlay fuer die Videokonferenz-Vorbereitung.
 *
 * Ersetzt das frueher separat via window.open geoeffnete Warte-Fenster. Das
 * Overlay wird vom aufrufenden ChatView geschlossen, sobald der Einladungslink
 * im Chat gepostet wurde (Erfolg). Im Fehler-/Timeout-Fall bleibt es mit einer
 * verstaendlichen Meldung sowie "Erneut versuchen"/"Schliessen" sichtbar.
 */
export function VideoMeetingOverlay({ state, onRetry, onClose }: Props) {
  const isError = state.status === 'error';
  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-surface-900/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Videokonferenz"
    >
      <div className="w-full max-w-sm rounded-2xl border border-surface-200 bg-white p-8 text-center shadow-2xl dark:border-surface-700 dark:bg-surface-800">
        {isError ? (
          <>
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/30">
              <Video size={30} className="text-red-600 dark:text-red-400" />
            </div>
            <h2 className="mb-1 text-lg font-semibold text-surface-900 dark:text-surface-50">
              Videokonferenz fehlgeschlagen
            </h2>
            <p className="mb-6 text-sm text-surface-500 dark:text-surface-400">
              {state.message}
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-surface-300 px-4 py-2.5 text-sm font-medium text-surface-700 transition hover:bg-surface-100 dark:border-surface-600 dark:text-surface-200 dark:hover:bg-surface-700"
              >
                <X size={16} /> Schließen
              </button>
              <button
                type="button"
                onClick={onRetry}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-primary-700 active:scale-95"
              >
                <RotateCw size={16} /> Erneut versuchen
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-primary-100 dark:bg-primary-900/30">
              <Loader2 size={32} className="animate-spin text-primary-600 dark:text-primary-400" />
            </div>
            <h2 className="mb-1 text-lg font-semibold text-surface-900 dark:text-surface-50">
              Videokonferenz wird vorbereitet…
            </h2>
            <p className="text-sm text-surface-500 dark:text-surface-400">
              Bitte einen Moment warten, die Konferenz wird gestartet.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
