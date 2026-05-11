import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type ActiveView = 'chat' | 'calendar' | 'polls';

interface PanelState {
  settings: boolean;
  fileBrowser: boolean;
  fileBrowserStandalone: boolean;
  broadcasts: boolean;
  notifications: boolean;
  profile: boolean;
  flagged: boolean;
}

const INITIAL_STATE: PanelState = {
  settings: false,
  fileBrowser: false,
  fileBrowserStandalone: false,
  broadcasts: false,
  notifications: false,
  profile: false,
  flagged: false,
};

export interface PanelContextValue extends PanelState {
  activeView: ActiveView;
  pollIdToOpen: string | null;
  eventIdToOpen: string | null;

  closeAllPanels: () => void;
  toggleSettings: () => void;
  closeSettings: () => void;
  toggleFileBrowser: () => void;
  openFileBrowserStandalone: () => void;
  closeFileBrowser: () => void;
  toggleBroadcasts: () => void;
  closeBroadcasts: () => void;
  toggleNotifications: () => void;
  closeNotifications: () => void;
  toggleProfile: () => void;
  closeProfile: () => void;
  toggleFlagged: () => void;
  closeFlagged: () => void;
  openCalendar: () => void;
  openPolls: () => void;
  openPoll: (pollId: string) => void;
  openEvent: (eventId: string) => void;
  goToChat: () => void;
  clearPollIdToOpen: () => void;
  clearEventIdToOpen: () => void;
}

const PanelContext = createContext<PanelContextValue | null>(null);

export function usePanels(): PanelContextValue {
  const ctx = useContext(PanelContext);
  if (!ctx) throw new Error('usePanels must be used within a PanelProvider');
  return ctx;
}

/**
 * Centralizes the mutually-exclusive side-panel state (settings, file browser,
 * broadcasts, notifications, profile, flagged messages) plus the top-level
 * view switch between chat / calendar / polls. Opening any panel first closes
 * the others; opening a non-chat view also closes panels.
 */
export function PanelProvider({ children }: { children: ReactNode }) {
  const [panels, setPanels] = useState<PanelState>(INITIAL_STATE);
  const [activeView, setActiveView] = useState<ActiveView>('chat');
  const [pollIdToOpen, setPollIdToOpen] = useState<string | null>(null);
  const [eventIdToOpen, setEventIdToOpen] = useState<string | null>(null);

  const closeAllPanels = useCallback(() => {
    setPanels(INITIAL_STATE);
  }, []);

  // Generic toggle: closes all others, then opens the named panel if it wasn't.
  const toggle = useCallback((key: keyof PanelState) => {
    setPanels((prev) => {
      const wasOpen = prev[key];
      if (wasOpen) return INITIAL_STATE;
      return { ...INITIAL_STATE, [key]: true };
    });
  }, []);

  const close = useCallback((key: keyof PanelState) => {
    setPanels((prev) => (prev[key] ? { ...prev, [key]: false } : prev));
  }, []);

  const toggleSettings = useCallback(() => toggle('settings'), [toggle]);
  const closeSettings = useCallback(() => close('settings'), [close]);

  const toggleFileBrowser = useCallback(() => {
    setPanels((prev) => {
      const wasOpen = prev.fileBrowser && !prev.fileBrowserStandalone;
      if (wasOpen) return INITIAL_STATE;
      return { ...INITIAL_STATE, fileBrowser: true, fileBrowserStandalone: false };
    });
  }, []);

  const openFileBrowserStandalone = useCallback(() => {
    setPanels((prev) => {
      const wasOpen = prev.fileBrowser && prev.fileBrowserStandalone;
      if (wasOpen) return INITIAL_STATE;
      return { ...INITIAL_STATE, fileBrowser: true, fileBrowserStandalone: true };
    });
    setActiveView('chat');
  }, []);

  const closeFileBrowser = useCallback(() => {
    setPanels((prev) => ({ ...prev, fileBrowser: false, fileBrowserStandalone: false }));
  }, []);

  const toggleBroadcasts = useCallback(() => {
    setActiveView('chat');
    toggle('broadcasts');
  }, [toggle]);
  const closeBroadcasts = useCallback(() => close('broadcasts'), [close]);

  const toggleNotifications = useCallback(() => toggle('notifications'), [toggle]);
  const closeNotifications = useCallback(() => close('notifications'), [close]);

  const toggleProfile = useCallback(() => toggle('profile'), [toggle]);
  const closeProfile = useCallback(() => close('profile'), [close]);

  const toggleFlagged = useCallback(() => toggle('flagged'), [toggle]);
  const closeFlagged = useCallback(() => close('flagged'), [close]);

  const openCalendar = useCallback(() => {
    closeAllPanels();
    setEventIdToOpen(null);
    setActiveView((v) => (v === 'calendar' ? 'chat' : 'calendar'));
  }, [closeAllPanels]);

  const openPolls = useCallback(() => {
    closeAllPanels();
    setPollIdToOpen(null);
    setActiveView((v) => (v === 'polls' ? 'chat' : 'polls'));
  }, [closeAllPanels]);

  const openPoll = useCallback((pollId: string) => {
    closeAllPanels();
    setPollIdToOpen(pollId);
    setActiveView('polls');
  }, [closeAllPanels]);

  const openEvent = useCallback((eventId: string) => {
    closeAllPanels();
    setEventIdToOpen(eventId);
    setActiveView('calendar');
  }, [closeAllPanels]);

  const goToChat = useCallback(() => {
    closeAllPanels();
    setActiveView('chat');
  }, [closeAllPanels]);

  const clearPollIdToOpen = useCallback(() => setPollIdToOpen(null), []);
  const clearEventIdToOpen = useCallback(() => setEventIdToOpen(null), []);

  const value = useMemo<PanelContextValue>(() => ({
    settings: panels.settings,
    fileBrowser: panels.fileBrowser,
    fileBrowserStandalone: panels.fileBrowserStandalone,
    broadcasts: panels.broadcasts,
    notifications: panels.notifications,
    profile: panels.profile,
    flagged: panels.flagged,
    activeView,
    pollIdToOpen,
    eventIdToOpen,
    closeAllPanels,
    toggleSettings, closeSettings,
    toggleFileBrowser, openFileBrowserStandalone, closeFileBrowser,
    toggleBroadcasts, closeBroadcasts,
    toggleNotifications, closeNotifications,
    toggleProfile, closeProfile,
    toggleFlagged, closeFlagged,
    openCalendar, openPolls, openPoll, openEvent,
    goToChat,
    clearPollIdToOpen, clearEventIdToOpen,
  }), [
    panels, activeView, pollIdToOpen, eventIdToOpen, closeAllPanels,
    toggleSettings, closeSettings,
    toggleFileBrowser, openFileBrowserStandalone, closeFileBrowser,
    toggleBroadcasts, closeBroadcasts,
    toggleNotifications, closeNotifications,
    toggleProfile, closeProfile,
    toggleFlagged, closeFlagged,
    openCalendar, openPolls, openPoll, openEvent,
    goToChat, clearPollIdToOpen, clearEventIdToOpen,
  ]);

  return <PanelContext.Provider value={value}>{children}</PanelContext.Provider>;
}
