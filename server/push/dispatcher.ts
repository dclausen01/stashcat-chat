/**
 * Push dispatcher: hooks into the existing Realtime/SSE bus, coalesces
 * per-user message bursts, and fans out FCM HTTP v1 calls to all registered
 * device tokens.
 *
 * Coalescing: per (userId,convId/channelId) we keep a queue and flush after
 * `PUSH_BATCH_MS`. Multiple messages within the window collapse to a single
 * "N neue Nachrichten" notification.
 */
import { listForUser, removeToken } from './token-store';
import { sendFcm } from './fcm-client';
import { listMobileTokensForUser } from '../mobile-auth';

const BATCH_MS = Number(process.env.PUSH_BATCH_MS || 2000);

interface PendingEntry {
  userId: string;
  events: Array<{
    title: string;
    body: string;
    deeplink?: string;
    msgId?: string;
    channelName?: string;
    senderName?: string;
    preview?: string;
  }>;
  timer: NodeJS.Timeout;
  unreadCount: number;
}

const pending = new Map<string, PendingEntry>(); // key = userId

export interface IncomingMessageEvent {
  userId: string;
  msgId?: string;
  channelId?: string | null;
  conversationId?: string | null;
  channelName?: string;
  senderName?: string;
  preview: string;
  unreadCount?: number;
}

function silentForUser(userId: string): Promise<boolean> {
  return listMobileTokensForUser(userId).then((records) => {
    if (records.length === 0) return false;
    // If ANY mobile session opted into 'silent', honor it conservatively.
    return records.some((r) => r.pushPreviewMode === 'silent');
  });
}

async function flush(userId: string): Promise<void> {
  const entry = pending.get(userId);
  if (!entry) return;
  pending.delete(userId);

  const tokens = await listForUser(userId);
  console.log(`[Push] flush userId=${userId.slice(0,8)} events=${entry.events.length} tokens=${tokens.length}`);
  if (tokens.length === 0) return;

  const silent = await silentForUser(userId);
  const count = entry.events.length;
  const last = entry.events[entry.events.length - 1];

  let title: string;
  let body: string;
  if (silent) {
    title = 'Neue Nachricht';
    body = '';
  } else if (count > 1) {
    title = `${count} neue Nachrichten`;
    body = last.title ? `Zuletzt in ${last.title}` : '';
  } else {
    title = last.title || 'Neue Nachricht';
    body = last.body;
  }

  // Datenfelder, die Flutter für die Banner-Formatierung + Tap-Routing
  // erwartet. Jedes Feld ist optional → nur senden wenn vorhanden, damit
  // der Mobile-Code die Default-Behandlung greift wenn etwas fehlt.
  const data: Record<string, string> = {};
  if (last.deeplink) data.deeplink = last.deeplink;
  if (last.msgId) data.msgId = last.msgId;
  if (last.channelName) data.channelName = last.channelName;
  if (last.senderName) data.senderName = last.senderName;
  if (!silent && last.preview) data.preview = last.preview;
  if (count > 1) data.coalescedCount = String(count);
  data.unreadCount = String(entry.unreadCount ?? 0);

  await Promise.all(
    tokens.map(async (tok) => {
      const ok = await sendFcm({
        token: tok.token,
        platform: tok.platform,
        title,
        body,
        data,
        badge: entry.unreadCount,
        silent,
      });
      // Don't remove on first failure — FCM transient errors are common.
      // A proper cleanup is wired through periodic prune in token-store.
      if (!ok) {
        // best-effort: if token is structurally invalid (very short), drop.
        if (tok.token.length < 20) await removeToken(tok.token);
      }
    }),
  );
}

export function queueMessageEvent(evt: IncomingMessageEvent): void {
  const key = evt.userId;
  console.log(`[Push] queue userId=${key.slice(0,8)} channelId=${evt.channelId ?? '-'} convId=${evt.conversationId ?? '-'} sender=${evt.senderName ?? '-'}`);
  const existing = pending.get(key);
  const target = evt.channelId ? `c/${evt.channelId}` : evt.conversationId ? `d/${evt.conversationId}` : '';
  const deeplink = evt.channelId
    ? `/c/${evt.channelId}`
    : evt.conversationId
    ? `/d/${evt.conversationId}`
    : undefined;
  // Title/Body-Konvention (WhatsApp-like):
  //  - DM      → title = Sender,   body = "<preview>"
  //  - Channel → title = Channel,  body = "Sender: <preview>"
  const headline = evt.channelName || evt.senderName || 'Neue Nachricht';
  const body = evt.channelName
    ? (evt.senderName ? `${evt.senderName}: ${evt.preview}` : evt.preview)
    : evt.preview;
  const eventEntry = {
    title: headline,
    body,
    deeplink,
    msgId: evt.msgId,
    channelName: evt.channelName,
    senderName: evt.senderName,
    preview: evt.preview,
    target,
  };

  if (existing) {
    clearTimeout(existing.timer);
    existing.events.push(eventEntry);
    if (typeof evt.unreadCount === 'number') existing.unreadCount = evt.unreadCount;
    existing.timer = setTimeout(() => { void flush(key); }, BATCH_MS);
    return;
  }

  pending.set(key, {
    userId: evt.userId,
    events: [eventEntry],
    unreadCount: typeof evt.unreadCount === 'number' ? evt.unreadCount : 0,
    timer: setTimeout(() => { void flush(key); }, BATCH_MS),
  });
}
