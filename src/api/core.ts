/**
 * Core HTTP client utilities for the stashcat-chat API.
 *
 * Provides typed GET/POST/PUT/PATCH/DELETE methods with automatic
 * Bearer-Auth and JSON body handling.
 */

const BACKEND = import.meta.env.DEV ? '/backend/api' : '/api';

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

export async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BACKEND}${path}`, { headers: headers() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    const e = new Error(err.error || `HTTP ${res.status}`);
    (e as unknown as Record<string, unknown>).debug = err;
    throw e;
  }
  return res.json();
}

export async function post<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${BACKEND}${path}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function del<T = void>(path: string, body?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BACKEND}${path}`, {
    method: 'DELETE',
    headers: headers(),
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function patch<T = void>(path: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${BACKEND}${path}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

export async function put<T = void>(path: string, body: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(`${BACKEND}${path}`, {
    method: 'PUT',
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}
