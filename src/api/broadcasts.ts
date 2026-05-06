/**
 * Broadcast messaging API endpoints.
 */

import { get, post, del, patch, getToken, BACKEND } from './core';

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

export async function uploadBroadcastFile(
  listId: string,
  file: File,
  text = '',
  onProgress?: (percent: number) => void,
): Promise<void> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('text', text);
  const token = getToken();

  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BACKEND}/broadcasts/${listId}/upload`);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        try {
          const err = JSON.parse(xhr.responseText) as { error?: unknown };
          const msg = typeof err.error === 'string' ? err.error : `HTTP ${xhr.status}`;
          reject(new Error(msg));
        } catch {
          reject(new Error(`HTTP ${xhr.status}`));
        }
      }
    };
    xhr.onerror = () => reject(new Error('Netzwerkfehler beim Upload'));
    xhr.send(formData);
  });
}
