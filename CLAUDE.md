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

**Code-Verifikation**: Änderungen werden überprüft durch `npm run build` (muss fehlerfrei durchlaufen) und anschließend Live-Test auf dem Server, den der User durchführt. Kein automatischer Preview-Browser-Test.

---

## Dev Commands

```bash
npm start          # Start both frontend (port 5173) and backend (port 3001) concurrently
npm run dev        # Vite dev server only (frontend)
npm run server     # Express backend only (tsx server/index.ts)
npm run build      # tsc -b + vite build (production)
npm run preview    # Serve production build
npm run lint       # ESLint
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

### Session Token

- Generated at login (`crypto.getRandomValues`), returned as `{ token }` to the frontend.
- Stored in `localStorage` under key `schulchat_token`.
- Sent as `Authorization: Bearer <token>` on all API requests.
- Also accepted as `?token=<token>` query parameter for `EventSource` and file download URLs (which cannot set headers).

---

## Key Files

```
src/
├── api.ts                          # All frontend → backend HTTP calls
├── types.ts                        # ChatTarget and other shared types
├── App.tsx                         # Root layout and panel orchestration
├── main.tsx                        # React entry point, context providers
├── pages/
│   └── LoginPage.tsx               # Login form
├── components/
│   ├── Sidebar.tsx                 # Channel/conversation list, search, resize (default 360px)
│   ├── ChatView.tsx                # Message list, send bar, header toolbar
│   ├── MessageInput.tsx            # Text input, emoji picker, file picker
│   ├── FileBrowserPanel.tsx        # File browser (folders, upload, download, rename, delete)
│   ├── ChannelMembersPanel.tsx     # Channel member management
|   ├── ChannelDescriptionEditor.tsx# Inline description edit
|   ├── ChannelDropdownMenu.tsx     # Channel toolbar: info modal, markdown export, delete
│   ├── NewChannelModal.tsx         # Create channel form
│   ├── NewChatModal.tsx            # New direct message: user search
│   ├── LinkPreviewCard.tsx         # OG preview card for URLs in messages
│   ├── Avatar.tsx                  # Avatar with initials fallback
│   ├── SettingsPanel.tsx           # View toggle settings
│   └── EmptyState.tsx              # No-chat-selected placeholder
├── context/
│   ├── AuthContext.tsx             # Auth state, login/logout, current user
│   ├── ThemeContext.tsx            # Dark/light toggle (class on <html>)
│   └── SettingsContext.tsx         # UI settings (bubble view, inline images)
├── hooks/
│   ├── useRealtimeEvents.ts        # SSE EventSource, dispatches events
│   └── useFileSorting.ts           # File browser sorting logic (name, date, size)
└── utils/
    └── fileIcon.ts                 # Extension/MIME → icon name

server/
├── index.ts                        # All Express routes + SSE + realtime bridge
└── session-store.ts                # AES-256-GCM encrypted .sessions.json
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
| POST | `/api/login` | Login, create StashcatClient, start realtime, return token |
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
| GET | `/api/messages/:type/:targetId` | Get messages (with auto-decrypt) |
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
| GET | `/api/events` | SSE stream for realtime events |

---

## Code Conventions

- **TypeScript strict mode** — no implicit `any`, no unchecked indexing.
- **Functional components only** — no class components.
- **React 19** — use standard hooks (`useState`, `useEffect`, `useCallback`, `useRef`).
- All API response shapes from the backend are typed at the call site in `api.ts` or with local interfaces in the component.
- Use `clsx` for conditional class names.
- Icon imports come from `lucide-react` (tree-shaken per icon).

---

## Known Patterns

### isManager Detection

The Stashcat API does not return a clean `isManager: boolean` field. Manager status is detected by checking the `manager` field on a channel member object (not a `role` string from the API response). In `ChannelMembersPanel`, member objects returned by `getChannelMembers()` include a truthy `manager` field for moderators.

### File Listing

The folder listing API (`/folder/get`) returns either `content.file` (singular, one file) or `content.files` (array). The server normalizes this into `{ folder: [...], files: [...] }` before returning to the frontend, so `FileBrowserPanel` always receives an array.

### Realtime (SSE + Socket.io)

Two layers:

1. **Socket.io** (`RealtimeManager` from `stashcat-api`): connects to `push.stashcat.com` per session after login. Receives `message_sync` and `user-started-typing` events.
2. **SSE** (`/api/events`): the browser subscribes via `EventSource`. The server's `pushSSE()` helper fans out Socket.io events to all connected SSE clients for that session.

`useRealtimeEvents.ts` opens the `EventSource` and emits custom DOM events or calls callbacks that components subscribe to.

E2E-encrypted `message_sync` events are decrypted by the server (using `getConversationAesKey()` or `getChannelAesKey()`) before being pushed over SSE.

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

### Session Restore on Server Restart

At startup, `server/index.ts` loads `.sessions.json` via `session-store.ts` and restores each serialized `StashcatClient` via `StashcatClient.fromSession()`. It then calls `unlockE2E()` using the stored security password and reconnects the `RealtimeManager`. Clients whose sessions are no longer valid on the Stashcat server will silently fail and be dropped.

---

## Bash Commands

When using Bash tool on Windows, output may not be captured directly. Always redirect output to a temporary file and read it with the Read tool:

```bash
# Good: Redirect to temp file
some_command > /tmp/output.txt 2>&1

# Then read the output
# Read /tmp/output.txt
```
