# stashcat-chat

A modern web chat UI for [Stashcat](https://www.stashcat.com/) / schul.cloud, built with React 19, TypeScript, Vite, and Tailwind CSS v4. Comparable to MS Teams / Slack / Element in terms of UX.

## Features

- Login with email, password, and security password (E2E unlock)
- Two-panel resizable sidebar: Channels (left) and Direct Messages (right)
- Favorites pinned to the top of each list
- Chat bubble view (own messages right/blue, others left/gray)
- Full Markdown support with formatting toolbar (Bold, Italic, Strikethrough, Code, Heading, List)
- Emoji picker (`emoji-picker-react`)
- File upload via paperclip button (original filename preserved)
- File download links with MIME-based emoji icons
- Delete own messages (hover → trash icon); channel managers can delete any message
- Copy message text to clipboard (hover → copy icon)
- Chats sorted by latest activity within each group (favorites / non-favorites)
- Unread badge updates in real-time via SSE; clears when chat is opened
- Like messages with 👍 (shown on hover; count displayed per message)
- Channel description shown below channel name in header
- Infinite scroll: automatically loads 50 older messages when scrolling to the top
- Settings sidebar (gear icon): toggle inline image display and bubble/text view
- E2E-encrypted messages decrypted automatically (RSA-4096 OAEP + AES-256-CBC)
- Real-time push: new messages and typing indicators via Server-Sent Events (SSE)
- Dark / light theme toggle, persisted in localStorage
- Session persistence via localStorage token

## Architecture

```
stashcat-chat/
├── src/
│   ├── api.ts                  # Backend API client (fetch + Bearer token)
│   ├── components/
│   │   ├── ChatView.tsx        # Message bubbles, file attachments, realtime
│   │   ├── MessageInput.tsx    # Text input, emoji picker, file picker, toolbar
│   │   ├── Sidebar.tsx         # Resizable channel/DM panels with favorites
│   │   └── Avatar.tsx          # Initials avatar
│   ├── context/
│   │   ├── AuthContext.tsx     # Login, logout, session restore
│   │   └── ThemeContext.tsx    # Dark/light toggle
│   ├── hooks/
│   │   └── useRealtimeEvents.ts # SSE listener (message_sync, typing)
│   └── utils/
│       └── fileIcon.ts         # MIME/extension → emoji
└── server/
    └── index.ts                # Express backend (port 3001)
                                # - Proxies all Stashcat API calls
                                # - Manages StashcatClient sessions
                                # - Bridges RealtimeManager → SSE
                                # - Decrypts E2E messages before SSE push
```

The **Express backend** is required because E2E decryption uses Node.js `crypto` (not available in the browser) and to avoid CORS issues with `api.stashcat.com`. The Vite dev server proxies `/backend → http://localhost:3001`.

## Getting Started

### Prerequisites

- Node.js 20+
- A Stashcat / schul.cloud account

### Install

```bash
# 1. Build the stashcat-api library first (local file dependency)
cd ../stashcat-api
npm install && npm run build

# 2. Install chat UI dependencies
cd ../stashcat-chat
npm install
```

### Run

```bash
npm start
# Starts both the Vite dev server (port 5173) and Express backend (port 3001)
```

Open [http://localhost:5173](http://localhost:5173).

### Scripts

| Script | Description |
|--------|-------------|
| `npm start` | Start frontend + backend (via `concurrently`) |
| `npm run dev` | Vite dev server only |
| `npm run server` | Express backend only (`tsx server/index.ts`) |
| `npm run build` | Production build |
| `npm run lint` | ESLint |

## E2E Encryption

All E2E decryption happens on the **backend**:

- REST API messages: `StashcatClient.getMessages()` decrypts automatically
- Realtime messages: the `message_sync` SSE handler decrypts with `getConversationAesKey()` / `getChannelAesKey()` before forwarding to the frontend

The frontend always receives plaintext.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript, Vite 8, Tailwind CSS v4 |
| Backend | Express, Node.js |
| API Client | `stashcat-api` (local file dep) |
| Realtime | Socket.io v4 → SSE |
| Markdown | `react-markdown` + `remark-gfm` |
| Emoji | `emoji-picker-react` |
| File Upload | `multer` |

## License

MIT
