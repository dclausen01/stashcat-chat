import { createContext, useContext, useState, useEffect } from 'react';

interface Settings {
  showImagesInline: boolean;
  bubbleView: boolean;
  ownBubbleColor: string;
  otherBubbleColor: string;
  homeView: 'info' | 'cards';
  fileBrowserViewMode: 'grid' | 'list';
  fileBrowserTab: 'context' | 'personal' | 'nextcloud';
  notificationsEnabled: boolean;
  autoAcceptKeySync: boolean;
  enterSendsMessage: boolean;
  favoriteCardsSortMode: 'sidebar' | 'alphabetical' | 'manual';
  thickScrollbars: boolean;
}

interface SettingsContextValue extends Settings {
  setShowImagesInline: (v: boolean) => void;
  setBubbleView: (v: boolean) => void;
  setOwnBubbleColor: (v: string) => void;
  setOtherBubbleColor: (v: string) => void;
  setHomeView: (v: 'info' | 'cards') => void;
  setFileBrowserViewMode: (v: 'grid' | 'list') => void;
  setFileBrowserTab: (v: 'context' | 'personal' | 'nextcloud') => void;
  setNotificationsEnabled: (v: boolean) => void;
  setAutoAcceptKeySync: (v: boolean) => void;
  setEnterSendsMessage: (v: boolean) => void;
  setFavoriteCardsSortMode: (v: 'sidebar' | 'alphabetical' | 'manual') => void;
  setThickScrollbars: (v: boolean) => void;
}

const STORAGE_KEY = 'schulchat_settings';

function loadSettings(): Settings {
  const defaults: Settings = {
    showImagesInline: true,
    bubbleView: true,
    ownBubbleColor: '#4f46e5',
    otherBubbleColor: '#f3f4f6',
    homeView: 'info',
    fileBrowserViewMode: 'grid',
    fileBrowserTab: 'context',
    notificationsEnabled: true,
    autoAcceptKeySync: false,
    enterSendsMessage: true,
    favoriteCardsSortMode: 'sidebar',
    thickScrollbars: false,
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Settings>;
      return {
        ...defaults,
        ...parsed,
        favoriteCardsSortMode: parsed.favoriteCardsSortMode ?? defaults.favoriteCardsSortMode,
      };
    }
  } catch { /* ignore */ }
  return defaults;
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
  autoAcceptKeySync: false,
  enterSendsMessage: true,
  favoriteCardsSortMode: 'sidebar',
  thickScrollbars: false,
  setShowImagesInline: () => {},
  setBubbleView: () => {},
  setOwnBubbleColor: () => {},
  setOtherBubbleColor: () => {},
  setHomeView: () => {},
  setFileBrowserViewMode: () => {},
  setFileBrowserTab: () => {},
  setNotificationsEnabled: () => {},
  setAutoAcceptKeySync: () => {},
  setEnterSendsMessage: () => {},
  setFavoriteCardsSortMode: () => {},
  setThickScrollbars: () => {},
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

  // Apply the thick-scrollbar class on <html> so CSS can target it globally
  useEffect(() => {
    document.documentElement.classList.toggle('scrollbars-thick', settings.thickScrollbars);
  }, [settings.thickScrollbars]);

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
      setAutoAcceptKeySync: (v) => update({ autoAcceptKeySync: v }),
      setEnterSendsMessage: (v) => update({ enterSendsMessage: v }),
      setFavoriteCardsSortMode: (v) => update({ favoriteCardsSortMode: v }),
      setThickScrollbars: (v) => update({ thickScrollbars: v }),
    }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  return useContext(SettingsContext);
}
