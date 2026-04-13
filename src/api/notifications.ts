/**
 * Notifications API endpoints.
 */

import { get, post, del } from './core';

export interface AppNotification {
  id: string;
  type: string;
  text?: string;
  content?: unknown;
  time?: number;
  created_at?: string;
  channel?: { id: string; name: string };
  event?: { id: string; name: string };
  survey?: {
    id: string;
    name?: string;
    creator?: { id: string; first_name?: string; last_name?: string };
  };
  sender?: {
    id: string;
    first_name: string;
    last_name: string;
    image?: string;
  };
  read?: boolean;
}

export async function getNotifications(
  limit = 50,
  offset = 0
): Promise<AppNotification[]> {
  return get<AppNotification[]>(
    `/notifications?limit=${limit}&offset=${offset}`
  );
}

export async function getNotificationCount(): Promise<{ count: number }> {
  return get<{ count: number }>('/notifications/count');
}

export async function deleteNotification(
  notificationId: string
): Promise<Record<string, unknown>> {
  return del<Record<string, unknown>>(`/notifications/${notificationId}`);
}

export async function acceptKeySync(
  userId: string,
  notificationId: string
): Promise<{ ok: boolean }> {
  return post<{ ok: boolean }>('/key-sync/accept', { userId, notificationId });
}
