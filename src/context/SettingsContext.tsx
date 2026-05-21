import { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';

interface Settings {
  showImagesInline: boolean;
  bubbleView: boolean;
  ownBubbleColor: string;
  ownBubbleColorDark: string;
  otherBubbleColor: string;
  otherBubbleColorDark: string;
  homeView: 'info' | 'cards';
  fileBrowserViewMode: 'grid' | 'list';
  fileBrowserTab: 'context' | 'personal' | 'nextcloud';
  notificationsEnabled: boolean;
  autoAcceptKeySync: boolean;
  enterSendsMessage: boolean;
  favoriteCardsSortMode: 'sidebar' | 'alphabetical' | 'manual';
  thickScrollbars: boolean;
  spellcheckLang: 'off' | 'de' | 'en' | 'de,en';
}

interface SettingsContextValue extends Settings {
  setShowImagesInline: (v: boolean) => void;
  setBubbleView: (v: boolean) => void;
  setOwnBubbleColor: (v: string) => void;
  setOwnBubbleColorDark: (v: string) => void;
  setOtherBubbleColor: (v: string) => void;
  setOtherBubbleColorDark: (v: string) => void;
  setHomeView: (v: 'info' | 'cards') => void;
  setFileBrowserViewMode: (v: 'grid' | 'list') => void;
  setFileBrowserTab: (v: 'context' | 'personal' | 'nextcloud') => void;
  setNotificationsEnabled: (v: boolean) => void;
  setAutoAcceptKeySync: (v: boolean) => void;
  setEnterSendsMessage: (v: boolean) => void;
  setFavoriteCardsSortMode: (v: 'sidebar' | 'alphabetical' | 'manual') => void;
  setThickScrollbars: (v: boolean) => void;
  setSpellcheckLang: (v: 'off' | 'de' | 'en' | 'de,en') => void;
}

const STORAGE_KEY = 'schulchat_settings';

function loadSettings(): Settings {
  const defaults: Settings = {
    showImagesInline: true,
    bubbleView: true,
    ownBubbleColor: '#4f46e5',
    ownBubbleColorDark: '#0e3281',
    otherBubbleColor: '#f3f4f6',
    otherBubbleColorDark: '#1e293b',
    homeView: 'cards',
    fileBrowserViewMode: 'grid',
    fileBrowserTab: 'context',
    notificationsEnabled: true,
    autoAcceptKeySync: false,
    enterSendsMessage: true,
    favoriteCardsSortMode: 'sidebar',
    thickScrollbars: false,
    spellcheckLang: 'de',
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Settings>;
      // Migrate old defaults of otherBubbleColorDark to the current default
      // so users still on a former auto-default see the new one.
      const OLD_DARK_OTHER_DEFAULTS = new Set(['#374151', '#3730a3', '#92dcda', '#0d9488']);
      const migratedDarkOtherBubble = parsed.otherBubbleColorDark && OLD_DARK_OTHER_DEFAULTS.has(parsed.otherBubbleColorDark.toLowerCase())
        ? defaults.otherBubbleColorDark
        : (parsed.otherBubbleColorDark ?? defaults.otherBubbleColorDark);
      return {
        ...defaults,
        ...parsed,
        favoriteCardsSortMode: parsed.favoriteCardsSortMode ?? defaults.favoriteCardsSortMode,
        otherBubbleColorDark: migratedDarkOtherBubble,
        ownBubbleColorDark: parsed.ownBubbleColorDark ?? defaults.ownBubbleColorDark,
      };
    }
  } catch { /* ignore */ }
  return defaults;
}

const SettingsContext = createContext<SettingsContextValue>({
  showImagesInline: true,
  bubbleView: true,
  ownBubbleColor: '#4f46e5',
  ownBubbleColorDark: '#0e3281',
  otherBubbleColor: '#f3f4f6',
  otherBubbleColorDark: '#1e293b',
  homeView: 'cards',
  fileBrowserViewMode: 'grid',
  fileBrowserTab: 'context',
  notificationsEnabled: true,
  autoAcceptKeySync: false,
  enterSendsMessage: true,
  favoriteCardsSortMode: 'sidebar',
  thickScrollbars: false,
  spellcheckLang: 'de',
  setShowImagesInline: () => {},
  setBubbleView: () => {},
  setOwnBubbleColor: () => {},
  setOwnBubbleColorDark: () => {},
  setOtherBubbleColor: () => {},
  setOtherBubbleColorDark: () => {},
  setHomeView: () => {},
  setFileBrowserViewMode: () => {},
  setFileBrowserTab: () => {},
  setNotificationsEnabled: () => {},
  setAutoAcceptKeySync: () => {},
  setEnterSendsMessage: () => {},
  setFavoriteCardsSortMode: () => {},
  setThickScrollbars: () => {},
  setSpellcheckLang: () => {},
});

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(loadSettings);

  // localStorage-Persistenz aus dem setState-Updater rausziehen — Updater
  // koennen unter Strict-Mode doppelt feuern, was zu doppelten Writes fuehrte.
  // Jetzt: Setter berechnet `next` einmal, schreibt einmal und dispatcht
  // einmal.
  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch { /* quota / private mode — egal */ }
      return next;
    });
  }, []);

  // Stabile Setter-Referenzen, damit Consumer mit useEffect-Deps auf einzelne
  // Setter sich nicht unnoetig neu binden.
  const setters = useMemo(() => ({
    setShowImagesInline: (v: boolean) => update({ showImagesInline: v }),
    setBubbleView: (v: boolean) => update({ bubbleView: v }),
    setOwnBubbleColor: (v: string) => update({ ownBubbleColor: v }),
    setOwnBubbleColorDark: (v: string) => update({ ownBubbleColorDark: v }),
    setOtherBubbleColor: (v: string) => update({ otherBubbleColor: v }),
    setOtherBubbleColorDark: (v: string) => update({ otherBubbleColorDark: v }),
    setHomeView: (v: 'info' | 'cards') => update({ homeView: v }),
    setFileBrowserViewMode: (v: 'grid' | 'list') => update({ fileBrowserViewMode: v }),
    setFileBrowserTab: (v: 'context' | 'personal' | 'nextcloud') => update({ fileBrowserTab: v }),
    setNotificationsEnabled: (v: boolean) => update({ notificationsEnabled: v }),
    setAutoAcceptKeySync: (v: boolean) => update({ autoAcceptKeySync: v }),
    setEnterSendsMessage: (v: boolean) => update({ enterSendsMessage: v }),
    setFavoriteCardsSortMode: (v: 'sidebar' | 'alphabetical' | 'manual') => update({ favoriteCardsSortMode: v }),
    setThickScrollbars: (v: boolean) => update({ thickScrollbars: v }),
    setSpellcheckLang: (v: 'off' | 'de' | 'en' | 'de,en') => update({ spellcheckLang: v }),
  }), [update]);

  // Apply the thick-scrollbar class on <html> so CSS can target it globally
  useEffect(() => {
    document.documentElement.classList.toggle('scrollbars-thick', settings.thickScrollbars);
  }, [settings.thickScrollbars]);

  // Context-Value memoisieren — sonst rerendert *jeder* useSettings()-Consumer
  // auf jedem Parent-Render, weil das Object-Literal eine neue Identitaet hat.
  const value = useMemo(() => ({ ...settings, ...setters }), [settings, setters]);

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  return useContext(SettingsContext);
}
