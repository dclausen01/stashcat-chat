# Projektanalyse und Refactoring-Vorschläge

**Session ID:** ses_1e6bf9f83ffeTl2JXreHxD633z
**Created:** 5/12/2026, 12:55:09 AM
**Updated:** 5/12/2026, 12:59:23 AM

---

## User

Bitte analysiere mein Projekt und mache Vorschläge für sinnvolle refactoring Maßnahmen!

---

## Assistant (Build · DeepSeek V4 Flash Free · 123.1s)

_Thinking:_

Der Benutzer möchte, dass ich sein Projekt analysiere und Vorschläge für sinnvolle Refactoring-Maßnahmen mache. Lassen Sie mich zuerst das Projekt verstehen, indem ich die wichtigsten Dateien und die Struktur erkunde.

Ich sollte mich auf die Hauptbereiche konzentrieren:
1. src/ - Frontend (React)
2. server/ - Backend (Express)
3. Allgemeine Code-Qualität

Lass mich mit einer gründlichen Analyse beginnen.

**Tool: task**

**Input:**
```json
{
  "description": "Analyze frontend code issues",
  "subagent_type": "explore",
  "prompt": "Very thorough analysis of the frontend code in /Users/dennis/Projekte/stashcat-chat/src/. I need you to identify:\n\n1. **Large components** - Any component file over 300 lines. List them with line counts.\n2. **Code duplication** - Look for repeated patterns across files (same logic appearing in 3+ places).\n3. **Prop drilling** - Components that receive many props (7+) that are just passed through to children.\n4. **Import issues** - Barrel exports vs direct imports, unused exports.\n5. **State management** - How state flows, any anti-patterns (e.g., useState where useReducer would be better, too many useState calls in one component).\n6. **Type issues** - Any `any` types, missing interfaces, inconsistent type patterns.\n7. **Performance concerns** - Missing React.memo, useCallback, useMemo where appropriate.\n8. **File organization** - Files that seem too large or do too many things (Single Responsibility violations).\n9. **Dead code** - Suspicious code that appears unused.\n10. **Error handling** - Missing error boundaries, inconsistent error patterns.\n\nFor each finding, provide:\n- The exact file path and line number\n- A brief description of the issue\n- The severity (high/medium/low)\n- A concrete suggestion for improvement\n\nLook at ALL files in src/ - read the full content of any file that seems problematic. Return a comprehensive numbered list."
}
```

**Output:**
```
task_id: ses_1e6bf847cffe0k69xeygbtqhyL (for resuming to continue this task if needed)

<task_result>
Now I have thoroughly analyzed the entire codebase. Here is the comprehensive analysis:

---

# Comprehensive Frontend Code Analysis: `/Users/dennis/Projekte/stashcat-chat/src/`

## 1. LARGE COMPONENTS (Files over 300 lines)

| # | File | Lines | Severity | Issue |
|---|------|-------|----------|-------|
| 1 | `src/components/ChatView.tsx` | **3,574** | **HIGH** | By far the largest file. Contains the main chat view component (~1900 lines) plus 8 sub-components defined in the same file (`VideoMeetingCard`, `DateSeparator`, `PollInviteMessage`, `CalendarEventCard`, `SystemMessage`, `ReplyQuote`, `VoiceMessagePlayer`, `FileList`, `MessageBubble`, `LinkifiedText`, etc.). This is a massive Single Responsibility violation. |
| 2 | `src/components/FileBrowserPanel.tsx` | **1,806** | **HIGH** | Contains the main FileBrowser component plus inline sub-components (`QuotaBar`, `NCQuotaBar`). Manages file listing, uploads, rename, delete, navigation, Nextcloud integration, and tab switching. |
| 3 | `src/components/CalendarView.tsx` | **1,014** | **HIGH** | Calendar month/week view, event management, RSVP, channel source filtering. |
| 4 | `src/components/Sidebar.tsx` | **847** | **HIGH** | Channel tree rendering, conversation list, resize handles, search, create/join modals, realtime event handling. |
| 5 | `src/components/ChannelDropdownMenu.tsx` | **810** | **HIGH** | Contains `ChannelDropdownMenu`, `ChannelInfoModal`, `LeaveConfirmModal`, `DeleteConfirmModal`, `RenameChannelModal`, and `exportChatAsMarkdown` — 5 distinct components in one file. |
| 6 | `src/components/MessageInput.tsx` | **805** | **HIGH** | Tiptap editor integration, emoji picker, file upload, voice recording, formatting toolbar, slash commands, link dialog, drag-drop. |
| 7 | `src/components/BroadcastsPanel.tsx` | **796** | **MEDIUM** | Broadcast list, messages, members, create, rename, upload files. |
| 8 | `src/components/CreateEventModal.tsx` | **650** | **MEDIUM** | Event creation form with channel/user search, invite selection. |
| 9 | `src/components/NotificationsPanel.tsx` | **615** | **MEDIUM** | Notification list with 15+ notification type renderers, key sync, invite accept/decline. |
| 10 | `src/components/PollsView.tsx` | **548** | **MEDIUM** | Poll list, detail view, voting, voter dropdown with portal. |
| 11 | `src/components/ChannelMembersPanel.tsx` | **513** | **MEDIUM** | Member list, invite search, group invite, moderator management. |
| 12 | `src/components/NewChannelModal.tsx` | **466** | **MEDIUM** | Channel creation with image upload, member snapshot, subchannel support. |
| 13 | `src/hooks/useRealtimeEvents.ts` | **461** | **MEDIUM** | SSE singleton, multi-consumer handler registry, heartbeat watchdog, connection management. Complex but justified. |
| 14 | `src/components/CreateNCDocumentModal.tsx` | **433** | **MEDIUM** | Nextcloud document creation (docx/xlsx/pptx from templates). |
| 15 | `src/components/CreatePollModal.tsx` | **420** | **MEDIUM** | Poll creation form with channel/conversation targeting. |
| 16 | `src/components/FavoriteCardsView.tsx` | **404** | **MEDIUM** | Home view with favorite channel cards, manual reorder via drag-and-drop. |
| 17 | `src/App.tsx` | **403** | **MEDIUM** | Root component with panel orchestration, 17+ state variables, keyboard shortcuts. |
| 18 | `src/hooks/useCallManager.ts` | **381** | **MEDIUM** | WebRTC call management, ICE, TURN, signaling via SSE. |
| 19 | `src/components/SettingsPanel.tsx` | **365** | **MEDIUM** | Settings form with 15+ toggles, color pickers, view mode selection. |
| 20 | `src/components/ChatItem.tsx` | **360** | **MEDIUM** | Chat list item with menu, modals for info/leave/delete/archive. |
| 21 | `src/components/ShareToChatModal.tsx` | **306** | **LOW** | Modal for sharing files to chats. |

---

## 2. CODE DUPLICATION

### 2.1 Error handling inconsistency — `as unknown as` pattern (29 occurrences) — HIGH

The codebase uses `res as unknown as SomeType` in 29 places instead of proper typed API responses:

| File | Line | Example |
|------|------|---------|
| `src/api/messages.ts` | 14 | `getMessages()` returns `Array<Record<string, unknown>>` instead of `Message[]` |
| `src/components/ChatView.tsx` | 339, 398, 445, 587, 602, 613, 766, 914, 2880, 2891 | 10 occurrences of `res as unknown as Message[]` |
| `src/components/BroadcastsPanel.tsx` | 119, 144, 157, 187, 257, 265, 277, 325, 341 | 9 occurrences |
| `src/components/FileBrowserPanel.tsx` | 789-790 | `result.folder as unknown as FolderEntry[]` |
| `src/components/NotificationsPanel.tsx` | 267 | `items.map((n: any) => ...)` |
| `src/components/ChannelMembersPanel.tsx` | 103 | `result.users as unknown as RawUser[]` |
| `src/components/NewChatModal.tsx` | 47, 59 | `result.users as unknown as RawUser[]` |
| `src/components/FlaggedMessagesPanel.tsx` | 41 | `raw as unknown as Message[]` |
| `src/components/CreateEventModal.tsx` | 156, 160 | `result.users as unknown as RawUser[]` |
| `src/components/MessageInput.tsx` | 13 | `editor.storage as unknown as { markdown: ... }` |
| `src/pages/LoginPage.tsx` | 72 | `new Event('submit') as unknown as FormEvent` |

**Suggestion**: Make `api.getMessages()` return `Promise<Message[]>` with proper typing. Create generic typed API response interfaces.

### 2.2 File upload XHR pattern duplication (2 places) — MEDIUM

Both `src/api/messages.ts` (lines 142-166) and `src/api/files.ts` (lines 104-128) implement nearly identical XHR upload logic with FormData, progress tracking, error handling. Extract into a shared `uploadFileWithProgress()` helper in `core.ts`.

### 2.3 Notification content parsing duplication (NotificationsPanel.tsx) — MEDIUM

The `formatEventNotification()`, `formatPollNotification()`, and `formatDeviceNotification()` functions (lines 107-207) all follow the same pattern: guard clauses for null/type checking, property existence detection, then object extraction. This pattern repeats for key request parsing (`parseKeyRequestUser`, lines 89-104) and channel invite parsing (`parseChannelInviteNotification`, lines 66-86).

### 2.4 Repeated sender name formatting (5+ places) — MEDIUM

The pattern `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim() || 'Unbekannt' appears in:
- `ChatView.tsx` lines 958-960, 3072
- `ChannelMembersPanel.tsx` line 34
- `BroadcastsPanel.tsx` line 60
- `ShareToChatModal.tsx` (not inspected fully)

**Suggestion**: Add a `formatUserName(user)` utility function.

### 2.5 Repeated `err instanceof Error ? err.message : err` pattern (20+ places) — LOW

This pattern is used in catch blocks throughout the codebase (ChatView.tsx lines 1020, 1198, 1281, 1327, 1393, etc.). 

**Suggestion**: Extract `formatErrorMessage(err: unknown): string` utility.

### 2.6 Repeat of mute menu items (2 places) — MEDIUM

The mute duration options are rendered in `ChatView.tsx` at line 1311 (desktop) and line 1586 (mobile) with identical duration arrays and nearly identical button code.

---

## 3. PROP DRILLING

### 3.1 `ChatViewProps` — 22 props — HIGH

`src/components/ChatView.tsx` lines 28-49: 22 props defined, most are callbacks passed straight from `App.tsx`:
- `chat`, `onGoHome`, `onToggleFileBrowser`, `fileBrowserOpen`, `onOpenPolls`, `onOpenPoll`, `onOpenCalendar`, `onOpenEvent`, `onMarkRead`, `onToggleFlagged`, `flaggedOpen`, `jumpToMessageId`, `jumpToMessageTime`, `jumpKey`, `onJumpComplete`, `onStartCall`, `onToggleFavorite`, `onChannelImageUpdated`, `channels`

### 3.2 `SidebarProps` — 22 props — HIGH

`src/components/Sidebar.tsx` lines 27-49: 22 props, many of which are just callbacks from `App.tsx`:
- `activeChat`, `onSelectChat`, `loggedIn`, `onOpenFileBrowser`, `onOpenBroadcasts`, `onOpenCalendar`, `onOpenPolls`, `onOpenNotifications`, `onOpenSettings`, `onOpenProfile`, `triggerFocusKey`, `broadcastsOpen`, `calendarOpen`, `pollsOpen`, `notificationsOpen`, `onChannelsLoaded`, `onConversationsLoaded`, `onRegisterRefresh`, `onRegisterToggleFavorite`, `onGoHome`, `onUnreadChange`

### 3.3 SidebarHeader gets 11+ props from Sidebar — MEDIUM

`SidebarHeader` (line 620-631 of Sidebar.tsx) receives 11 props that were passed down from App.tsx through Sidebar.

### 3.4 TopBar gets 20+ props from App.tsx — HIGH

`App.tsx` lines 247-265 pass 20+ props to `TopBar`, including inline callback definitions like `() => { const wasOpen = notificationsOpen; closeAllPanels(); if (!wasOpen) setNotificationsOpen(true); }`.

**Suggestion**: Consider using `useContext` for panel state or a dedicated `PanelContext` to avoid this deep drilling. A `usePanelManager` hook could consolidate the 17 state variables in App.tsx.

---

## 4. IMPORT ISSUES

### 4.1 Barrel imports everywhere (25 files use `import * as api`) — MEDIUM

`src/components/ChatView.tsx:4`, `src/components/Sidebar.tsx:3`, `src/components/FileBrowserPanel.tsx:10`, and 22 other components use `import * as api from '../api'`. This imports ALL exports from the barrel, defeating tree-shaking. The barrel itself (`src/api/index.ts`, 196 lines) re-exports everything from 11 submodules.

**Suggestion**: Import only what's needed, e.g., `import { getMessages, sendMessage, ... } from '../api/messages'`. The CLAUDE.md actually acknowledges this ("For better tree-shaking, import directly from a sub-module") but the codebase doesn't follow it.

### 4.2 Unused barrel re-exports — LOW

The barrel exports `get`, `post`, `del`, `patch`, `put` from `core.ts` (lines 9-20 of index.ts), but components that use `import * as api` never call `api.get()` directly — they use the specific wrapper functions. However, `AuthContext.tsx` and `LoginPage.tsx` import specific functions like `api.restoreToken()`, `api.isLoggedIn()`, so these re-exports may be unused.

### 4.3 Unused import in ChatView.tsx — LOW

Line 1: `useRef` is imported, and line 2: many icons may not all be used (e.g., `Download`, `LogOut`, `Plus`, `Check`, `CheckCheck`).

### 4.4 Unused file: `src/utils/documentTemplates.ts` (5 lines) — MEDIUM

Contains only `DOCX_TEMPLATE`, `XLSX_TEMPLATE`, `PPTX_TEMPLATE` as base64-encoded Office templates. These are used by `CreateNCDocumentModal.tsx` via import from `../utils/documentTemplates` — verified in use. **No issue, but the large base64 blobs could be in a `.json` file instead.**

---

## 5. STATE MANAGEMENT

### 5.1 ChatView.tsx: 40+ `useState` calls — HIGH

Lines 196-251 show 40+ individual `useState` calls. This is the single largest state management anti-pattern in the codebase:

```
messages, loading, loadingMore, hasMore, showScrollBtn, typingUsers, isManager, dragOver, fileSentToast, droppedFiles, ncShareChoice, membersOpen, lightboxUrl, pdfView, descEditorOpen, chatDescription, chatImage, chatName, imageEditorOpen, forwardMsg, meetingLoading, notificationsMuted, notificationsLoading, muteMenuOpen, showPollModal, showEventModal, showWhiteboardModal, showNCDocumentModal, replyTo, sendError, searchOpen, mobileMenuOpen, showInfoModal, showRenameModal, showLeaveModal, showDeleteModal, exporting, searchQuery, searchMatchIdx, dateSearchMode, dateStart, dateEnd, dateSearchResults, dateSearchLoading, viewingDateResults, firstUnreadMsgId, pendingMessages, viewingJumpedMessage
```

**Suggestion**: This is a strong candidate for `useReducer` with separate slices:
- `messageState`: messages, loading, loadingMore, hasMore
- `uiState`: showScrollBtn, dragOver, searchOpen, mobileMenuOpen, etc.
- `modalState`: all 8 modal visibility booleans

### 5.2 App.tsx: 17+ `useState` calls — MEDIUM

Lines 39-59 in App.tsx. The 17 state variables manage panel visibility, active view, channel/conversation lists, jump-to-message, and search focus. Combined with the 20+ panel toggle functions (lines 89-155), this creates a complex state surface.

**Suggestion**: Create a `usePanelManager` hook consolidating all panel visibility booleans and toggle functions.

### 5.3 Sidebar.tsx: 11 `useState` calls — MEDIUM

Channels, conversations, search, showNewChannel, showNewChat, primaryCompanyId, sidebarWidth, splitPct, showChannelDiscovery, expandedParents. Plus 6 window event listeners (marks-read, channel-deleted, channel-renamed, open-new-channel-modal).

### 5.4 MessageInput.tsx: 10 `useState` calls — MEDIUM

sending, sendProgress, currentUploadIdx, showEmoji, pendingFiles, showAttachMenu, linkDialog, isRecording, recordingSeconds, directoryHandle.

### 5.5 CalendarView.tsx: Complex state — MEDIUM

viewMode, currentDate, events, loading, sources, personalCollapsed, channelExpanded, showCreate, editingEvent, selectedEvent. The `currentDate` is mutated via `setCurrentDate(new Date(...))` rather than using a reducer pattern.

### 5.6 `settingsOpen` and similar toggles inconsistent — LOW

In `App.tsx`, `settingsOpen` is a boolean but `activeView` is a union type `'chat' | 'calendar' | 'polls'`. The `broadcastsOpen`/`notificationsOpen`/`flaggedOpen` use the same boolean pattern as `settingsOpen`, but `FileBrowserPanel` has a `fileBrowserStandalone` mode making the logic for `fileBrowserOpen` inconsistent with others.

---

## 6. TYPE ISSUES

### 6.1 Actual `any` usage (4 locations) — HIGH

| File | Line | Code |
|------|------|------|
| `src/components/NotificationsPanel.tsx` | 267 | `items.map((n: any) => ({` — Using `any` on notifications array items |
| `src/components/Sidebar.tsx` | 151 | `(ch as any).unread ?? ch.unread_count ?? 0` — Cast to `any` to access API fields |
| `src/components/Sidebar.tsx` | 153 | `(ch as any).last_action \|\| (ch as any).last_activity \|\| 0` — `any` cast |
| `src/components/Sidebar.tsx` | 182 | `(c as any).unread ?? c.unread_count ?? (c as any).unread_messages ?? 0` |

All four are justified workarounds for inconsistent Stashcat API response shapes, but they bypass type safety.

### 6.2 Missing interfaces — MEDIUM

- `MessageInput.tsx` line 12: `editor.storage as unknown as { markdown: { getMarkdown(): string } }` — no interface for tiptap storage shape
- `ChatView.tsx` line 339: `res as unknown as Message[]` — `getMessages()` returns `Array<Record<string, unknown>>` instead of `Message[]`
- `FileBrowserPanel.tsx` lines 789-790: inline type for folder/file entries uses `Record<string, unknown>`

### 6.3 Interface duplication — MEDIUM

`RawUser` interface is defined separately in:
- `ChannelMembersPanel.tsx` line 23
- `BroadcastsPanel.tsx` line 38
- `CreateEventModal.tsx` line 13
- `NewChatModal.tsx` (likely similar)

**Suggestion**: Define a shared `StashcatUser` interface in `types.ts`.

### 6.4 Inconsistent optional chaining — LOW

Throughout the codebase, `msg.sender?.id` and `String(msg.sender?.id)` are used inconsistently. Some places use `String(msg.sender?.id)` which produces `"undefined"` if sender is null, while others check `msg.sender?.id` first.

---

## 7. PERFORMANCE CONCERNS

### 7.1 No `React.memo` usage ANYWHERE — HIGH

`grep` found zero uses of `React.memo` or `memo(` in the entire `src/` directory. Components like `Avatar`, `ChatItem`, `LinkPreviewCard`, `MessageBubble` (in ChatView.tsx), `DateSeparator` are all re-rendered on every parent render. The message list in ChatView re-renders ALL messages on every chat switch or new SSE event.

**Suggestion**: At minimum, memoize `Avatar`, `ChatItem`, `DateSeparator`, `SystemMessage`, `ReplyQuote`, `LinkPreviewCard`, and `MessageBubble`.

### 7.2 Missing `useCallback` in handler-heavy components — MEDIUM

`ChatView.tsx` defines `handleSend` (line 1058) as an async function without `useCallback`, causing it to be recreated on every render. `handleUpload` (line 1097) is also not wrapped.

`Sidebar.tsx` defines `handleSelect` with `useCallback` (line 433), but `loadData` (line 128) is a regular async function that gets recreated.

### 7.3 ChatView.tsx: Entire component re-renders on any state change — HIGH

With 40+ useState hooks in a single function component, ANY state update (like `setShowScrollBtn`) causes a full re-render of the 3574-line component, including all message groups, the header, the message input, and the search UI.

**Suggestion**: Split ChatView into smaller sub-components:
- `ChatHeader` (header toolbar, description, service links)
- `MessageList` (message groups, scroll handling, load-more)
- `SearchBar` / `DateSearchBar`
- `ChatViewShell` (orchestrator)

### 7.4 Expensive computations without useMemo — MEDIUM

`ChatView.tsx` line 1140: `groups` array is computed from `messages` on every render without `useMemo`. The `renderPollText()` (line 2900) and `renderEventText()` (line 2973) functions re-parse text on every render.

`Sidebar.tsx` line 568-573: `unreadChannels` and `unreadConversations` are computed on every render without `useMemo`.

### 7.5 SSE handler registry uses Map+Set but creates new Set on every registration — LOW

`src/hooks/useRealtimeEvents.ts` line 144-146: `sharedHandlers.set(eventName, new Set())` creates a new Set even when one might already exist, though this is a minor performance concern.

---

## 8. FILE ORGANIZATION / SINGLE RESPONSIBILITY VIOLATIONS

### 8.1 ChatView.tsx (3,574 lines) — CRITICAL

This file violates SRP at every level. It contains:
- The main `ChatView` component (~1900 lines)
- 11 sub-components: `VideoMeetingCard`, `DateSeparator`, `PollInviteMessage`, `CalendarEventCard`, `SystemMessage`, `ReplyQuote`, `VoiceMessagePlayer`, `FileList`, `MessageBubble`, `LinkifiedText`, `LikeUsersPopover`
- 7 utility functions: `isPollInviteMessage`, `isCalendarEventMessage`, `msgDayKey`, `formatDateLabel`, `detectLinkType`, `extractServiceLinks`, `isVideoMeetingMessage`
- 2 text rendering functions: `renderPollText`, `renderEventText`
- 2 extractor functions: `extractPollId`, `extractEventId`

**Suggestion**: Extract into:
- `src/components/chat/MessagesList.tsx` — message rendering, grouping, scroll
- `src/components/chat/ChatHeader.tsx` — header toolbar
- `src/components/chat/VideoMeetingCard.tsx` 
- `src/components/chat/SystemMessage.tsx`
- `src/components/chat/ReplyQuote.tsx`
- `src/components/chat/VoiceMessagePlayer.tsx`
- `src/components/chat/PollInviteMessage.tsx`
- `src/components/chat/CalendarEventCard.tsx`
- `src/utils/chat.ts` — utility/helper functions

### 8.2 ChannelDropdownMenu.tsx (810 lines) — HIGH

Contains 5 distinct components:
1. `ChannelDropdownMenu` (the dropdown)
2. `ChannelInfoModal` (channel info display)
3. `LeaveConfirmModal` (leave channel confirmation)
4. `DeleteConfirmModal` (delete channel confirmation)
5. `RenameChannelModal` (rename channel form)
6. `exportChatAsMarkdown()` (standalone export function)

**Suggestion**: Extract each modal and the export function into separate files.

### 8.3 FileBrowserPanel.tsx (1,806 lines) — HIGH

Contains `FileBrowserPanel`, `QuotaBar`, `NCQuotaBar` inline components. Should be split into:
- `FileBrowserPanel` (main orchestrator)
- `FileBrowserToolbar` (tabs, breadcrumbs, view toggle)
- `FileGridView` / `FileListView`
- `FilePreviewModal`
- `QuotaBar` (separate component file)

### 8.4 Sidebar.tsx (847 lines) — MEDIUM

Does too much: loads sidebar data, renders channel tree, handles realtime events, manages resize, creates channels/chats, manages expanded parent state. Consider splitting sidebar rendering into a `ChannelTree` component.

---

## 9. DEAD CODE

### 9.1 AuthContext deprecated `finishLogin` — MEDIUM

`src/context/AuthContext.tsx` line 16-18: `finishLogin` is marked `@deprecated` but is still exported and used. It's referenced by the `AuthContextType` interface and remains in the codebase.

### 9.2 Commented-out console.log statements (12 locations) — LOW

`src/hooks/useRealtimeEvents.ts`: lines 243, 270, 281, 285, 315, 338, 357, 368, 448 — all have commented-out `console.warn`/`console.log` statements for SSE debugging.

`src/context/AuthContext.tsx`: lines 43, 48 — commented out `console.log` statements.

### 9.3 `fileBrowserStandalone` state complexity — MEDIUM

`App.tsx` line 42: `fileBrowserStandalone` adds significant complexity to the panel toggle logic (lines 95-110). The `fileBrowserOpen` logic has three states effectively (closed, inline, standalone), but uses two booleans instead of a union type like `'closed' | 'inline' | 'standalone'`.

### 9.4 `ApiConversation` shadowing — LOW

In `Sidebar.tsx` line 133, `api.getConversations()` returns raw API data but the function parameter `c` is typed via inference, then line 161 maps over convList with `c.members || []`. The raw API shape is never explicitly typed — the interface `Conversation` in `types.ts` may not match the API response.

---

## 10. ERROR HANDLING

### 10.1 No ErrorBoundary usage inside the app — HIGH

`src/main.tsx` wraps the entire app in one ErrorBoundary at the root level. There are no per-component ErrorBoundaries. If ChatView crashes, the entire app shows a blank error screen. If CalendarView errors, the Sidebar goes down with it.

**Suggestion**: Add ErrorBoundaries around major sections:
- `<Sidebar>` section
- `<ChatView>` section
- `<CalendarView>` / `<PollsView>` sections
- `<FileBrowserPanel>` section

### 10.2 Silent catch blocks (13+ locations) — MEDIUM

Pattern `catch () { /* silently ignore */ }` or `catch () {}` used in:
- `ChatView.tsx` lines 381, 508, 639, 834, 1056, 1132
- `Sidebar.tsx` line 237
- `NotificationsPanel.tsx` line 283
- `CalendarView.tsx` lines 194, 208, 231
- `AuthContext.tsx` line 35 (no catch at all inside the `.catch()`)
- `CreateEventModal.tsx` lines 116, 118, 147, 163

Some are justified (fire-and-forget markAsRead), but many swallow real errors silently, making debugging difficult.

### 10.3 Inconsistent error user feedback patterns — MEDIUM

Three different patterns for showing errors to users:
1. `alert()` — Used in ChatView.tsx lines 1020, 1198, 1281, 1327, 1393, etc. (blocking and ugly)
2. `console.error()` — Used in 51 locations (silent to the user)
3. `setSendError()` — Used in ChatView.tsx line 1092 (nice inline error, only used in 1 place)

**Suggestion**: Create a unified error display mechanism (toast system or notification banner).

### 10.4 `err instanceof Error ? err.message : err` pattern (20+ places) — MEDIUM

This guard pattern appears in most catch blocks. Extracting a `getErrorMessage(err): string` utility would DRY this up.

### 10.5 Uncaught promise rejections — MEDIUM

`ChatView.tsx` line 701: `api.markAsRead(...).catch(() => {})` — fire-and-forget calls that can generate unhandled rejections if the catch throws. While the empty catch function handles this, the pattern is fragile.

### 10.6 `confirmAsync` from ConfirmContext — pattern issue — LOW

The `useConfirm()` hook returns a promise-based confirmation dialog. This is used in ChatView.tsx (line 1014), ChannelMembersPanel.tsx (lines 139, 160, 196), but the button text is contextually different ("Bestätigen" vs "Entfernen" vs "Einladen"). The `confirmAsync` function accepts a second parameter for the confirm button label, but not for a cancel label.

---

## SUMMARY OF CRITICAL FINDINGS

| Priority | Issue | File(s) |
|----------|-------|---------|
| **CRITICAL** | ChatView.tsx is 3,574 lines with 40+ useState hooks, 0 useCallback on critical handlers, 0 React.memo | `src/components/ChatView.tsx` |
| **CRITICAL** | No React.memo anywhere in entire src/ | All component files |
| **HIGH** | 29 `as unknown as` type casts instead of proper typed API responses | `api/messages.ts`, `ChatView.tsx`, `BroadcastsPanel.tsx`, etc. |
| **HIGH** | 4 actual `any` type usages bypassing strict mode | `Sidebar.tsx`, `NotificationsPanel.tsx` |
| **HIGH** | 22 props drilled through ChatView and Sidebar | `ChatView.tsx:28-49`, `Sidebar.tsx:27-49` |
| **HIGH** | 25 files use `import * as api` defeating tree-shaking | All components |
| **HIGH** | FileBrowserPanel.tsx at 1,806 lines does too much | `src/components/FileBrowserPanel.tsx` |
| **HIGH** | ChannelDropdownMenu.tsx contains 5 separate components | `src/components/ChannelDropdownMenu.tsx` |
| **MEDIUM** | Silent catch blocks swallow errors in 13+ places | Scattered across codebase |
| **MEDIUM** | 3 different error feedback patterns (alert/console/setSendError) | ChatView.tsx and others |
| **MEDIUM** | Interface duplication for `RawUser` in 4 files | Multiple component files |
| **MEDIUM** | Expensive computations (message groups, unread counts) without useMemo | `ChatView.tsx:1140`, `Sidebar.tsx:568-573` |
| **MEDIUM** | App.tsx has 17+ state variables and 15+ toggle functions | `src/App.tsx` |
| **LOW** | Commented-out console.logs in production code | `useRealtimeEvents.ts`, `AuthContext.tsx` |
| **LOW** | `fileBrowserStandalone` creates unnecessary state complexity | `App.tsx:42` |
| **LOW** | Deprecated `finishLogin` still exported and used | `AuthContext.tsx:16-18` |
</task_result>
```

---

## Assistant (Build · DeepSeek V4 Flash Free · 111.4s)

_Thinking:_

Der Benutzer möchte eine Analyse des Projekts mit Vorschlägen für Refactoring-Maßnahmen. Der Task-Agent hat bereits eine sehr umfassende Analyse durchgeführt. Lassen Sie mich auch noch das Backend analysieren, um ein vollständiges Bild zu bekommen.

**Tool: task**

**Input:**
```json
{
  "description": "Analyze backend code issues",
  "subagent_type": "explore",
  "prompt": "Very thorough analysis of the backend code in /Users/dennis/Projekte/stashcat-chat/server/. I need you to identify:\n\n1. **Large files** - Any file over 400 lines. List with exact line counts.\n2. **Code duplication** - Repeated patterns across the backend.\n3. **Error handling** - Inconsistencies, missing error handling, silent failures.\n4. **Security concerns** - Look for any potential issues (even minor).\n5. **Single Responsibility violations** - Files that do too many things.\n6. **Express route organization** - How routes are structured, any patterns that could be improved.\n7. **TypeScript strictness** - Any issues with types, `any` usage, unsafe casts.\n8. **Session management** - Look at session-store.ts and token-crypto.ts for potential issues.\n9. **Secret/credential handling** - Any hardcoded secrets or unsafe practices.\n10. **Performance concerns** - Any blocking operations, memory leaks, connection management.\n\nRead ALL files in server/ thoroughly. For each finding provide exact file paths, line numbers, severity, and concrete suggestions.\n\nReturn a comprehensive numbered list."
}
```

**Output:**
```
task_id: ses_1e6bdab9dffeaqSDnNZ2vx2h0M (for resuming to continue this task if needed)

<task_result>
Now I have all the data. Here is the comprehensive analysis:

---

# Comprehensive Backend Code Analysis: `/Users/dennis/Projekte/stashcat-chat/server/`

---

## 1. Large Files

| File | Lines | Severity | Notes |
|------|-------|----------|-------|
| **`/Users/dennis/Projekte/stashcat-chat/server/index.ts`** | **3,369** | **CRITICAL** | Monolithic file doing everything: routes, realtime, SSE, E2E, file handling, video meetings, key sync, Nextcloud proxy, OnlyOffice, static serving |
| `/Users/dennis/Projekte/stashcat-chat/server/nextcloud.ts` | 274 | OK | Reasonable size for a focused module |
| `/Users/dennis/Projekte/stashcat-chat/server/session-store.ts` | 154 | OK | Well-scoped |
| `/Users/dennis/Projekte/stashcat-chat/server/onlyoffice.ts` | 123 | OK | Well-scoped |
| `/Users/dennis/Projekte/stashcat-chat/server/token-crypto.ts` | 46 | OK | Minimal and focused |

**Recommendation**: Split `index.ts` into separate route files (e.g. `routes/auth.ts`, `routes/channels.ts`, `routes/messages.ts`, `routes/realtime.ts`, `routes/nextcloud.ts`, `routes/onlyoffice.ts`). The 3,369-line file violates every principle of maintainability.

---

## 2. Code Duplication

### 2.1 E2E Decryption Pattern (DUPLICATED 4x)
The identical 10-15 line E2E decryption block is copied verbatim in:
- **`index.ts:302-316`** — `message_sync` SSE handler
- **`index.ts:352-366`** — `notification` SSE handler  
- **`index.ts:1481-1501`** — Flagged messages endpoint
- **`index.ts:1537-1556`** — Search endpoint

**Severity**: MEDIUM
**Suggestion**: Extract a helper function `decryptMessage(client, msg): Promise<void>` that accepts a `StashcatClient` and mutates `msg.text` in place.

### 2.2 Pagination Loops (DUPLICATED 4x)
Identical while-true pagination with `PAGE=100` appears in:
- **`index.ts:983-996`** — Channel members
- **`index.ts:1008-1017`** — Pending members
- **`index.ts:1186-1199`** — Group members
- **`index.ts:2163-2170`** — Broadcast members

**Severity**: LOW
**Suggestion**: Extract a generic `paginateAll<T>(fetcher: (offset: number) => Promise<T[]>, pageSize = 100): Promise<T[]>` utility.

### 2.3 Multer File Upload Handlers (DUPLICATED 4x)
Near-identical upload+rename+unlink patterns in:
- **`index.ts:1720-1756`** — `/api/files/upload`
- **`index.ts:1869-1903`** — `/api/upload/:type/:targetId`
- **`index.ts:2189-2224`** — Broadcast upload
- **`index.ts:3246-3265`** — Nextcloud upload

**Severity**: MEDIUM
**Suggestion**: Extract an `async function handleUpload(req, processFn)` middleware.

### 2.4 `errorMessage(err)` + `res.status(500).json({ error: ... })` Pattern
This pattern appears **~70+ times** across `index.ts`. While compact, it obscures the actual error type.

**Severity**: LOW
**Suggestion**: Consider an Express error-handling middleware `app.use((err, req, res, next) => ...)` instead.

---

## 3. Error Handling Inconsistencies

### 3.1 Silent Failures / Empty Catch Blocks

| Location | Line(s) | What's swallowed | Severity |
|----------|---------|------------------|----------|
| `index.ts` | 587 | `catch { /* token may be invalid, that's fine */ }` — too broad | LOW |
| `index.ts` | 802 | `catch { clearInterval(hb); try { res.end(); } catch {} }` — nested catch | MEDIUM |
| `index.ts` | 822 | `catch { /* ignore */ }` — swallowed write error | LOW |
| `index.ts` | 915 | `catch { /* best-effort */ }` — notification delete silently fails | LOW |
| `index.ts` | 1552-1554 | `catch { /* Leave text as-is */ }` — decryption failure in search is completely hidden | MEDIUM |
| `index.ts` | 2087 | Returns minimal preview on ANY failure, including SSRF violations — indistinguishable | MEDIUM |
| `index.ts` | 2521 | `catch { /* best-effort */ }` — notification delete | LOW |
| `index.ts` | 2507-2508 | Bare `catch {}` in channel key sync loop | MEDIUM |
| `index.ts` | 3005-3008 | `catch { res.json({ ok: true }) }` — all errors treated as success in call/end | MEDIUM |
| `index.ts` | 2891, 2882 | `.catch(() => {})` on sendMessage during poll creation | LOW |

### 3.2 Incomplete Parameter Validation

| Location | Line(s) | Issue | Severity |
|----------|---------|-------|----------|
| `index.ts` | 418-445 | `/api/login` — no explicit validation of `email`/`password` existence | LOW |
| `index.ts` | 2034 | SSRF `isBlockedHost` — `fc\|fd` regex matches anywhere in hostname, not just prefix (blocks legitimate hosts containing `fc` or `fd`, e.g. `fctest.example.com`). This is actually *overly* restrictive, which is safe but incorrect. | LOW |
| `index.ts` | 2061-2082 | Only **one redirect** is followed; chained redirects are not followed | MEDIUM |

### 3.3 Inconsistent Error Response Shapes

Most endpoints return `{ error: string }` on failure, but some (e.g. `index.ts:2087` link preview) return `{ title, fetchedAt }` even on error — the frontend has no way to distinguish success from failure.

**Severity**: LOW

### 3.4 Missing Error Details on Some Routes

- `index.ts:2767`: `res.status(500).json({ error: String(err) })` — exposes raw error objects to client (used in polls routes: lines 2767, 2792, 2895, 2904, 2914, 2940). Most other routes safely use `errorMessage(err)`. **Inconsistent**.

**Severity**: MEDIUM

---

## 4. Security Concerns

### 4.1 Login Password in Session Token
**`index.ts:431-433`**: The login password (`loginPassword: password`) is stored in the encrypted session token payload. While the token is AES-256-GCM encrypted, the login password still lives in a token that the browser holds and sends on every request.

**Severity**: LOW (mitigated by encryption)
**Suggestion**: Consider whether the login password must be in the token, or if it can be fetched from a secure server-side store when needed for Nextcloud auth.

### 4.2 App Password Accepted via Query Parameter
**`index.ts:3145-3148`**: 
```typescript
const appPassword = (req.headers['x-nc-app-password'] as string | undefined)
  ?? (req.query.ncAppPw as string | undefined);
```
Nextcloud app passwords can be passed as query parameters, making them visible in server logs, browser history, and referrer headers.

**Severity**: MEDIUM
**Suggestion**: Only accept app passwords via headers, never query parameters.

### 4.3 Internal API Encapsulation Broken Repeatedly
- **`index.ts:1112`**: `const api = (client as any).api;` — accessing private API client
- **`index.ts:1319`**: Casting to `unknown` to call `setMissingKey` 
- **`index.ts:1522-1533`**: Direct `client.api.post(...)` calls bypassing the stashcat-api abstraction
- **`index.ts:481, 515, 527`**: Casting realtime manager to access `socket` property
- **`index.ts:2979-2985`**: Same socket access pattern for WebRTC signaling

**Severity**: MEDIUM
**Suggestion**: These indicate missing methods in `stashcat-api` that should be added as proper public methods rather than accessed through type casts.

### 4.4 SSRF Protection — Single Redirect Follow
**`index.ts:2061-2082`**: The link preview follows only one HTTP redirect. A chain of 2+ redirects could potentially bypass the SSRF host check.

**Severity**: LOW
**Suggestion**: Wrap the redirect-following in a loop with a max depth limit (e.g., 5 redirects), checking each intermediate target.

### 4.5 Debug Log Contains Sensitive Data
**`index.ts:13-23`**: `debugLog()` writes to `e2e-debug.log` in the project root. It serializes objects with `JSON.stringify`, which could include message content, encryption keys, user data, etc.

**Severity**: LOW
**Suggestion**: Ensure debug logging is disabled in production, or add a log-level filter.

### 4.6 Rate Limiter Exempts File Downloads
**`index.ts:76`**: `skip: (req) => req.path === '/api/events' || req.path.startsWith('/api/file')` — the file download endpoint has no rate limit, potentially allowing abuse for bandwidth exhaustion.

**Severity**: LOW
**Suggestion**: Add a separate rate limiter for file downloads.

### 4.7 No Input Size Limits on SSE Connections
**`index.ts:764-846`**: SSE connections accumulate indefinitely. While individual connections are cleaned up on `close`, a malicious client could open thousands of parallel SSE connections.

**Severity**: LOW
**Suggestion**: Add a per-IP or per-clientKey cap on concurrent SSE connections.

### 4.8 Channel Image Upload — Unvalidated Base64
**`index.ts:1110-1121`**: The channel image endpoint accepts arbitrary base64-encoded image data with no size validation or image format verification. A malicious user could upload extremely large payloads.

**Severity**: MEDIUM
**Suggestion**: Validate base64 data size and decode only if under a reasonable limit (e.g., 2MB). Verify the decoded data is a valid image.

---

## 5. Single Responsibility Violations

### 5.1 `index.ts` — The God File
**`index.ts:1-3369`**: Severity: **CRITICAL**

This file handles ALL of the following distinct responsibilities:
1. Server bootstrap (Express, CORS, rate limiting)
2. Client cache management (TTL, cleanup)
3. Authentication (single-step + phased 4-step wizard)
4. SSE connection management
5. Realtime (Socket.io → SSE bridge with 8+ event types)
6. E2E decryption (messages, notifications, search, flags)
7. Channel CRUD (15+ routes)
8. Conversation management
9. Message operations (send, delete, like, flag, search)
10. File browser (list, upload, download, rename, delete, move)
11. File upload with multer (3 variants)
12. Link preview with SSRF protection
13. Broadcast management
14. Calendar events
15. Notifications (list, count, single-delete, bulk-delete)
16. Key sync (E2E key exchange protocol)
17. Video meeting orchestration (Chat Bot integration)
18. Polls (CRUD, voting, invite, publish)
19. WebRTC calls (TURN server, create, signal, end)
20. OnlyOffice document viewer integration
21. Nextcloud WebDAV proxy (12+ routes)
22. Static file serving
23. Session restore on startup
24. Chat Bot discovery and caching
25. Helper functions (`debugLog`, `serverLog`, `errorMessage`, etc.)

### 5.2 `nextcloud.ts` — Reasonable Scope
At 274 lines, this module is well-scoped to WebDAV + OCS Share API operations.

### 5.3 `onlyoffice.ts` — Reasonable Scope
Well-scoped to OnlyOffice Document Server integration.

---

## 6. Express Route Organization

### 6.1 No Routers
**`index.ts:1-3369`**: All routes are mounted directly on `app` with no `express.Router()` usage. No modular route files exist.

**Severity**: MEDIUM
**Suggestion**: Split into `routes/auth.ts`, `routes/channels.ts`, `routes/messages.ts`, `routes/files.ts`, `routes/calendar.ts`, `routes/polls.ts`, `routes/nextcloud.ts`, `routes/onlyoffice.ts`, `routes/realtime.ts`, etc.

### 6.2 Inconsistent Route Naming
- `/api/channels/:companyId` lists channels by company
- `/api/channels/:channelId/info` gets single channel info  
- `/api/channels/:channelId/members` lists members
- These share the same `/api/channels/:param` pattern but `:param` means different things. Express relies on route ordering to disambiguate.

**Severity**: LOW (noted as fragile in the code comment at line 1406)

### 6.3 Route Parameter Type Conflicts
- `/api/channels/:companyId` (line 957) and `/api/channels/:channelId/info` (line 1129) — the order in which these are registered matters.
- `/api/messages/:type/:targetId` (line 1577) vs `/api/messages/:messageId/like` (line 1408) — the comment on line 1406 warns about ordering.

**Severity**: LOW

### 6.4 No Middleware Extraction
The `getClient()` call plus token extraction pattern is repeated in every single route handler. A middleware like `app.use('/api/*', authenticateToken)` could reduce boilerplate.

**Severity**: LOW-MEDIUM

---

## 7. TypeScript Strictness Issues

### 7.1 Pervasive `as any` Casts

| Location | Line | Usage |
|----------|------|-------|
| `index.ts` | 962 | `(ch as any).membership` — accessing nested prop |
| `index.ts` | 990 | `(m as any).membership_pending` |
| `index.ts` | 1112 | `(client as any).api` — accessing private API |
| `index.ts` | 1319 | `(client as unknown as { ... })` — calling private method |
| `index.ts` | 1833 | `(stashRes.body as any)` — Readable.fromWeb |
| `index.ts` | 1852, 1887, 1892, 1893, 2207 | Various internal API calls |

**Severity**: MEDIUM
**Suggestion**: Add proper public methods to `stashcat-api` for each of these access patterns.

### 7.2 `as unknown as` Double Casts
Used extensively to bypass type checking:
- `index.ts:482, 515, 527` — realtime manager socket access
- `index.ts:1319` — setMissingKey method access
- `index.ts:1366, 1370, 1376` — conversation/list casting
- `index.ts:1481, 1537` — message list casting

**Severity**: MEDIUM

### 7.3 `Record<string, unknown>` as a Type Escape
Widely used instead of proper interfaces, e.g.:
- `index.ts:1366` — conversation arrays
- `index.ts:1481` — message arrays
- `index.ts:1523` — search params
- `index.ts:2467-2478` — API request data

**Severity**: LOW-MEDIUM

### 7.4 Unused Import / Loose Typing
- `index.ts:11`: `import type { ActiveDevice } from 'stashcat-api'` — check if `ActiveDevice` is used
- `index.ts:50`: `import type { RealtimeManager } from 'stashcat-api'` — used in SSEConnection interface

### 7.5 Type `Parameters<>` for Method Typing
**`index.ts:1243`**: `Parameters<typeof client.createChannel>[0] & Record<string, unknown>` — this is a fragile way to type the channel options. If `createChannel` signature changes, this breaks silently.

**Severity**: LOW

---

## 8. Session Management Issues

### 8.1 `session-store.ts` — Misleading Field Name
**`session-store.ts:106-107`**: The field `encryptedSecurityPassword` stores only the ciphertext (not the iv or authTag). The name implies it stores a fully self-contained encrypted blob. This is only a naming issue since the iv and authTag are stored as separate fields.

**Severity**: LOW
**Suggestion**: Rename to `ciphertext` for clarity.

### 8.2 `session-store.ts` — File Mode 0o600 on Non-UNIX
**`session-store.ts:49, 87`**: The `{ mode: 0o600 }` option on `writeFile` only works on POSIX systems; it has no effect on Windows.

**Severity**: INFO

### 8.3 `token-crypto.ts` — No Token Expiry
**`token-crypto.ts:39-45`**: `decryptSession()` has no mechanism for token expiry or revocation. A leaked token is valid until the server restarts (without `SESSION_SECRET`) or forever (with `SESSION_SECRET`).

**Severity**: MEDIUM
**Suggestion**: Add a timestamp to the `SessionPayload` and validate token age on each request.

### 8.4 `token-crypto.ts` — Cannot Revoke Individual Sessions
There is no token blacklist or per-token validity. The only way to invalidate a session is to restart the server (when using ephemeral keys).

**Severity**: LOW
**Suggestion**: Add a token version counter or blacklist mechanism.

---

## 9. Secret/Credential Handling

### 9.1 Hardcoded Default URLs

| File | Line | Value | Severity |
|------|------|-------|----------|
| `onlyoffice.ts` | 13 | `ONLYOFFICE_URL` defaults to `https://office.bbz-rd-eck.de` | INFO |
| `onlyoffice.ts` | 14 | `PUBLIC_URL` defaults to `https://chat.bbz-rd-eck.com` | INFO |
| `nextcloud.ts` | 3161 | `NEXTCLOUD_URL` defaults to `https://cloud.bbz-rd-eck.de` | INFO |
| `index.ts` | 422 | `STASHCAT_BASE_URL` defaults to `https://api.stashcat.com/` | INFO |

These are not secrets (they are public URLs and have env var overrides), but they embed school-specific defaults in the code.

### 9.2 Login Password in Token (Repeated from 4.1)
**`index.ts:432`**: `loginPassword: password` stored in encrypted session token payload.

### 9.3 Nextcloud App Password in On-Request Tokens
**`onlyoffice.ts:61`**: `ncAppPassword` is stored in short-lived download tokens (1 hour TTL). These tokens are stored in a plain in-memory `Map`. While short-lived, this is sensitive data in memory without explicit clearing.

**Severity**: LOW

### 9.4 Session Secret File Exposed
**`session-store.ts:19`**: `.session-secret` file is created in the project root. Its `.gitignore` status depends on project setup. If accidentally committed, all encrypted sessions are compromised.

**Severity**: LOW (depends on gitignore)

---

## 10. Performance Concerns

### 10.1 Unbounded Memory Maps

| Map | Location | Cleanup | Risk |
|-----|----------|---------|------|
| `linkPreviewCache` | `index.ts:1961` | 1h TTL, but **no size limit** | LARGE: could grow unbounded if many unique URLs |
| `downloadTokens` | `onlyoffice.ts:49` | 1h TTL, but **no size limit** | LOW: entries are small, only for active viewing sessions |
| `clientCache` | `index.ts:86` | Periodic 60s cleanup | LOW: limited by concurrent users |
| `activeSSE` | `index.ts:127` | Cleaned on disconnect | LOW: bounded by connections |
| `pendingKeyRequests` | `index.ts:130` | **NEVER CLEANED** | MEDIUM: entries accumulate forever |

**Suggestion**: Add size limits to `linkPreviewCache`. Clean up `pendingKeyRequests` on TTL.

### 10.2 Encrypted Files Fully Buffered in RAM
**`index.ts:1854-1861`** and **`index.ts:3112-3117`**: Encrypted files are completely loaded into memory for decryption. A user uploading a 500MB encrypted file would cause 500MB+ RAM usage for the server process.

**Severity**: MEDIUM
**Suggestion**: Stream the file through decryption if possible, or limit encrypted file download size.

### 10.3 Double-Buffering in Nextcloud Downloads
**`index.ts:3138`**: `Buffer.from(await ncRes.arrayBuffer())` — allocates memory twice (arrayBuffer + Buffer.from).
**`index.ts:3238`**: Same pattern.
**`index.ts:3256-3258`**: Reads entire file into buffer, then passes whole buffer to ncUpload.

**Severity**: LOW
**Suggestion**: Use streaming (e.g., `Readable.fromWeb(stashRes.body).pipe(res)`) instead of buffering.

### 10.4 Synchronous Polling Loops Blocking Request Handlers

| Location | Duration | Interval | Issue |
|----------|----------|----------|-------|
| `index.ts:709-713` | 30s | 1s | Blocks the `/api/login/device/complete` handler |
| `index.ts:2692-2733` | 30s | 500ms | Blocks the `/api/video/start-meeting` handler |

Both use synchronous-style polling (`await new Promise(r => setTimeout(...))`) inside request handlers. These hold open server connections for up to 30 seconds.

**Severity**: MEDIUM
**Suggestion**: Use WebSocket/SSE push or a job queue pattern instead of blocking polling in request handlers.

### 10.5 SSE Heartbeat Refreshes Cache On Every Tick
**`index.ts:797-801`**: Every 25 seconds, the SSE heartbeat refreshes the client cache TTL. This is fine, but the whole-cache entry is touched even if the client is doing nothing.

**Severity**: INFO

### 10.6 Multer Uses OS Temp Directory Without Cleanup
**`index.ts:63`**: `multer({ dest: os.tmpdir() })` — multer creates temp files in the OS temp directory. While multer normally cleans up, if the request handler crashes before cleanup (e.g., before `fs.unlink` in the catch blocks), temp files accumulate.

**Severity**: LOW
**Suggestion**: Verify that the `try/finally` or error-handling in all multer routes cleans up temp files reliably. File upload routes do have cleanup in catch blocks but not in finally blocks — note that line 3246-3265 uses `finally` correctly, but lines 1720-1756 and 1869-1903 do not.

---

## 11. Additional Findings

### 11.1 SSE Write Exception Handling
**`index.ts:142`**: `catch { conn.sseClients.delete(res); }` — if one SSE client's write fails, it is silently removed from the set. This is correct behavior but could lead to silent connection drops.

### 11.2 `isBlockedHost` Regex Over-Matches
**`index.ts:1966`**: The regex `/^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|0\.|169\.254\.|localhost|::1|\[::1\]|fc|fd)/i` — the `fc|fd` patterns match **anywhere at the start** of the hostname, blocking legitimate hosts like `fctest.example.com` or `fd.example.com` even though they're not in the `fc00::/7` IPv6 range. This is overly broad (safe) but technically incorrect.

**Severity**: LOW

### 11.3 Server Startup Race Condition
**`index.ts:3367-3368`**: The server starts listening immediately. However, if `SESSION_SECRET` is set and there are `.sessions.json` sessions to restore, the session restoration happens asynchronously (via imports/calls not visible in this file). Clients connecting immediately might find no cached sessions.

**Severity**: LOW

### 11.4 Inconsistent Use of `console.log` vs `serverLog`
Some routes use `console.log` (lines 997, 998, 1032, 1037) while others use `serverLog`. The `serverLog` function tries to write to files; `console.log` only writes to stdout.

**Severity**: INFO

### 11.5 `setInterval` References Not Managed
**`index.ts:110`**: The 60-second cache cleanup interval has no means of being stopped (no reference stored). If the server needs graceful shutdown, this interval would keep the process alive.

**Severity**: LOW
**Suggestion**: Store interval references and clear them on `process.on('SIGTERM')`.

---

## Summary: Priority Action Items

| # | Finding | File | Severity |
|---|---------|------|----------|
| 1 | Monolithic 3,369-line `index.ts` | `index.ts` | CRITICAL |
| 2 | E2E decryption duplicated 4x | `index.ts:302,352,1481,1537` | MEDIUM |
| 3 | `any`/`unknown` casts bypass type safety | Multiple | MEDIUM |
| 4 | Login password stored in token | `index.ts:432` | LOW |
| 5 | App password accepted via query param | `index.ts:3145-3148` | MEDIUM |
| 6 | No token expiry/revocation | `token-crypto.ts:39-45` | MEDIUM |
| 7 | Blocking 30s polling loops | `index.ts:709-713,2692-2733` | MEDIUM |
| 8 | Unbounded memory for `linkPreviewCache` | `index.ts:1961` | MEDIUM |
| 9 | `pendingKeyRequests` never cleaned | `index.ts:130` | MEDIUM |
| 10 | Encrypted files fully buffered | `index.ts:1854-1861` | MEDIUM |
| 11 | No middleware auth extraction | `index.ts` (all routes) | LOW-MEDIUM |
| 12 | Inconsistent error responses (polls use `String(err)`) | `index.ts:2767,2792,2895,etc.` | MEDIUM |
| 13 | Double-buffering in NC downloads | `index.ts:3138,3238,3256-3258` | LOW |
| 14 | File upload handlers not using `finally` for cleanup | `index.ts:1720-1756,1869-1903` | LOW |
| 15 | Internal `stashcat-api` encapsulation broken 6+ places | `index.ts:481,1112,1319,1522,etc.` | MEDIUM |
| 16 | Channel image upload — no size validation | `index.ts:1110-1121` | MEDIUM |
| 17 | Login handler — no input validation | `index.ts:418-445` | LOW |
| 18 | SSE connection count unbounded | `index.ts:764-846` | LOW |
| 19 | Debug log leaks sensitive data | `index.ts:13-23` | LOW |
| 20 | No graceful shutdown handling | `index.ts` (no SIGTERM handler) | LOW |
</task_result>
```

---

## Assistant (Build · DeepSeek V4 Flash Free · 18.8s)

_Thinking:_

Now I have comprehensive analyses of both frontend and backend. Let me compile a well-structured response for the user with prioritized refactoring suggestions. I should present this in a clear, actionable way.

## Refactoring-Vorschläge für stashcat-chat

Nach gründlicher Analyse des gesamten Sourcecodes (Frontend + Backend) hier die wichtigsten Maßnahmen, gruppiert nach Priorität:

---

### 🔴 Kritisch (sofort angehen)

**1. `server/index.ts` (3.369 Zeilen) aufteilen**
Die Datei ist ein God-Modul: Routes, SSE, E2E, Auth, Calendar, Polls, Nextcloud-Proxy, OnlyOffice – alles in einer Datei. In mindestens 5-8 `express.Router()`-Module splitten:
```
server/routes/
├── auth.ts
├── channels.ts
├── messages.ts
├── files.ts
├── calendar.ts
├── polls.ts
├── nextcloud.ts
├── realtime.ts (SSE)
```
Dazu ein gemeinsames `middleware/auth.ts` für Token-Extraktion statt `getClient()` in jeder Route.

**2. `src/components/ChatView.tsx` (3.574 Zeilen) zergliedern**
Enthält 11 Subkomponenten (`VideoMeetingCard`, `DateSeparator`, `PollInviteMessage`, `CalendarEventCard`, `SystemMessage`, `ReplyQuote`, `VoiceMessagePlayer`, `FileList`, `MessageBubble`, `LinkifiedText`, `LikeUsersPopover`) plus ~40 `useState`-Aufrufe. Jede Subkomponente in eigene Datei:
```
src/components/chat/
├── ChatView.tsx (Orchestrator, ~300 Zeilen)
├── MessageList.tsx
├── MessageBubble.tsx
├── ChatHeader.tsx
├── ReplyQuote.tsx
├── DateSeparator.tsx
├── VideoMeetingCard.tsx
├── PollInviteMessage.tsx
├── CalendarEventCard.tsx
├── SystemMessage.tsx
├── VoiceMessagePlayer.tsx
├── FileList.tsx
├── LinkifiedText.tsx
├── LikeUsersPopover.tsx
```

**3. `React.memo` für alle reinen Presentational Components einführen**
Derzeit kein einziges `React.memo` im gesamten Frontend. `Avatar`, `ChatItem`, `DateSeparator`, `MessageBubble`, `ReplyQuote`, `SystemMessage`, `LinkPreviewCard` werden bei jedem Parent-Render neu gerendert. Bei ~40 `useState` in ChatView betrifft das besonders die Message-Liste.

---

### 🟠 Hoch

**4. ChatView State: `useReducer` statt 40 `useState`**
Aufteilung in logische Slices:
- `messageState` (messages, loading, loadingMore, hasMore)
- `uiState` (searchOpen, mobileMenuOpen, dragOver, etc.)
- `modalState` (8 Modal-Booleans in einem Objekt)

**5. `App.tsx` entlasten: `usePanelManager`-Hook**
17+ State-Variablen + 15 Toggle-Funktionen in einen Hook auslagern. Bietet sich für einen `PanelContext` an, um auch die 22 Props in ChatView und Sidebar zu reduzieren.

**6. Prop-Drilling reduzieren**
ChatView hat 22 Props, Sidebar 22 Props, TopBar 20+ Props. Gemeinsame Panel-State-Callbacks über Context oder den `usePanelManager`-Hook bereitstellen.

**7. `FileBrowserPanel.tsx` (1.806 Zeilen) aufteilen**
In `FileBrowserToolbar`, `FileGridView`/`FileListView`, `FilePreviewModal`, `QuotaBar` separieren.

**8. Typisierte API-Responses statt `as unknown as`**
29 `as unknown as`-Casts durch echte generische Typ-Parameter in `get<T>()` ersetzen. `api/messages.ts` soll `Promise<Message[]>` zurückgeben.

---

### 🟡 Mittel

**9. `ChannelDropdownMenu.tsx` (810 Zeilen) entflechten**
5 Modal-Komponenten + Export-Funktion in separate Dateien.

**10. `RawUser`-Interface zentralisieren**
In `types.ts` definieren, aktuell 4x dupliziert.

**11. Duplizierte E2E-Decryption (Backend, 4x)**
In eine Hilfsfunktion `decryptMessage(client, msg)` extrahieren.

**12. Auth-Middleware für Express**
`getClient()` + Token-Parsing in jeder Route → `app.use('/api/*', authenticate)`.

**13. File Upload Cleanup mit `finally`**
Multer-Tempfiles werden in catch-Blöcken gelöscht, aber nicht in `finally`. Bei Erfolgspfaden bleiben Tempfiles liegen.

**14. `pendingKeyRequests` Cache aufräumen**
Wächst unbegrenzt – TTL oder Size-Limit einführen.

**15. `linkPreviewCache` Size-Limit**
Hat 1h TTL, aber kein Size-Limit. `new Map()` kann unbegrenzt wachsen.

---

### 🔵 Niedrig / Schönheitskorrekturen

- **Commented-out `console.log`** (12 Stellen) entfernen
- **`fileBrowserStandalone`** durch Union-Type ersetzen (`'closed' | 'inline' | 'standalone'`)
- **Deprecated `finishLogin`** in AuthContext entfernen
- **`formatUserName()`** Utility für das wiederholte `${first} ${last}` in 5+ Dateien
- **`getErrorMessage()`** Utility für das `err instanceof Error`-Pattern (20+ Stellen)
- **SSRF-RegEx** `fc|fd` präzisieren (matched derzeit auf `fctest.example.com`)
- **Token-Expiry** in `token-crypto.ts` (derzeit unbegrenzt gültig)
- **Einheitliches Error-Feedback** auf Frontend (aktuell 3 Varianten: `alert`, `console.error`, `setSendError`)
- **ErrorBoundary pro Bereich** statt einem globalen in `main.tsx`
- **`import * as api` → direkte Imports** (für Tree-Shaking, wie in CLAUDE.md dokumentiert aber nie umgesetzt)

---

Soll ich mit einem der Punkte beginnen? Ich empfehle, bei **Punkt 1** (`server/index.ts` splitten) oder **Punkt 2** (`ChatView.tsx` zergliedern) zu starten – das gibt den größten Nutzen für die Wartbarkeit.

---

