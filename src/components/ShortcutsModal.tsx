import { X } from 'lucide-react';
import { FocusTrap } from 'focus-trap-react';
import { useEscapeKey } from '../hooks/useEscapeKey';

interface ShortcutsModalProps {
  onClose: () => void;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Strg';

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: [MOD, 'K'], label: 'Schnell zwischen Chats wechseln' },
  { keys: [MOD, ','], label: 'Einstellungen öffnen' },
  { keys: ['Strg', '␣'], label: 'Emoji-Picker öffnen / schließen' },
  { keys: ['Alt', 'C'], label: 'Kalender öffnen' },
  { keys: ['Alt', 'B'], label: 'Broadcasts öffnen' },
  { keys: ['Alt', 'U'], label: 'Umfragen öffnen' },
  { keys: ['?'], label: 'Diese Hilfe anzeigen' },
  { keys: ['Esc'], label: 'Modal / Panel schließen' },
];

export default function ShortcutsModal({ onClose }: ShortcutsModalProps) {
  useEscapeKey(onClose);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <FocusTrap focusTrapOptions={{ escapeDeactivates: false, allowOutsideClick: true }}>
      <div
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-surface-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-surface-900 dark:text-white">Tastatur-Shortcuts</h3>
          <button
            onClick={onClose}
            aria-label="Schließen"
            className="rounded-lg p-1 text-surface-500 hover:bg-surface-200 dark:hover:bg-surface-700"
          >
            <X size={16} />
          </button>
        </div>
        <ul className="space-y-2">
          {SHORTCUTS.map((s, i) => (
            <li key={i} className="flex items-center justify-between gap-3 text-sm">
              <span className="text-surface-700 dark:text-surface-300">{s.label}</span>
              <span className="flex shrink-0 gap-1">
                {s.keys.map((k, j) => (
                  <kbd key={j} className="rounded border border-surface-300 bg-surface-100 px-2 py-0.5 font-mono text-xs text-surface-700 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-300">
                    {k}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </div>
      </FocusTrap>
    </div>
  );
}
