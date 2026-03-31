import { createContext, useContext, useState } from 'react';

interface Settings {
  showImagesInline: boolean;
  bubbleView: boolean;
  ownBubbleColor: string;
  otherBubbleColor: string;
  homeView: 'info' | 'cards';
  fileBrowserViewMode: 'grid' | 'list';
  fileBrowserTab: 'context' | 'personal';
  notificationsEnabled: boolean;
}

interface SettingsContextValue extends Settings {
  setShowImagesInline: (v: boolean) => void;
  setBubbleView: (v: boolean) => void;
  setOwnBubbleColor: (v: string) => void;
  setOtherBubbleColor: (v: string) => void;
  setHomeView: (v: 'info' | 'cards') => void;
  setFileBrowserViewMode: (v: 'grid' | 'list') => void;
  setFileBrowserTab: (v: 'context' | 'personal') => void;
  setNotificationsEnabled: (v: boolean) => void;
}

const STORAGE_KEY = 'schulchat_settings';

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return {
      showImagesInline: true,
      bubbleView: true,
      ownBubbleColor: '#4f46e5',
      otherBubbleColor: '#f3f4f6',
      homeView: 'info',
      fileBrowserViewMode: 'grid',
      fileBrowserTab: 'context',
      notificationsEnabled: true,
      ...JSON.parse(raw) as Partial<Settings>
    };
  } catch { /* ignore */ }
  return {
    showImagesInline: true,
    bubbleView: true,
    ownBubbleColor: '#4f46e5',
    otherBubbleColor: '#f3f4f6',
    homeView: 'info',
    fileBrowserViewMode: 'grid',
    fileBrowserTab: 'context',
    notificationsEnabled: true,
  };
}

const SettingsContext = createContext<SettingsContextValue>({
  showImagesInline: true,
  bubbleView: true,
  ownBubbleColor: '#4f46e5',
  otherBubbleColor: '#f3f4f6',
  homeView: 'info',
  fileBrowserViewMode: 'grid',
  fileBrowserTab: 'context',
  notificationsEnabled: true,
  setShowImagesInline: () => {},
  setBubbleView: () => {},
  setOwnBubbleColor: () => {},
  setOtherBubbleColor: () => {},
  setHomeView: () => {},
  setFileBrowserViewMode: () => {},
  setFileBrowserTab: () => {},
  setNotificationsEnabled: () => {},
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
      setOwnBubbleColor: (v) => update({ ownBubbleColor: v }),
      setOtherBubbleColor: (v) => update({ otherBubbleColor: v }),
      setHomeView: (v) => update({ homeView: v }),
      setFileBrowserViewMode: (v) => update({ fileBrowserViewMode: v }),
      setFileBrowserTab: (v) => update({ fileBrowserTab: v }),
      setNotificationsEnabled: (v) => update({ notificationsEnabled: v }),
    }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  return useContext(SettingsContext);
}
