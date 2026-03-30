import { X } from 'lucide-react';
import { useSettings } from '../context/SettingsContext';

interface SettingsPanelProps {
  onClose: () => void;
}

function ToggleRow({
  label,
  description,
  value,
  onChange,
}: {
  label: string;
  description?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <div className="flex-1">
        <div className="text-sm font-medium text-surface-900 dark:text-surface-100">{label}</div>
        {description && <div className="mt-0.5 text-xs text-surface-600">{description}</div>}
      </div>
      <button
        role="switch"
        aria-checked={value}
        onClick={() => onChange(!value)}
        className={`relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors ${
          value ? 'bg-primary-600' : 'bg-surface-300 dark:bg-surface-600'
        }`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${
            value ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </button>
    </label>
  );
}

function ColorRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-3">
      <div className="flex-1">
        <div className="text-sm font-medium text-surface-900 dark:text-surface-100">{label}</div>
      </div>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-8 cursor-pointer rounded border border-surface-300 dark:border-surface-600"
      />
    </label>
  );
}

export default function SettingsPanel({ onClose }: SettingsPanelProps) {
  const {
    showImagesInline,
    setShowImagesInline,
    bubbleView,
    setBubbleView,
    ownBubbleColor,
    setOwnBubbleColor,
    otherBubbleColor,
    setOtherBubbleColor,
    homeView,
    setHomeView,
  } = useSettings();

  return (
    <div className="flex h-full w-64 shrink-0 flex-col border-l border-surface-200 bg-surface-50 dark:border-surface-700 dark:bg-surface-900">
      <div className="flex shrink-0 items-center justify-between border-b border-surface-200 px-4 py-3 dark:border-surface-700">
        <h3 className="text-sm font-semibold text-surface-900 dark:text-white">Einstellungen</h3>
        <button
          onClick={onClose}
          className="rounded-md p-1 text-surface-600 hover:bg-surface-200 dark:hover:bg-surface-700"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex flex-col gap-1 overflow-y-auto p-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-surface-600">Homescreen</p>

        <div className="rounded-lg bg-white p-3 shadow-sm dark:bg-surface-800">
          <ToggleRow
            label="Cards-Ansicht"
            description="Favorisierte Channel als Kacheln anzeigen"
            value={homeView === 'cards'}
            onChange={(v) => setHomeView(v ? 'cards' : 'info')}
          />
        </div>

        <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wider text-surface-600">Anzeige</p>

        <div className="rounded-lg bg-white p-3 shadow-sm dark:bg-surface-800">
          <ToggleRow
            label="Bilder inline anzeigen"
            description="Bilder direkt in der Chat-Bubble anzeigen"
            value={showImagesInline}
            onChange={setShowImagesInline}
          />
        </div>

        <div className="mt-1 rounded-lg bg-white p-3 shadow-sm dark:bg-surface-800">
          <ToggleRow
            label="Chat-Bubble-Ansicht"
            description="Nachrichten als farbige Sprechblasen"
            value={bubbleView}
            onChange={setBubbleView}
          />
        </div>

        <p className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wider text-surface-600">Farben</p>

        <div className="rounded-lg bg-white p-3 shadow-sm dark:bg-surface-800">
          <ColorRow
            label="Eigene Nachrichten"
            value={ownBubbleColor}
            onChange={setOwnBubbleColor}
          />
        </div>

        <div className="mt-1 rounded-lg bg-white p-3 shadow-sm dark:bg-surface-800">
          <ColorRow
            label="Andere Nachrichten"
            value={otherBubbleColor}
            onChange={setOtherBubbleColor}
          />
        </div>
      </div>
    </div>
  );
}
