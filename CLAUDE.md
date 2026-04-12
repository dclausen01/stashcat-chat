# CLAUDE.md — BBZ Chat

## Project Overview

`stashcat-chat` is a React 19 + TypeScript web chat client for Stashcat / schul.cloud (BBZ Rendsburg-Eckernförde). It wraps the `stashcat-api` library behind an Express 5 backend that acts as an authenticated proxy, bridging Stashcat's REST API and Socket.io realtime push to the browser via SSE.

- **Frontend**: React 19, TypeScript 5.9, Vite 8, Tailwind CSS v4
- **Backend**: Express 5, tsx (TypeScript runner), multer for uploads
- **Dependency**: `stashcat-api` as a local `file:../stashcat-api` package

---

## Environment Notes

**Bash-Ausgaben funktionieren nicht** in dieser Claude-Code-Umgebung — `Bash` liefert immer `(Bash completed with no output)`. Stattdessen immer mit temporären Dateien arbeiten:

```bash
some-command > /tmp/out.txt 2>&1   # dann mit Read lesen
```

**Build**: Mit `yarn` statt `npm` builden — `yarn build`. `npm run build` funktioniert nicht, weil das Projekt yarn als Paketmanager nutzt.

**Code-Verifikation**: Änderungen werden überprüft durch `yarn build` (muss fehlerfrei durchlaufen) und anschließend Live-Test auf dem Server, den der User durchführt. Kein automatischer Preview-Browser-Test.

---

## Dev Commands

```bash
yarn start       # Start both frontend (port 5173) and backend (port 3001) concurrently
yarn dev         # Vite dev server only (frontend)
yarn server      # Express backend only (tsx server/index.ts)
yarn build       # tsc -b + vite build (production)
yarn preview     # Serve production build
yarn lint        # ESLint
```

The Vite dev server proxies `/backend/api/*` → `http://localhost:3001/api/*`.

---

## Architecture

### React + Express Proxy Pattern

```
Browser
  └── src/api.ts (fetch + Bearer token)
        └── POST/GET /backend/api/*
              └── Express server/index.ts (port 3001)
                    └── StashcatClient (stashcat-api)
                          └── api.stashcat.com / api.schul.cloud
```

- The backend holds one `StashcatClient` instance per user session (keyed by Bearer token).
- Sessions survive server restarts: serialized state is AES-256-GCM encrypted in `.sessions.json` via `server/session-store.ts`.
- E2E decryption is performed server-side (Node.js `crypto`); the browser always receives plaintext.
- Real-time push: `RealtimeManager` (Socket.io) → Express SSE → browser `EventSource`.

### Reply Messages

- When sending a reply, the frontend sets `reply_to_id` on the optimistic message.
- The `stashcat-api` converts this to `reply_to` (Number) in the API request — **the stashcat backend expects `reply_to`, not `reply_to_id`**.
- The SSE echo returns `reply_to: null` for own messages, but `loadMessages()` returns the full `reply_to` object from the server.
- The SSE handler preserves `reply_to` from the optimistic update when the server returns null.
- The rendering code uses `messageMap` to resolve `reply_to.message_id` to the actual message for display in `ReplyQuote`.

### Session Token

- Generated at login (`crypto.getRandomValues`), returned as `{ token }` to the frontend.
- Stored in `localStorage` under key `schulchat_token`.
- Sent as `Authorization: Bearer <token>` on all API requests.
- Also accepted as `?token=<token>` query parameter for `EventSource` and file download URLs (which cannot set headers).
- Token payload contains either `securityPassword` (legacy login) or `privateKeyJwk` (device-to-device login).
- Sessions survive server restarts only if `SESSION_SECRET` env var is set; otherwise they are ephemeral.

---

## Key Files

```
src/
├── api.ts                          # All frontend → backend HTTP calls (incl. phased login)
├── types.ts                        # ChatTarget, LoginDevice, and other shared types
├── App.tsx                         # Root layout and panel orchestration
├── main.tsx                        # React entry point, context providers
├── pages/
│   └── LoginPage.tsx               # Multi-step login wizard (credentials → method choice → password or device code)
├── components/
│   ├── Sidebar.tsx                 # Channel/conversation list, search, resize (persistent width)
│   ├── SidebarHeader.tsx           # User avatar, name, action buttons (notifications, files, theme, settings, logout)
│   ├── SidebarFooter.tsx           # Broadcasts, calendar, polls footer buttons
│   ├── ChatItem.tsx                # Single chat list item (channel/conversation) with favorite toggle
│   ├── ChatView.tsx                # Message list, send bar, header toolbar, inline cards, date-range search, service link buttons
│   ├── MessageInput.tsx            # Text input, emoji picker, file picker, poll/event creation
│   ├── FileBrowserPanel.tsx        # File browser (folders, upload, download, rename, delete, preview)
│   ├── ChannelMembersPanel.tsx     # Channel member management
│   ├── ChannelDescriptionEditor.tsx# Inline description edit
│   ├── ChannelDropdownMenu.tsx     # Channel toolbar: info modal, markdown export, delete
│   ├── ChannelDiscoveryModal.tsx   # Discover and join public channels
│   ├── NewChannelModal.tsx         # Create channel form
│   ├── NewChatModal.tsx            # New direct message: user search
│   ├── CreatePollModal.tsx         # Create poll form with channel/conversation targeting
│   ├── CreateEventModal.tsx        # Create calendar event with preselected chat context
│   ├── PollsView.tsx               # Poll listing, detail view, voting, voter dropdown
│   ├── CalendarView.tsx            # Calendar (month/week), event detail, RSVP
│   ├── BroadcastsPanel.tsx         # Broadcast messages panel
│   ├── NotificationsPanel.tsx      # Notification center
│   ├── FavoriteCardsView.tsx       # Home view: favorite channels as cards
│   ├── ProfileModal.tsx            # User profile modal
│   ├── FolderUploadProgress.tsx    # Progress indicator for folder uploads
│   ├── LinkPreviewCard.tsx         # OG preview card for URLs in messages
│   ├── Avatar.tsx                  # Avatar with initials fallback
│   ├── SettingsPanel.tsx           # View toggle settings, notification settings
│   └── EmptyState.tsx              # No-chat-selected placeholder
├── context/
│   ├── AuthContext.tsx             # Auth state, login/logout, current user
│   ├── ThemeContext.tsx            # Dark/light toggle (class on <html>)
│   └── SettingsContext.tsx         # UI settings (bubble view, inline images, notifications)
├── hooks/
│   ├── useRealtimeEvents.ts        # SSE EventSource, dispatches events, reconnect detection
│   ├── useNotifications.ts         # Browser Notification API (OS notifications)
│   ├── useFaviconBadge.ts          # Canvas-based red badge on favicon
│   └── useFileSorting.ts           # File browser sorting logic (name, date, size)
└── utils/
    └── fileIcon.ts                 # Extension/MIME → icon name

server/
├── index.ts                        # All Express routes + SSE + realtime bridge + phased login endpoints
├── session-store.ts                # AES-256-GCM encrypted .sessions.json
└── token-crypto.ts                 # AES-256-GCM session token encryption/decryption (stateless)
```

---

## Tailwind CSS v4 Dark Mode

Tailwind v4 does not use `darkMode: 'class'` in a config file. Instead, dark-mode variants are written directly in CSS using the `@variant` directive:

```css
@variant dark (&:where(.dark, .dark *));
```

`ThemeContext` toggles the `.dark` class on the `<html>` element. All dark-mode styles use standard `dark:` Tailwind utilities, which resolve via the above `@variant` rule.

Do not add a `tailwind.config.*` file — v4 is config-file-free by default.

---

## API Layer

`src/api.ts` is the sole frontend HTTP client. It talks to the Express backend at `/backend/api` using `fetch` with a Bearer token. It provides typed wrappers for every backend endpoint.

**Phased login functions** (for device-to-device key transfer):
- `loginCredentials(email, password)` — logs in without E2E, returns `preAuthToken`
- `loginFinalizeWithPassword(preAuthToken, securityPassword)` — unlocks E2E with password, returns session token
- `initiateDeviceKeyTransfer(preAuthToken)` — triggers Socket.io key transfer to existing devices
- `loginFinalizeWithDeviceCode(preAuthToken, code)` — decrypts received key with code, returns session token
- `persistToken(token)` — stores token in localStorage and module state

Key patterns in `api.ts`:
- `get<T>(path)` and `post<T>(path, body)` are internal helpers.
- File operations that need `DELETE` or `PATCH` use raw `fetch` calls (not the helpers) because the helpers only support GET and POST.
- `fileDownloadUrl(fileId, name)` and `fileViewUrl(fileId, name)` return URLs with `?token=` embedded, used directly as `<a href>` and `<iframe src>`.
- `uploadFile(type, targetId, file, text)` posts to `/upload/:type/:targetId` (sends file as message attachment).
- `uploadToStorage(type, typeId, file, folderId)` posts to `/files/upload` (file browser storage upload).

---

## Server Endpoints

All routes are under `/api/` prefix on port 3001.

| Method | Path | Description |
| ------ | ---- | ----------- |
| POST | `/api/login` | Login with security password (legacy), create StashcatClient, start realtime, return token |
| POST | `/api/login/credentials` | Login without E2E (email+password only), returns `preAuthToken` |
| POST | `/api/login/password` | Finalize login with security password using `preAuthToken` |
| POST | `/api/login/device/initiate` | Trigger device-to-device key transfer via Socket.io, returns immediately |
| POST | `/api/login/device/complete` | Finalize device login with 6-digit code, decrypts key locally, returns token |
| POST | `/api/logout` | Logout, destroy session |
| GET | `/api/me` | Current user info |
| GET | `/api/companies` | List companies |
| GET | `/api/channels/:companyId` | List subscribed channels |
| GET | `/api/channels/:channelId/members` | Channel member list |
| POST | `/api/channels/:channelId/invite` | Invite users to channel |
| DELETE | `/api/channels/:channelId/members/:userId` | Remove member from channel |
| POST | `/api/channels/:channelId/moderator/:userId` | Promote to moderator |
| DELETE | `/api/channels/:channelId/moderator/:userId` | Demote from moderator |
| PATCH | `/api/channels/:channelId` | Edit channel (description) |
| POST | `/api/channels` | Create new channel |
| GET | `/api/channels/:channelId/info` | Get full channel info (type, encryption, member count, description) |
| DELETE | `/api/channels/:channelId` | Delete channel |
| GET | `/api/companies/:companyId/members` | Company member list |
| POST | `/api/conversations` | Create encrypted conversation |
| GET | `/api/conversations` | List conversations |
| GET | `/api/conversations/:id` | Get single conversation with members |
| GET | `/api/messages/:type/:targetId` | Get messages (with auto-decrypt) |
| GET | `/api/messages/:type/:targetId/search` | Date-range message search (with E2E decrypt + optional text filter) |
| POST | `/api/messages/:type/:targetId` | Send message |
| DELETE | `/api/messages/:messageId` | Delete message |
| POST | `/api/messages/:messageId/like` | Like message |
| POST | `/api/messages/:messageId/unlike` | Unlike message |
| POST | `/api/messages/:type/:targetId/read` | Mark as read |
| POST | `/api/typing` | Forward typing indicator via Socket.io |
| GET | `/api/files/folder` | List folder contents |
| GET | `/api/files/personal` | List personal files |
| POST | `/api/files/delete` | Delete file(s) |
| POST | `/api/files/folder/create` | Create new folder |
| POST | `/api/folder/delete` | Delete folder |
| PATCH | `/api/files/:fileId` | Rename file |
| POST | `/api/files/upload` | Upload to file storage (multer) |
| GET | `/api/file/:fileId` | Download / view file (binary stream) |
| POST | `/api/upload/:type/:targetId` | Upload file as message attachment |
| GET | `/api/link-preview` | Fetch OG/meta preview for a URL |
| POST | `/api/video/start-meeting` | Start a Jitsi video meeting via Chat Bot |
| GET | `/api/calendar/events` | List calendar events by date range |
| GET | `/api/calendar/events/:id` | Get single calendar event |
| POST | `/api/calendar/events` | Create event (+ optional chat notification) |
| PUT | `/api/calendar/events/:id` | Edit event |
| DELETE | `/api/calendar/events/:id` | Delete event |
| POST | `/api/calendar/events/:id/respond` | RSVP (accepted/declined/open) |
| GET | `/api/calendar/channels/:companyId` | Channels with calendar events |
| GET | `/api/polls` | List polls (created/invited/archived) |
| GET | `/api/polls/:id` | Get poll detail with questions and answers |
| POST | `/api/polls` | Create poll (+ chat notifications) |
| DELETE | `/api/polls/:id` | Delete poll |
| POST | `/api/polls/:id/vote` | Submit vote |
| GET | `/api/events` | SSE stream for realtime events |

---

## Code Conventions

- **TypeScript strict mode** — no implicit `any`, no unchecked indexing.
- **Functional components only** — no class components.
- **React 19** — use standard hooks (`useState`, `useEffect`, `useCallback`, `useRef`, `useMemo`).
- API response shapes are typed via interfaces in `src/types.ts` (`User`, `Company`, `Channel`, `Conversation`). The `api.ts` helpers (`get`, `post`, `del`, `patch`, `put`) return typed responses — avoid `Record<string, unknown>`.
- Context values (e.g. `AuthContext`) are memoized with `useMemo` to prevent unnecessary re-renders.
- Use `clsx` for conditional class names.
- Icon imports come from `lucide-react` (tree-shaken per icon).
- Large components are decomposed into focused sub-components (e.g. `Sidebar` → `SidebarHeader`, `SidebarFooter`, `ChatItem`).

---

## Security Hardening

### SSRF Protection (Link Preview)

The `/api/link-preview` endpoint fetches arbitrary URLs to extract Open Graph metadata. To prevent Server-Side Request Forgery (SSRF), the endpoint:

1. **Validates the URL** against a blocklist of private/internal IP ranges (127.x, 10.x, 172.16-31.x, 192.168.x, 169.254.x, localhost, IPv6 loopback, fc/fd ranges).
2. **Uses `redirect: 'manual'`** instead of `redirect: 'follow'` to inspect redirect targets before following them.
3. **Re-checks the blocklist** on redirect targets to prevent DNS rebinding or redirect-based SSRF.

### Error Response Sanitization

Server error responses (`res.status(500).json(...)`) never include `stack` traces or internal error details beyond the error message. Stack traces are logged server-side via `debugLog()` for debugging but not exposed to clients.

### Unified Error Handling

All catch blocks in `server/index.ts` use the `errorMessage(err, fallback)` helper to safely extract error messages from unknown catch values. This replaces inconsistent patterns like `(e as Error).message` or inline ternaries, ensuring no stack traces leak to clients.

### Rate Limiting

`express-rate-limit` is applied to all `/api/` routes (120 requests per minute per IP). The SSE endpoint (`/api/events`) is exempt because it uses long-lived connections.

### Session Store File Locking

`session-store.ts` uses an async mutex (`withFileLock()`) to serialize all read-modify-write operations on `.sessions.json`, preventing race conditions when multiple concurrent requests save or delete sessions simultaneously.

---

## Known Patterns

### isManager Detection

The Stashcat API does not return a clean `isManager: boolean` field. Manager status is detected by checking the `manager` field on a channel member object (not a `role` string from the API response). In `ChannelMembersPanel`, member objects returned by `getChannelMembers()` include a truthy `manager` field for moderators.

### File Listing

The folder listing API (`/folder/get`) returns either `content.file` (singular, one file) or `content.files` (array). The server normalizes this into `{ folder: [...], files: [...] }` before returning to the frontend, so `FileBrowserPanel` always receives an array.

### File Browser Tab Default

When the file browser is opened from a chat/channel (via the icon in the chat header), it **always defaults to the channel/conversation files tab** ("Dateien"), regardless of the previously persisted tab selection. The user can still manually switch to "Meine Dateien" via the tab bar. This is implemented by tracking the `chat.id` via a ref in `FileBrowserPanel` and resetting the tab to `'context'` whenever the chat changes.

### Realtime (SSE + Socket.io)

Two layers:

1. **Socket.io** (`RealtimeManager` from `stashcat-api`): connects to `push.stashcat.com` per session after login. Receives `message_sync` and `user-started-typing` events.
2. **SSE** (`/api/events`): the browser subscribes via `EventSource`. The server's `pushSSE()` helper fans out Socket.io events to all connected SSE clients for that session.

`useRealtimeEvents.ts` opens the `EventSource` and dispatches events to registered handler callbacks. It detects SSE reconnections (via `onopen` after `onerror`) and dispatches a synthetic `reconnect` event, allowing consumers (Sidebar, ChatView) to re-fetch missed data automatically.

E2E-encrypted `message_sync` events are decrypted by the server (using `getConversationAesKey()` or `getChannelAesKey()`) before being pushed over SSE.

### Browser OS Notifications

The app uses the browser Notification API (not push/service worker) to show OS-level notifications when new messages arrive while the tab is in the background:

- **Hook**: `useNotifications.ts` encapsulates permission management and `notify()` logic.
- **Permission**: Requested lazily on first `message_sync` event (not on app load) for better UX.
- **Display rules**: Only shown when `document.hidden === true`, `notificationsEnabled` setting is on, and permission is `'granted'`.
- **Tag**: Uses `tag: 'stashcat-msg'` so rapid messages replace each other instead of stacking.
- **Settings toggle**: "Desktop-Benachrichtigungen" in SettingsPanel, persisted in localStorage.
- **Favicon badge**: `useFaviconBadge.ts` draws a red dot with unread count on the favicon via Canvas overlay (independent of OS notifications).

### Video Meetings (Jitsi via Chat Bot)

Stashcat provides video conferencing via a built-in "Chat Bot". The integration automates this flow:

1. **User clicks the Video icon** in the chat header (available in both channels and conversations).
2. **Server sends `/meet`** to the Chat Bot's 1:1 conversation automatically.
3. **Server polls** for the bot's two response messages (invite link + moderator link), parsing `stash.cat/l/` URLs.
4. **Moderator link** opens in a new browser tab (Jitsi conference).
5. **Invite link** is posted as a formatted message in the current chat, rendered as a `VideoMeetingCard` with a "Jetzt beitreten" button.

Chat Bot suppression:
- The bot's conversation is **filtered from the sidebar** (GET `/api/conversations` strips it).
- Bot messages are **suppressed from SSE** (realtime `message_sync` events from the bot conversation are dropped).
- Bot discovery result is cached per session in `botCache`.

Key components:
- `server/index.ts`: `findChatBot()`, `POST /api/video/start-meeting`, `isBotConversation()`, `isBotMessage()`
- `src/api.ts`: `startVideoMeeting(targetId, targetType)`
- `src/components/ChatView.tsx`: Video button in header, `VideoMeetingCard` component, `isVideoMeetingMessage()` detector

### Panel Toggle Behavior

All sidebar panels (Settings, FileBrowser, Broadcasts, Notifications, Profile, Calendar, Polls) follow a toggle pattern: first click opens, second click closes. This is implemented by capturing the current state *before* calling `closeAllPanels()`, then only opening if it wasn't already open. Calendar and Polls toggle `activeView` between `'chat'` and their respective view.

### Persistent Sidebar Widths

Both the left sidebar and right file browser panel widths are persisted in `localStorage`:
- `schulchat_sidebar_width` (default: 360px, range: 200–480px)
- `schulchat_filebrowser_width` (default: 384px, range: 280–600px)

Saved on `mouseup` after resize, restored on component mount.

### Polls (Create, Vote, Notify)

Polls are created via `CreatePollModal` (accessible from the paperclip dropdown in `MessageInput`). The server creates the poll, invites channels/conversations, publishes it, and sends notification messages to all targets. These messages embed a `[%poll:ID%]` marker that `ChatView` detects via `isPollInviteMessage()` and renders as a `PollInviteMessage` card. Clicking the card navigates to the poll in `PollsView`.

Voter names are visible based on poll `privacy_type`:
- `open`: names visible to everyone
- `hidden`: names visible to poll creator only
- `anonymous`: no names shown

The voter dropdown uses a React Portal (`createPortal`) to render into `document.body`, avoiding clipping by `overflow` containers.

### Calendar Events (Create from Chat)

`CreateEventModal` is a standalone component used both from `CalendarView` and from the paperclip dropdown in `MessageInput`. When opened from a chat, `preselectedChat` auto-selects:
- **Channel**: Category set to "Channel", channel pre-selected in `inviteChannelIds`
- **Conversation**: Category set to "Persönlich", members loaded via `GET /api/conversations/:id` and pre-selected as `inviteUserIds`

After creation, the server sends a notification message to the source chat with a `[%event:ID%]` marker. `ChatView` detects this via `isCalendarEventMessage()` and renders a `CalendarEventCard`.

### File Preview on Click

Files in the FileBrowser can be opened with a single click on the card/row for known previewable formats. The `canPreview()` function checks MIME type (image, PDF, text, audio, video). Images open in the lightbox, PDFs in an iframe modal, others in a new browser tab. Ctrl/Cmd+Click still toggles multi-selection. Action buttons (Download, Rename, Delete) use `e.stopPropagation()` to prevent preview.

### Service Link Buttons in Channel Header

Channel descriptions can contain links to school services. `extractServiceLinks()` in `ChatView.tsx` parses the description and detects URLs matching these patterns:

| URL prefix | Button label | Color | Icon |
|---|---|---|---|
| `https://moodle.bbz…` | Moodle | Orange | GraduationCap (lucide) |
| `https://portal.bbz…` | Moodle | Orange | GraduationCap (lucide) |
| `https://bbb.bbz…` | BBB | Blue | "B" text |
| `https://bbzrdeck.taskcards…` | TaskCards | Teal | "T" text |

Detected links — and any text preceding them on the same segment — are stripped from the visible description. Since channel descriptions are always single-line, the regex `[^\n]*URL` effectively removes all text before the URL up to the line start. Any text appearing *after* a service URL remains in the description. Colored `<a>` buttons appear in the channel header toolbar, opening the link in a new tab.

### Date-Range Message Search

ChatView includes a date-range search mode that queries the Stashcat `/search/messages` endpoint directly (not wrapped by `stashcat-api`). The server endpoint `GET /api/messages/:type/:targetId/search` calls `client.api.post('/search/messages', data)` with `createAuthenticatedRequestData()`, then E2E-decrypts results using the same pattern as the regular messages endpoint.

**Query parameters:** `startDate` (Unix ts), `endDate` (Unix ts), `query` (optional text filter), `offset`, `limit`.

**UI flow:** Calendar icon in the search bar toggles `dateSearchMode`. Two `<input type="date">` fields + "Suchen" button trigger the search. Results appear in a compact list below the search bar. Clicking a result replaces the message view with search results and scrolls to the selected message. A banner with "Zurück zur aktuellen Ansicht" restores the normal view.

**State management:** `savedMessagesRef` preserves the current messages/hasMore/offset before replacing with search results. `restoreMessages()` restores them or calls `loadMessages()` as fallback.

### Session Restore on Server Restart

At startup, `server/index.ts` loads `.sessions.json` via `session-store.ts` and restores each serialized `StashcatClient` via `StashcatClient.fromSession()`. It then calls `unlockE2E()` using the stored security password (or `unlockE2EWithPrivateKey()` if the session was created via device-to-device transfer) and reconnects the `RealtimeManager`. Clients whose sessions are no longer valid on the Stashcat server will silently fail and be dropped.

### File Upload (Resumable Chunked Upload)

Stashcat uses a two-step resumable upload API:

**Step 1: `POST /file/create_upload_context`** (URL-encoded)
- Request fields: `filename`, `mime`, `filesize`, `num_total_chunks`, `chunk_size`, `folder_type`, `folder_type_id`, `folder_id` (optional), plus auth fields (`client_key`, `device_id`, `identifier`)
- Response: `{ identifier: "..." }` — a unique upload identifier

**Step 2: `POST /file/upload_chunk`** (Multipart/form-data)
- Request fields: `client_key`, `device_id`, `identifier`, `current_chunk_number`, `current_chunk_size`, plus file chunk
- File field name: `-` (literal dash), Content-Type: `application/octet-stream`
- Response: `{ status: { value: "OK" } }` or final response with `{ payload: { file: FileInfo } }`

**Important:** The `folder_*` fields are ONLY sent in step 1. Step 2 only needs the `identifier` to associate the chunk with the upload context.

The implementation in `stashcat-api/src/files/files.ts` uses the `form-data` package for correct multipart encoding in Node.js. Native Node.js `FormData`/`Blob` may not produce compatible output.

---

## Bash Commands

When using Bash tool on Windows, output may not be captured directly. Always redirect output to a temporary file and read it with the Read tool:

```bash
# Good: Redirect to temp file
some_command > /tmp/output.txt 2>&1

# Then read the output
# Read /tmp/output.txt
```

---

## Device-to-Device E2E Key Transfer (Reverse-Engineered)

### Overview

Users can log in on a new device without entering their security password by having an already logged-in device (e.g., mobile app) confirm the login via a 6-digit code.

### Protocol Discovery (2026-04-11)

The flow was reverse-engineered by observing the official `schul.cloud` web client's Socket.io traffic:

1. **`loginWithoutE2E`** — New device logs in with email/password only (no `securityPassword`)
2. **Socket.io connect** to `push.stashcat.com` — sends `userid` (auto by RealtimeManager)
3. **`new_device_connected`** — Server sends this event back, confirming auth. Contains `device_id` and `ip_address`
4. **`key_sync_request`** — Client emits: `socket.emit('key_sync_request', own_device_id, own_client_key)`
   - First param: the new device's `device_id`
   - Second param: the new device's `client_key` (NOT the target device's ID)
   - The push server forwards this to all existing devices of this user
5. **Target device shows 6-digit code** — After user confirms on mobile, the mobile wraps the KEK and uploads the encrypted key
6. **`key_sync_payload`** — Server sends back to the new device:
   ```json
   {
     "device_id": "<target_device_id>",
     "payload": {
       "encrypted_private_key_jwk": {
         "ciphertext": "<base64>",
         "iv": "<base64>",
         "key_derivation_properties": {
           "salt": "<base64>",
           "iterations": 650000,
           "prf": "sha-256"
         }
       }
     }
   }
   ```
7. **Decrypt** — KEK = PBKDF2(code, salt, iterations, 32, sha256), then AES-256-CBC decrypt ciphertext with KEK → RSA private key JWK

### Critical Findings

| Finding | Detail |
|---------|--------|
| `key_sync_request` params | `(own_device_id, own_client_key)` — NOT target device IDs |
| `new_device_connected` | Signals that existing devices came online, NOT our new device |
| `encrypted_private_key_jwk` | Is a JSON **object** (with ciphertext, iv, etc.), not a string |
| Socket auth order | Must wait for `new_device_connected` before emitting `key_sync_request` |
| Push server routing | Forwards `key_sync_request` to ALL existing devices automatically |
| 6-digit code | Never sent to server — used locally for PBKDF2 KEK derivation |

### Implementation in stashcat-chat

**Server-side flow** (`server/index.ts`):
1. `POST /api/login/credentials` → `loginWithoutE2E` → creates preAuth cache entry
2. `POST /api/login/device/initiate` → fire-and-forget Socket.io connection to push.stashcat.com, emits `key_sync_request`, payload stored asynchronously in preAuth cache
3. `POST /api/login/device/complete` → polls cache (up to 30s) for `encryptedKeyData`, decrypts with code via PBKDF2, creates session with `privateKeyJwk`
4. `POST /api/login/password` → legacy password flow (alternative to device flow)

**Session token** (`server/token-crypto.ts`):
```typescript
interface SessionPayload {
  deviceId: string;
  clientKey: string;
  baseUrl: string;
  securityPassword?: string;     // Legacy password flow
  privateKeyJwk?: RsaPrivateKeyJwk; // Device-to-device flow
}
```

**`getClient()` branching**: On session restore, checks `securityPassword` first, then `privateKeyJwk`, calling `unlockE2E()` or `unlockE2EWithPrivateKey()` accordingly.

### Dependencies

- `stashcat-api` must have the following methods:
  - `loginWithoutE2E({email, password})` — login without E2E unlock
  - `unlockE2EWithPrivateKey(jwk: RsaPrivateKeyJwk)` — unlock E2E with pre-decrypted JWK
  - `exportPrivateKey(): RsaPrivateKeyJwk | undefined` — export decrypted JWK
- `RsaPrivateKeyJwk` type imported from `stashcat-api`

### Frontend Flow (`src/pages/LoginPage.tsx`)

Multi-step wizard state machine:
1. **credentials** → E-Mail + Passwort → "Weiter" → `loginCredentials()` → method-choice
2. **method-choice** → Two buttons: "Mit Verschlüsselungspasswort" or "Durch ein anderes Gerät"
3. **password-entry** → Verschlüsselungspasswort → `loginFinalizeWithPassword()` → done
4. **code-entry** → 6-digit code → `loginFinalizeWithDeviceCode()` → done

The device flow button immediately triggers `initiateDeviceKeyTransfer()` (server connects to push.stashcat.com, emits `key_sync_request`) and switches to code entry. The user confirms on their mobile device, enters the code, and the server decrypts the key locally.
