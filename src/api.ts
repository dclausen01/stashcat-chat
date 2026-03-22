const BACKEND = 'http://localhost:3001/api';

let token = '';

const SESSION_KEY = 'schulchat_token';

function headers(): HeadersInit {
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BACKEND}${path}`, { headers: headers() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

async function post<T>(path: string, body: Record<string, unknown> = {}): Promise<T> {
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

// --- Session ---

export function isLoggedIn(): boolean {
  return !!token;
}

export function restoreToken() {
  token = localStorage.getItem(SESSION_KEY) || '';
}

export function clearSession() {
  token = '';
  localStorage.removeItem(SESSION_KEY);
}

// --- Auth ---

export async function login(email: string, password: string, securityPassword: string) {
  const res = await post<{ token: string; user: Record<string, unknown> }>('/login', {
    email,
    password,
    securityPassword,
  });
  token = res.token;
  localStorage.setItem(SESSION_KEY, token);
  return res;
}

export async function logout() {
  await post('/logout').catch(() => {});
  clearSession();
}

// --- User ---

export async function getMe() {
  return get<Record<string, unknown>>('/me');
}

// --- Companies ---

export async function getCompanies() {
  return get<Array<Record<string, unknown>>>('/companies');
}

// --- Channels ---

export async function getChannels(companyId: string) {
  return get<Array<Record<string, unknown>>>(`/channels/${companyId}`);
}

export async function getChannelMembers(channelId: string) {
  return get<Array<Record<string, unknown>>>(`/channels/${channelId}/members`);
}

// --- Conversations ---

export async function getConversations(limit = 50, offset = 0) {
  return get<Array<Record<string, unknown>>>(`/conversations?limit=${limit}&offset=${offset}`);
}

// --- Messages ---

export async function getMessages(targetId: string, type: 'channel' | 'conversation', limit = 40, offset = 0) {
  return get<Array<Record<string, unknown>>>(`/messages/${type}/${targetId}?limit=${limit}&offset=${offset}`);
}

export async function sendMessage(targetId: string, type: 'channel' | 'conversation', text: string) {
  return post(`/messages/${type}/${targetId}`, { text });
}

export async function markAsRead(targetId: string, type: 'channel' | 'conversation') {
  return post(`/messages/${type}/${targetId}/read`);
}
