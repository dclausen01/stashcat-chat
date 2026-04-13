/**
 * Broadcast messaging API endpoints.
 */

import { get, post, del, patch } from './core';

export async function listBroadcasts(): Promise<Array<Record<string, unknown>>> {
  return get<Array<Record<string, unknown>>>('/broadcasts');
}

export async function createBroadcast(
  name: string,
  memberIds: string[]
): Promise<Record<string, unknown>> {
  return post<Record<string, unknown>>('/broadcasts', { name, memberIds });
}

export async function deleteBroadcast(id: string): Promise<void> {
  return del(`/broadcasts/${id}`);
}

export async function renameBroadcast(id: string, name: string): Promise<void> {
  return patch(`/broadcasts/${id}`, { name });
}

export async function getBroadcastMessages(
  id: string,
  limit = 50,
  offset = 0
): Promise<Array<Record<string, unknown>>> {
  return get<Array<Record<string, unknown>>>(
    `/broadcasts/${id}/messages?limit=${limit}&offset=${offset}`
  );
}

export async function sendBroadcastMessage(
  id: string,
  text: string
): Promise<Record<string, unknown>> {
  return post<Record<string, unknown>>(`/broadcasts/${id}/messages`, { text });
}

export async function getBroadcastMembers(
  id: string
): Promise<Array<Record<string, unknown>>> {
  return get<Array<Record<string, unknown>>>(`/broadcasts/${id}/members`);
}

export async function addBroadcastMembers(
  id: string,
  memberIds: string[]
): Promise<void> {
  await post(`/broadcasts/${id}/members`, { memberIds });
}

export async function removeBroadcastMembers(
  id: string,
  memberIds: string[]
): Promise<void> {
  return del(`/broadcasts/${id}/members`, { memberIds });
}
