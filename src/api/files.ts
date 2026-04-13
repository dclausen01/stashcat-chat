/**
 * File browser and storage API endpoints.
 */

import { get, post, patch } from './core';

const BACKEND = import.meta.env.DEV ? '/backend/api' : '/api';

// --- Folder / File Browser ---

export interface FolderContent {
  folder: Array<Record<string, unknown>>;
  files: Array<Record<string, unknown>>;
}

export async function listFolder(
  type: string,
  typeId: string,
  folderId?: string,
  offset = 0,
  limit = 200
): Promise<FolderContent> {
  let url = `/files/folder?type=${encodeURIComponent(type)}&typeId=${encodeURIComponent(typeId)}&offset=${offset}&limit=${limit}`;
  if (folderId) url += `&folderId=${encodeURIComponent(folderId)}`;
  return get<FolderContent>(url);
}

export async function listPersonalFiles(
  folderId?: string,
  offset = 0,
  limit = 200
): Promise<FolderContent> {
  let url = `/files/personal?offset=${offset}&limit=${limit}`;
  if (folderId) url += `&folderId=${encodeURIComponent(folderId)}`;
  return get<FolderContent>(url);
}

export interface FileQuotaEntry {
  kb: number;
  value: string;
  unit: string;
  percent: string;
}

export interface FileQuota {
  absolute: FileQuotaEntry;
  used: FileQuotaEntry;
  free: FileQuotaEntry;
  personal_used?: FileQuotaEntry;
}

export async function getFileQuota(type: string, typeId: string): Promise<FileQuota> {
  return get<FileQuota>(
    `/files/quota?type=${encodeURIComponent(type)}&typeId=${encodeURIComponent(typeId)}`
  );
}

export async function deleteFile(fileId: string): Promise<void> {
  return post('/files/delete', { fileIds: [fileId] });
}

export async function deleteFiles(fileIds: string[]): Promise<void> {
  return post('/files/delete', { fileIds });
}

export async function deleteFolder(folderId: string): Promise<void> {
  return post('/folder/delete', { folderId });
}

export async function renameFile(fileId: string, name: string): Promise<void> {
  return patch(`/files/${fileId}`, { name });
}

export async function moveFile(fileId: string, targetFolderId: string): Promise<void> {
  await post(`/files/${fileId}/move`, { target_folder_id: targetFolderId });
}

export async function createFolder(
  name: string,
  parentId: string,
  type: string,
  typeId: string
): Promise<Record<string, unknown>> {
  return post('/files/folder/create', {
    folder_name: name,
    parent_id: parentId,
    type,
    type_id: typeId,
  });
}

export async function uploadToStorage(
  type: string,
  typeId: string | undefined,
  file: File,
  folderId?: string
): Promise<void> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('type', type);
  if (typeId) formData.append('typeId', typeId);
  if (folderId) formData.append('folderId', folderId);
  const token = localStorage.getItem('schulchat_token') || '';
  const res = await fetch(`${BACKEND}/files/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    const errorMsg = typeof err.error === 'string' ? err.error : JSON.stringify(err.error);
    throw new Error(errorMsg);
  }
}

export function fileDownloadUrl(fileId: string, name: string): string {
  const token = localStorage.getItem('schulchat_token') || '';
  return `${BACKEND}/file/${fileId}?name=${encodeURIComponent(name)}&token=${encodeURIComponent(token)}`;
}

export function fileViewUrl(fileId: string, name: string): string {
  const token = localStorage.getItem('schulchat_token') || '';
  return `${BACKEND}/file/${fileId}?name=${encodeURIComponent(name)}&token=${encodeURIComponent(token)}&view=1`;
}

// --- Link Preview ---

export interface LinkPreview {
  title?: string;
  description?: string;
  image?: string;
  siteName?: string;
}

export async function getLinkPreview(url: string): Promise<LinkPreview> {
  return get<LinkPreview>(`/link-preview?url=${encodeURIComponent(url)}`);
}
