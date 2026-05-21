/**
 * Core HTTP client utilities for the stashcat-chat API.
 *
 * Provides typed GET/POST/PUT/PATCH/DELETE methods with automatic
 * Bearer-Auth and JSON body handling.
 */

export const BACKEND = import.meta.env.DEV ? '/backend/api' : '/api';

let token = '';
const SESSION_KEY = 'schulchat_token';

// --- Token persistence helpers ---

export function persistToken(t: string): void {
  token = t;
  localStorage.setItem(SESSION_KEY, t);
}

export function restoreToken(): void {
  token = localStorage.getItem(SESSION_KEY) || '';
}

export function clearSession(): void {
  token = '';
  localStorage.removeItem(SESSION_KEY);
}

export function getToken(): string {
  return token;
}

export function isLoggedIn(): boolean {
  return !!token;
}

function headers(): HeadersInit {
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/**
 * Error mit attached HTTP-Status, damit Aufrufer (z. B. AuthContext fuer 401/403)
 * sauber per `err.status` pruefen koennen statt per String-Matching auf `err.message`.
 */
export class ApiError extends Error {
  status: number;
  debug?: unknown;
  constructor(message: string, status: number, debug?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.debug = debug;
  }
}

async function throwIfNotOk(res: Response): Promise<void> {
  if (res.ok) return;
  const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  throw new ApiError(err.error || `HTTP ${res.status}`, res.status, err);
}

export async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BACKEND}${path}`, { headers: headers() });
  await throwIfNotOk(res);
  return res.json();
}

export async function post<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${BACKEND}${path}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  await throwIfNotOk(res);
  return res.json();
}

export async function del<T = void>(path: string, body?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BACKEND}${path}`, {
    method: 'DELETE',
    headers: headers(),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  await throwIfNotOk(res);
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function patch<T = void>(path: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${BACKEND}${path}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify(body),
  });
  await throwIfNotOk(res);
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function put<T = void>(path: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${BACKEND}${path}`, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify(body),
  });
  await throwIfNotOk(res);
  return res.json();
}
