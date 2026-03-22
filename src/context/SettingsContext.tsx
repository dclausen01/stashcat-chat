import { createContext, useContext, useState } from 'react';

interface Settings {
  showImagesInline: boolean;
  bubbleView: boolean;
}

interface SettingsContextValue extends Settings {
  setShowImagesInline: (v: boolean) => void;
  setBubbleView: (v: boolean) => void;
}

const STORAGE_KEY = 'schulchat_settings';

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { showImagesInline: true, bubbleView: true, ...JSON.parse(raw) as Partial<Settings> };
  } catch { /* ignore */ }
  return { showImagesInline: true, bubbleView: true };
}

const SettingsContext = createContext<SettingsContextValue>({
  showImagesInline: true,
  bubbleView: true,
  setShowImagesInline: () => {},
  setBubbleView: () => {},
});

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(loadSettings);

  function update(patch: Partial<Settings>) {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  return (
    <SettingsContext.Provider value={{
      ...settings,
      setShowImagesInline: (v) => update({ showImagesInline: v }),
      setBubbleView: (v) => update({ bubbleView: v }),
    }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  return useContext(SettingsContext);
}
