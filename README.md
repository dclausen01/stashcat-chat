# BBZ Chat

A React/TypeScript web chat client for Stashcat / schul.cloud, built for BBZ Rendsburg-Eckernförde. Provides a modern browser-based interface over the `stashcat-api` library with full channel and conversation support, E2E encrypted messaging, a file browser, and real-time push events.

---

## Tech Stack

| Layer    | Technology                                               |
| -------- | -------------------------------------------------------- |
| Frontend | React 19, TypeScript 5.9, Vite 8                        |
| Styling  | Tailwind CSS v4, clsx                                    |
| Icons    | lucide-react                                             |
| Markdown | react-markdown + remark-gfm                              |
| Emoji    | emoji-picker-react                                       |
| Backend  | Express 5 (API proxy), tsx (dev runner)                  |
| Uploads  | multer (multipart/form-data)                             |
| Realtime | SSE (Server-Sent Events) + Socket.io (via stashcat-api) |
| API      | stashcat-api (local file dependency)                     |

---

## Features

### Messaging
- Full channel and direct-conversation chat
- E2E encrypted message display (AES-256-CBC, auto-decrypted server-side — frontend always receives plaintext)
- Markdown rendering with GitHub Flavored Markdown support
- Message like / unlike with live count display
- Message delete (own messages on hover; channel managers can delete any message)
- Copy message text to clipboard (hover action)
- File attachments: send files directly in a conversation or channel (original filename preserved)
- File download links with MIME/extension-based icons
- Typing indicators (sent and received in real time)
- Infinite scroll: loads 50 older messages when scrolling to the top
- Mark messages as read when chat is opened
- Unread badge updates in real time via SSE; clears when chat is opened

### Channels
- List all subscribed channels grouped by company
- Favorites sorted to the top, within each group ordered by last activity
- Search/filter channels and conversations in the sidebar
- Create new channels: public, E2E-encrypted, or password-protected; with options for hidden, invite-only, read-only, and member-activity display settings
- Edit channel description inline
- Channel description shown below channel name in header
- Channel members panel: view all members with their roles, invite new users from the company member list, remove members, promote/demote moderators
- Channel dropdown menu (managers only): Channel-Info modal (type, encryption, member count, creation date, description), Markdown export of all messages, delete channel with confirmation

### Conversations
- List all direct conversations
- Start a new direct message to any company member via user search modal
- Favorites sorted to the top

### File Browser
- Browse channel, conversation, or personal file storage
- Navigate folder hierarchies with breadcrumbs
- **Sort files by name, date, or size** (list view)
- **Create new folders** with inline naming
- **Upload entire folder structures** with progress indicator
- Upload files to any storage context
- Download files
- Rename files in place
- Delete files
- Inline PDF viewer
- Image lightbox
- **Persistent view mode** (grid/list) and tab selection

### Link Previews
- Automatic Open Graph / meta-tag preview cards for URLs detected in messages (title, description, image, site name)

### Real-Time
- SSE stream per session delivers new messages and typing events without polling
- Socket.io connection (via `stashcat-api` `RealtimeManager`) bridges push events to SSE clients
- Incoming E2E-encrypted real-time messages are decrypted server-side before delivery

### UI / UX
- Dark and light mode with persistent preference (toggled via sidebar button)
- Resizable sidebar (drag-to-resize handle)
- Bubble view (own messages right/blue, others left/gray) or text view (settings toggle)
- Inline image display toggle (settings panel)
- Avatar images throughout (users, channels)
- BBZ branding (logo, page title)
- Login page with optional separate security password field
- Session persistence across server restarts (sessions encrypted with AES-256-GCM in `.sessions.json`)

### Security
- **SSRF protection**: Link preview endpoint blocks private/internal IP ranges and validates redirect targets
- **Error sanitization**: Unified `errorMessage()` helper ensures no stack traces leak to clients
- **Rate limiting**: API endpoints rate-limited to 120 req/min per IP (SSE exempt via `express-rate-limit`)
- **Session file locking**: Async mutex prevents race conditions in concurrent session store operations

---

## Prerequisites

- **Node.js 20+**
- **stashcat-api** library cloned at `../stashcat-api` (relative to this project) and built

```bash
cd ../stashcat-api
npm install && npm run build
```

---

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your credentials (see Environment Variables below)

# 3. Start development servers (frontend + backend concurrently)
npm start
```

`npm start` starts:
- Express backend on **port 3001** (`tsx server/index.ts`)
- Vite dev server on **port 5173** with `/backend/api` proxied to port 3001

Open [http://localhost:5173](http://localhost:5173).

---

## Available Scripts

| Command           | Description                                  |
| ----------------- | -------------------------------------------- |
| `npm start`       | Start both frontend and backend concurrently |
| `npm run dev`     | Start Vite dev server (frontend only)        |
| `npm run server`  | Start Express backend with tsx               |
| `npm run build`   | TypeScript check + Vite production build     |
| `npm run preview` | Serve the production build locally           |
| `npm run lint`    | ESLint check                                 |

---

## Environment Variables

Create a `.env` file in the project root:

```env
STASHCAT_BASE_URL=https://api.schul.cloud/
STASHCAT_EMAIL=your-email@example.com
STASHCAT_PASSWORD=your-password
STASHCAT_SECURITY_PASSWORD=   # Optional; defaults to STASHCAT_PASSWORD if omitted
STASHCAT_APP_NAME=bbz-chat
STASHCAT_DEVICE_ID=           # Optional; auto-generated if omitted
```

`STASHCAT_SECURITY_PASSWORD` is required for E2E decryption and is usually identical to `STASHCAT_PASSWORD` in the default Stashcat configuration.

---

## Architecture

```
Browser (port 5173)
  └── React app
        └── src/api.ts ──GET/POST──> Express backend (port 3001)
                                           └── stashcat-api (StashcatClient)
                                                 └── Stashcat / schul.cloud API
```

The Express backend acts as an authenticated API proxy:

- Each logged-in browser session maps to a `StashcatClient` instance held in memory on the server.
- Sessions are identified by a random Bearer token stored in `localStorage` (`schulchat_token`). The token is also accepted as a `?token=` query parameter for EventSource and file download URLs.
- Session state (device ID, client key) is persisted to disk via `server/session-store.ts` (AES-256-GCM encrypted `.sessions.json`) so sessions survive server restarts without re-login.
- Real-time events flow: `Socket.io → RealtimeManager → Express SSE stream → Browser EventSource`.
- E2E decryption happens on the backend using Node.js `crypto`; the frontend always receives plaintext.
- The Vite dev server proxies `/backend/api/*` to `http://localhost:3001/api/*`, so the frontend always uses relative URLs.

---

## Component Overview

| File                                          | Responsibility                                                              |
| --------------------------------------------- | --------------------------------------------------------------------------- |
| `src/App.tsx`                                 | Root layout: login gate, sidebar, chat view, file browser, settings panels |
| `src/pages/LoginPage.tsx`                     | Login form (email, password, optional security password)                    |
| `src/components/Sidebar.tsx`                  | Channel/conversation list, search, new chat/channel buttons, resize handle  |
| `src/components/SidebarHeader.tsx`            | User avatar, name, action buttons (notifications, files, theme, settings)   |
| `src/components/SidebarFooter.tsx`            | Footer toolbar: broadcasts, calendar, polls buttons                         |
| `src/components/ChatItem.tsx`                 | Single chat list item (channel/conversation) with favorite star toggle      |
| `src/components/ChatView.tsx`                 | Message list, message rendering, send bar, channel actions toolbar          |
| `src/components/MessageInput.tsx`             | Compose bar: text input, emoji picker, file attachment button               |
| `src/components/FileBrowserPanel.tsx`         | File browser: folder navigation, upload, download, rename, delete, lightbox |
| `src/components/ChannelMembersPanel.tsx`      | Member list, invite users, remove, promote/demote moderators                |
| `src/components/ChannelDescriptionEditor.tsx` | Inline editor for channel description                                       |
| `src/components/NewChannelModal.tsx`          | Create channel modal with all channel type and policy options               |
| `src/components/NewChatModal.tsx`             | Start direct message: search company members, open conversation             |
| `src/components/LinkPreviewCard.tsx`          | OG/meta preview card rendered below URLs in messages                        |
| `src/components/Avatar.tsx`                   | User/channel avatar with fallback initials                                  |
| `src/components/SettingsPanel.tsx`            | User settings panel (view toggles)                                          |
| `src/components/EmptyState.tsx`               | Placeholder shown when no chat is selected                                  |
| `src/context/AuthContext.tsx`                 | Authentication state, login/logout, current user                            |
| `src/context/ThemeContext.tsx`                | Dark/light mode toggle, persists to localStorage                            |
| `src/context/SettingsContext.tsx`             | User-facing settings state (bubble view, inline images)                     |
| `src/hooks/useRealtimeEvents.ts`              | SSE EventSource connection, dispatches message_sync and typing events       |
| `src/api.ts`                                  | All frontend-to-backend HTTP calls (fetch wrapper with Bearer auth)         |
| `src/types.ts`                                | Shared TypeScript types (`ChatTarget`, etc.)                                |
| `src/utils/fileIcon.ts`                       | Maps file extensions/MIME types to icon names                               |
| `server/index.ts`                             | Express server: all `/api/*` routes, session management, SSE, realtime      |
| `server/session-store.ts`                     | AES-256-GCM encrypted session persistence across server restarts            |
