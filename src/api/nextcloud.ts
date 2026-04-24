/**
 * Nextcloud API client module.
 *
 * NC credentials:
 *   - loginPassword: stored in the encrypted session token (set at login)
 *   - appPassword:   stored in localStorage (schulchat_nc_app_password)
 *                    sent as X-NC-App-Password header on every request
 *   - usernameOverride: localStorage (schulchat_nc_username), sent as X-NC-Username
 *
 * The server derives the NC username from the user profile (Last, First)
 * unless overridden.
 */

import { getToken, BACKEND } from './core';

// ── localStorage helpers ──────────────────────────────────────────────────────

const NC_APP_PW_KEY = 'schulchat_nc_app_password';
const NC_USERNAME_KEY = 'schulchat_nc_username';

export function ncGetStoredAppPassword(): string | null {
  return localStorage.getItem(NC_APP_PW_KEY);
}

export function ncSetStoredAppPassword(pw: string): void {
  localStorage.setItem(NC_APP_PW_KEY, pw);
}

export function ncClearStoredAppPassword(): void {
  localStorage.removeItem(NC_APP_PW_KEY);
}

export function ncGetUsernameOverride(): string | null {
  return localStorage.getItem(NC_USERNAME_KEY);
}

export function ncSetUsernameOverride(u: string): void {
  localStorage.setItem(NC_USERNAME_KEY, u);
}

export function ncClearUsernameOverride(): void {
  localStorage.removeItem(NC_USERNAME_KEY);
}

// ── Request helpers ───────────────────────────────────────────────────────────

function ncHeaders(): Record<string, string> {
  const token = getToken();
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  const appPw = ncGetStoredAppPassword();
  if (appPw) headers['X-NC-App-Password'] = appPw;
  const usernameOverride = ncGetUsernameOverride();
  if (usernameOverride) headers['X-NC-Username'] = usernameOverride;
  return headers;
}

async function ncGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BACKEND}${path}`, { headers: ncHeaders() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(typeof err.error === 'string' ? err.error : `NC request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function ncPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BACKEND}${path}`, {
    method: 'POST',
    headers: { ...ncHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(typeof err.error === 'string' ? err.error : `NC request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface NCEntry {
  href: string;
  name: string;
  path: string;
  isFolder: boolean;
  size?: number;
  mime?: string;
  modified?: string;
  etag?: string;
}

export interface NCQuota {
  used: number;
  available: number;
}

export interface NCStatus {
  configured: boolean;
  authMode?: 'ad' | 'app-password';
  username?: string;
  needsAppPassword?: boolean;
}

// ── API functions ─────────────────────────────────────────────────────────────

export async function ncStatus(): Promise<NCStatus> {
  return ncGet<NCStatus>('/nextcloud/status');
}

export async function ncProbeAndDetect(): Promise<NCStatus> {
  return ncGet<NCStatus>('/nextcloud/probe');
}

export async function ncList(path: string): Promise<NCEntry[]> {
  return ncGet<NCEntry[]>(`/nextcloud/folder?path=${encodeURIComponent(path)}`);
}

export async function ncUpload(folderPath: string, file: File): Promise<void> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('path', folderPath);

  const res = await fetch(`${BACKEND}/nextcloud/upload`, {
    method: 'POST',
    headers: ncHeaders(),
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(typeof err.error === 'string' ? err.error : `NC upload failed: ${res.status}`);
  }
}

export async function ncDelete(paths: string[]): Promise<void> {
  await ncPost<{ ok: boolean }>('/nextcloud/delete', { paths });
}

export async function ncRename(filePath: string, newName: string): Promise<void> {
  await ncPost<{ ok: boolean }>('/nextcloud/rename', { path: filePath, newName });
}

export async function ncMove(from: string, to: string): Promise<void> {
  await ncPost<{ ok: boolean }>('/nextcloud/move', { from, to });
}

export async function ncMkcol(folderPath: string): Promise<void> {
  await ncPost<{ ok: boolean }>('/nextcloud/mkcol', { path: folderPath });
}

export async function ncShare(filePath: string): Promise<{ url: string; token: string }> {
  return ncPost<{ url: string; token: string }>('/nextcloud/share', { path: filePath });
}

export async function ncQuota(): Promise<NCQuota> {
  return ncGet<NCQuota>('/nextcloud/quota');
}

export function ncDownloadUrl(filePath: string): string {
  const token = getToken();
  const headers = new URLSearchParams();
  headers.set('token', token);
  const appPw = ncGetStoredAppPassword();
  if (appPw) headers.set('ncAppPw', appPw);
  const userOverride = ncGetUsernameOverride();
  if (userOverride) headers.set('ncUser', userOverride);
  return `${BACKEND}/nextcloud/file?path=${encodeURIComponent(filePath)}&${headers.toString()}`;
}

export function ncViewUrl(filePath: string): string {
  return ncDownloadUrl(filePath) + '&view=1';
}
