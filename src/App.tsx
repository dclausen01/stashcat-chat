import { useState, useCallback, useRef, useMemo, useEffect } from 'react';
import { useAuth } from './context/AuthContext';
import { useSettings } from './context/SettingsContext';
import { usePanels } from './context/PanelContext';
import { useCallManager } from './hooks/useCallManager';
import { useLayoutMode } from './hooks/useLayoutMode';
import { useHotkeys } from './hooks/useHotkeys';
import LoginPage from './pages/LoginPage';
import Sidebar from './components/Sidebar';
import TopBar from './components/TopBar';
import ChatView from './components/ChatView';
import EmptyState from './components/EmptyState';
import SettingsPanel from './components/SettingsPanel';
import FileBrowserPanel from './components/FileBrowserPanel';
import BroadcastsPanel from './components/BroadcastsPanel';
import CalendarView from './components/CalendarView';
import PollsView from './components/PollsView';
import NotificationsPanel from './components/NotificationsPanel';
import FavoriteCardsView from './components/FavoriteCardsView';
import ProfileModal from './components/ProfileModal';
import FlaggedMessagesPanel from './components/FlaggedMessagesPanel';
import CallModal from './components/CallModal';
import QuickSwitcher from './components/QuickSwitcher';
import ShortcutsModal from './components/ShortcutsModal';
import ConnectionBanner from './components/ConnectionBanner';
import { useConnectionState } from './hooks/useConnectionState';
import { on, BridgeEvents } from './lib/bridgeBus';
import { type Deeplink, pushBackHandler, bridge } from './lib/flutterBridge';
import type { ChatTarget } from './types';
import type { CallParty } from './api/calls';

export default function App() {
  const { loggedIn } = useAuth();
  const { homeView } = useSettings();
  const {
    settings: settingsOpen,
    fileBrowser: fileBrowserOpen,
    fileBrowserStandalone,
    broadcasts: broadcastsOpen,
    notifications: notificationsOpen,
    profile: profileOpen,
    flagged: flaggedOpen,
    activeView,
    pollIdToOpen,
    eventIdToOpen,
    closeAllPanels,
    toggleSettings,
    closeSettings,
    closeFileBrowser,
    toggleBroadcasts,
    closeBroadcasts,
    closeNotifications,
    closeProfile,
    closeFlagged,
    openCalendar,
    openPolls,
    openPoll,
    openEvent,
    goToChat,
    clearPollIdToOpen,
    clearEventIdToOpen,
  } = usePanels();
  const { activeCall, startCall, acceptCall, rejectCall, hangUp, isMuted, toggleMute } = useCallManager(loggedIn);
  const connectionStatus = useConnectionState(loggedIn);
  const layoutMode = useLayoutMode();
  const isMobilePhone = layoutMode === 'mobile';
  const isPortraitTablet = layoutMode === 'tablet';
  const [activeChat, setActiveChat] = useState<ChatTarget | null>(null);
  const [topBarUnread, setTopBarUnread] = useState({ total: 0, channels: [] as ChatTarget[], conversations: [] as ChatTarget[] });
  const [channels, setChannels] = useState<ChatTarget[]>([]);
  const [conversations, setConversations] = useState<ChatTarget[]>([]);
  const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [jumpToMessageId, setJumpToMessageId] = useState<string | null>(null);
  const [jumpToMessageTime, setJumpToMessageTime] = useState<number | null>(null);
  const [jumpKey, setJumpKey] = useState(0);
  const [focusSearchKey, setFocusSearchKey] = useState(0);
  const [jumpSearching, setJumpSearching] = useState(false);
  const refreshSidebarRef = useRef<(() => void) | null>(null);
  const toggleFavoriteRef = useRef<((target: ChatTarget) => void) | null>(null);

  const handleSelectChat = useCallback((chat: ChatTarget) => {
    goToChat();
    setActiveChat(chat);
  }, [goToChat]);

  const handleToggleFavoriteFromChatView = useCallback((chat: ChatTarget) => {
    setActiveChat((prev) => prev?.id === chat.id ? { ...prev, favorite: !prev.favorite } : prev);
    toggleFavoriteRef.current?.(chat);
  }, []);

  const handleChannelImageUpdated = useCallback((channelId: string, imageUrl: string) => {
    setChannels((prev) => prev.map((ch) => ch.id === channelId ? { ...ch, image: imageUrl } : ch));
    setActiveChat((prev) => prev?.id === channelId ? { ...prev, image: imageUrl } : prev);
  }, []);

  const handleGoHome = useCallback(() => {
    goToChat();
    setActiveChat(null);
  }, [goToChat]);

  const handleChannelsLoaded = useCallback((loadedChannels: ChatTarget[]) => {
    setChannels(loadedChannels);
  }, []);

  const handleConversationsLoaded = useCallback((loadedConversations: ChatTarget[]) => {
    setConversations(loadedConversations);
  }, []);

  const handleFlaggedMessageClick = useCallback((messageId: string, chat: ChatTarget, messageTime?: number) => {
    if (activeChat?.id !== chat.id || activeChat?.type !== chat.type) {
      setActiveChat(chat);
    }
    setJumpToMessageId(messageId);
    setJumpToMessageTime(messageTime ?? null);
    setJumpSearching(true);
    setJumpKey((k) => k + 1);
  }, [activeChat]);

  const handleJumpComplete = useCallback(() => {
    setJumpToMessageId(null);
    setJumpToMessageTime(null);
    setJumpSearching(false);
  }, []);

  // Flutter shell deeplinks (e.g. tapping a push notification).
  //
  // Wichtig: Wenn der User per Push-Tap aus dem Killed-State kommt, kann das
  // `navigate`-Event BEVOR die Sidebar-Daten geladen sind. `channels.find(...)`
  // würde dann undefined liefern und der Chat bliebe ungeöffnet (sichtbarer
  // Bug: User landet auf der Sidebar-Home-Ansicht). Wir merken uns deshalb
  // einen Deeplink, der gerade nicht aufgelöst werden kann, und versuchen
  // ihn erneut sobald die passende Liste geladen ist.
  const [pendingDeeplink, setPendingDeeplink] = useState<Deeplink | null>(null);

  const tryResolveDeeplink = useCallback((link: Deeplink): boolean => {
    if (!link) return true;
    if (link.kind === 'channel') {
      const ch = channels.find((c) => c.id === link.id);
      if (!ch) return false;
      handleSelectChat(ch);
      return true;
    }
    if (link.kind === 'conversation') {
      const cv = conversations.find((c) => c.id === link.id);
      if (!cv) return false;
      handleSelectChat(cv);
      return true;
    }
    if (link.kind === 'view') {
      if (link.view === 'calendar') openCalendar();
      else if (link.view === 'polls') openPolls();
      else if (link.view === 'chat') goToChat();
      return true;
    }
    return true; // 'unknown' → nichts zu tun, aber auch nichts zu warten
  }, [channels, conversations, handleSelectChat, openCalendar, openPolls, goToChat]);

  useEffect(() => {
    if (!loggedIn) return;
    return on<Deeplink>(BridgeEvents.navigate, (link) => {
      if (!link) return;
      const resolved = tryResolveDeeplink(link);
      if (!resolved) {
        // Daten noch nicht da — speichern und beim nächsten channels/
        // conversations-Update erneut versuchen.
        setPendingDeeplink(link);
      }
    });
  }, [loggedIn, tryResolveDeeplink]);

  // Sobald channels/conversations geladen sind, einen wartenden Deeplink
  // einlösen. Wird durch tryResolveDeeplink-Identität (deps oben) bei jedem
  // Listen-Update neu evaluiert.
  useEffect(() => {
    if (!pendingDeeplink) return;
    if (tryResolveDeeplink(pendingDeeplink)) setPendingDeeplink(null);
  }, [pendingDeeplink, tryResolveDeeplink]);

  // App-Level Back-Handler — wird vom Flutter-PopScope-Handler über
  // window.bbzChat.handleBack() aufgerufen. Bottom-Sheets/Modals registrieren
  // ihren eigenen Handler weiter oben im Stack (LIFO), wir sind der Fallback.
  useEffect(() => {
    if (!loggedIn) return;
    return pushBackHandler(() => {
      // Reihenfolge spiegelt visuelle "Tiefe": Profil > sonstige Panels >
      // Sonderansichten (Kalender/Polls) > offener Chat > Root.
      if (profileOpen) { closeProfile(); return true; }
      if (settingsOpen) { closeSettings(); return true; }
      if (fileBrowserOpen) { closeFileBrowser(); return true; }
      if (broadcastsOpen) { closeBroadcasts(); return true; }
      if (notificationsOpen) { closeNotifications(); return true; }
      if (flaggedOpen) { closeFlagged(); return true; }
      if (activeView !== 'chat') { goToChat(); return true; }
      if (activeChat) { setActiveChat(null); return true; }
      return false; // Root — Mobile-Shell soll die App in den Hintergrund schicken
    });
  }, [
    loggedIn, profileOpen, settingsOpen, fileBrowserOpen, broadcastsOpen,
    notificationsOpen, flaggedOpen, activeView, activeChat,
    closeProfile, closeSettings, closeFileBrowser, closeBroadcasts,
    closeNotifications, closeFlagged, goToChat,
  ]);

  // notifyRouteChange: Mobile-Shell weiß so jederzeit, "wo wir sind".
  // Pfad-Schema spiegelt die parseDeeplink-Konvention.
  useEffect(() => {
    if (!loggedIn) return;
    let path = '/';
    if (activeView === 'calendar') path = '/calendar';
    else if (activeView === 'polls') path = '/polls';
    else if (activeChat?.type === 'channel') path = `/c/${activeChat.id}`;
    else if (activeChat?.type === 'conversation') path = `/d/${activeChat.id}`;
    bridge.notifyRouteChange(path);
  }, [loggedIn, activeView, activeChat]);

  // Keyboard shortcuts (only when logged in). Hotkeys *always* open the target
  // panel; the matching toolbar buttons toggle. Preserved from before the
  // PanelContext refactor.
  const hotkeys = useMemo(() => loggedIn ? [
    { key: 'k', mod: true, handler: (e: KeyboardEvent) => { e.preventDefault(); setQuickSwitcherOpen(true); } },
    { key: '.', mod: true, handler: (e: KeyboardEvent) => { e.preventDefault(); if (!settingsOpen) toggleSettings(); } },
    { key: 'c', alt: true, handler: (e: KeyboardEvent) => { e.preventDefault(); if (activeView !== 'calendar') openCalendar(); } },
    { key: 'b', alt: true, handler: (e: KeyboardEvent) => { e.preventDefault(); if (!broadcastsOpen) toggleBroadcasts(); } },
    { key: 'u', alt: true, handler: (e: KeyboardEvent) => { e.preventDefault(); if (activeView !== 'polls') openPolls(); } },
    { key: '?', shift: true, handler: (e: KeyboardEvent) => { e.preventDefault(); setShortcutsOpen(true); } },
  ] : [], [loggedIn, settingsOpen, broadcastsOpen, activeView, toggleSettings, openCalendar, toggleBroadcasts, openPolls]);
  useHotkeys(hotkeys, loggedIn);

  // Sidebar search focus + global Esc — capture phase so Tiptap/ProseMirror
  // can't swallow the events before us. INPUT/TEXTAREA are still respected,
  // but contenteditable (chat editor) is intentionally bypassed so `/` works.
  useEffect(() => {
    document.documentElement.classList.toggle('tablet-portrait', isPortraitTablet);
  }, [isPortraitTablet]);

  const anyPanelOpenRef = useRef(false);
  anyPanelOpenRef.current = settingsOpen || fileBrowserOpen || broadcastsOpen || notificationsOpen || profileOpen || flaggedOpen;
  useEffect(() => {
    if (!loggedIn) return;
    const isInRealInput = () => {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    };
    const handler = (e: KeyboardEvent) => {
      // / → focus sidebar search (also from chat editor)
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
        if (isInRealInput()) return;
        e.preventDefault();
        e.stopPropagation();
        setFocusSearchKey((k) => k + 1);
        return;
      }
      // Alt/Option+F → focus sidebar search (Option+F → 'ƒ' on macOS, use e.code fallback)
      if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey &&
          (e.key.toLowerCase() === 'f' || e.code === 'KeyF')) {
        e.preventDefault();
        e.stopPropagation();
        setFocusSearchKey((k) => k + 1);
        return;
      }
      // Esc → close any open panel
      if (e.key === 'Escape') {
        if (anyPanelOpenRef.current) closeAllPanels();
      }
    };
    document.addEventListener('keydown', handler, true); // capture phase
    return () => document.removeEventListener('keydown', handler, true);
  }, [loggedIn, closeAllPanels]);

  // On mobile: when nothing else is open, the Sidebar is the home screen (fullscreen).
  // When activeChat or any panel/view is open, the Sidebar is hidden and that takes over.
  // On desktop: Sidebar is always visible (md:flex).
  const nothingElseOpen =
    !activeChat && !settingsOpen && !fileBrowserOpen && !broadcastsOpen &&
    !notificationsOpen && !flaggedOpen && !profileOpen && activeView === 'chat';

  if (!loggedIn) {
    return <LoginPage />;
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* TopBar — Desktop only, full width over sidebar + main area */}
      <TopBar
        totalUnread={topBarUnread.total}
        unreadChannels={topBarUnread.channels}
        unreadConversations={topBarUnread.conversations}
        onSelectChat={handleSelectChat}
        onGoHome={handleGoHome}
      />

      {/* Bottom area: Sidebar + Main content (flex-row) */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar: fullscreen home on mobile when nothing else is open; always visible on desktop */}
        <div className={`shrink-0 ${isMobilePhone ? (nothingElseOpen ? 'flex w-full' : 'hidden') : 'flex'}`}>
          <Sidebar
            activeChat={activeChat}
            onSelectChat={handleSelectChat}
            loggedIn={loggedIn}
            triggerFocusKey={focusSearchKey}
            onChannelsLoaded={handleChannelsLoaded}
            onConversationsLoaded={handleConversationsLoaded}
            onRegisterRefresh={(fn) => { refreshSidebarRef.current = fn; }}
            onRegisterToggleFavorite={(fn) => { toggleFavoriteRef.current = fn; }}
            onGoHome={handleGoHome}
            onUnreadChange={(total, ch, cv) => setTopBarUnread({ total, channels: ch, conversations: cv })}
          />
        </div>

        {/* Main content — hidden on mobile when sidebar is fullscreen home */}
        <div className={`flex-1 overflow-hidden ${isMobilePhone && nothingElseOpen ? 'hidden' : 'flex'}`}>
          {activeView === 'calendar' ? (
            <CalendarView eventIdToOpen={eventIdToOpen} onEventOpened={clearEventIdToOpen} onClose={goToChat} />
          ) : activeView === 'polls' ? (
            <PollsView pollIdToOpen={pollIdToOpen} onPollOpened={clearPollIdToOpen} onClose={goToChat} />
          ) : fileBrowserStandalone && fileBrowserOpen ? (
            // Standalone FileBrowser — full main area
            <FileBrowserPanel
              chat={null}
              onClose={closeFileBrowser}
              fullscreen
            />
          ) : (
            <>
              {activeChat
                ? <ChatView
                    chat={activeChat}
                    onGoHome={handleGoHome}
                    jumpToMessageId={jumpToMessageId}
                    jumpToMessageTime={jumpToMessageTime}
                    jumpKey={jumpKey}
                    onJumpComplete={handleJumpComplete}
                    onStartCall={(calleeId: string, targetId: string, callee: CallParty) =>
                      startCall(calleeId, targetId, callee)
                    }
                    onToggleFavorite={handleToggleFavoriteFromChatView}
                    onChannelImageUpdated={handleChannelImageUpdated}
                    channels={channels}
                  />
                : homeView === 'cards'
                  // FavoriteCardsView is hidden on mobile phones — Sidebar is the mobile home screen.
                  ? <div className={`flex-1 ${isMobilePhone ? 'hidden' : 'flex'}`}><FavoriteCardsView channels={channels} conversations={conversations} onSelectChat={handleSelectChat} /></div>
                  : <div className={`flex-1 ${isMobilePhone ? 'hidden' : 'flex'}`}><EmptyState /></div>}
              {fileBrowserOpen && !fileBrowserStandalone && (
                <div className={isMobilePhone ? 'fixed inset-0 z-40 flex' : isPortraitTablet ? 'fixed right-0 inset-y-0 z-40 flex' : 'relative flex'}>
                  <FileBrowserPanel chat={activeChat} onClose={closeFileBrowser} />
                </div>
              )}
              {broadcastsOpen && (
                <div className={isMobilePhone ? 'fixed inset-0 z-40 flex' : isPortraitTablet ? 'fixed right-0 inset-y-0 z-40 flex' : 'relative flex'}>
                  <BroadcastsPanel onClose={closeBroadcasts} />
                </div>
              )}
              {flaggedOpen && (
                <div className={isMobilePhone ? 'fixed inset-0 z-40 flex' : isPortraitTablet ? 'fixed right-0 inset-y-0 z-40 flex' : 'relative flex'}>
                  <FlaggedMessagesPanel
                    chat={activeChat}
                    onClose={closeFlagged}
                    onMessageClick={handleFlaggedMessageClick}
                    jumpSearching={jumpSearching}
                  />
                </div>
              )}
              {notificationsOpen && (
                <div className={isMobilePhone ? 'fixed inset-0 z-40 flex' : isPortraitTablet ? 'fixed right-0 inset-y-0 z-40 flex' : 'relative flex'}>
                  <NotificationsPanel onClose={closeNotifications} onOpenPolls={openPolls} onOpenPoll={openPoll} onOpenCalendar={openCalendar} onOpenEvent={openEvent} onChannelJoined={() => refreshSidebarRef.current?.()} />
                </div>
              )}
            </>
          )}
          {settingsOpen && (
            <div className={isMobilePhone ? 'fixed inset-0 z-50 flex' : isPortraitTablet ? 'fixed right-0 inset-y-0 z-50 flex' : 'relative flex'}>
              <SettingsPanel onClose={closeSettings} />
            </div>
          )}
          {profileOpen && (
            <div className={`fixed inset-0 z-50 flex ${!isMobilePhone ? 'items-center justify-center bg-black/50' : ''}`}>
              <ProfileModal onClose={closeProfile} />
            </div>
          )}
        </div>
      </div>

      {/* Full-screen modals (outside layout flow) */}
      {activeCall && (
        <CallModal
          call={activeCall}
          onAccept={acceptCall}
          onReject={rejectCall}
          onHangUp={hangUp}
          isMuted={isMuted}
          onToggleMute={toggleMute}
        />
      )}
      {quickSwitcherOpen && (
        <QuickSwitcher
          channels={channels}
          conversations={conversations}
          onSelect={handleSelectChat}
          onClose={() => setQuickSwitcherOpen(false)}
        />
      )}
      {shortcutsOpen && (
        <ShortcutsModal onClose={() => setShortcutsOpen(false)} />
      )}
      <ConnectionBanner status={connectionStatus} />
    </div>
  );
}
