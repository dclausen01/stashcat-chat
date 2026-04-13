/**
 * Message-related API endpoints.
 */

import { get, post, del } from './core';

// --- Messages ---

export async function getMessages(
  targetId: string,
  type: 'channel' | 'conversation',
  limit = 40,
  offset = 0
): Promise<Array<Record<string, unknown>>> {
  return get<Array<Record<string, unknown>>>(
    `/messages/${type}/${targetId}?limit=${limit}&offset=${offset}`
  );
}

export async function searchMessages(
  targetId: string,
  type: 'channel' | 'conversation',
  startDate: number,
  endDate: number,
  query?: string,
  offset = 0,
  limit = 100
): Promise<{ messages: Array<Record<string, unknown>>; hasMore: boolean }> {
  const params = new URLSearchParams({
    startDate: String(startDate),
    endDate: String(endDate),
    offset: String(offset),
    limit: String(limit),
  });
  if (query) params.set('query', query);
  return get(`/messages/${type}/${targetId}/search?${params}`);
}

export async function sendMessage(
  targetId: string,
  type: 'channel' | 'conversation',
  text: string,
  opts?: { is_forwarded?: boolean; reply_to_id?: string; files?: string[] }
): Promise<Record<string, unknown>> {
  return post(`/messages/${type}/${targetId}`, { text, ...opts });
}

export async function sendTyping(type: 'channel' | 'conversation', targetId: string): Promise<void> {
  await post('/typing', { type, targetId });
}

// --- Likes ---

export async function likeMessage(messageId: string): Promise<void> {
  return post(`/messages/${messageId}/like`);
}

export interface LikeInfo {
  user: { id: string; first_name: string; last_name: string; image?: string };
  liked_at: number;
}

export async function listLikes(messageId: string): Promise<LikeInfo[]> {
  const data = await get<{ likes: LikeInfo[] }>(`/messages/${messageId}/likes`);
  return data.likes ?? [];
}

export async function unlikeMessage(messageId: string): Promise<void> {
  return post(`/messages/${messageId}/unlike`);
}

// --- Delete ---

export async function deleteMessage(messageId: string): Promise<void> {
  return del(`/messages/${messageId}`);
}

// --- Mark as Read ---

export async function markAsRead(
  targetId: string,
  type: 'channel' | 'conversation',
  messageId?: string
): Promise<void> {
  await post(`/messages/${type}/${targetId}/read`, messageId ? { messageId } : {});
}

// --- Message Flagging (Bookmarks) ---

export async function flagMessage(messageId: string): Promise<void> {
  return post(`/messages/${messageId}/flag`);
}

export async function unflagMessage(messageId: string): Promise<void> {
  return post(`/messages/${messageId}/unflag`);
}

export async function getFlaggedMessages(
  type: 'channel' | 'conversation',
  targetId: string,
  limit = 50,
  offset = 0
): Promise<Array<Record<string, unknown>>> {
  return get<Array<Record<string, unknown>>>(
    `/messages/${type}/${targetId}/flagged?limit=${limit}&offset=${offset}`
  );
}

// --- Video Meeting ---

export async function startVideoMeeting(
  targetId: string,
  targetType: 'channel' | 'conversation'
): Promise<{ inviteLink: string | null; moderatorLink: string | null }> {
  return post<{ inviteLink: string | null; moderatorLink: string | null }>(
    '/video/start-meeting',
    { targetId, targetType }
  );
}

// --- File Upload (chat attachment) ---

export async function uploadFile(
  type: 'channel' | 'conversation',
  targetId: string,
  file: File,
  text = ''
): Promise<void> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('text', text);
  const token = localStorage.getItem('schulchat_token') || '';
  const res = await fetch(
    `${import.meta.env.DEV ? '/backend/api' : '/api'}/upload/${type}/${targetId}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    }
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
}
