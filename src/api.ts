const BACKEND = '/backend/api';

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

export async function inviteToChannel(channelId: string, userIds: string[]): Promise<void> {
  return post(`/channels/${channelId}/invite`, { userIds });
}

export async function removeFromChannel(channelId: string, userId: string): Promise<void> {
  const res = await fetch(`${BACKEND}/channels/${channelId}/members/${userId}`, {
    method: 'DELETE',
    headers: headers(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
}

export async function getCompanyMembers(companyId: string) {
  return get<Array<Record<string, unknown>>>(`/companies/${companyId}/members`);
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

export async function likeMessage(messageId: string): Promise<void> {
  return post(`/messages/${messageId}/like`);
}

export async function unlikeMessage(messageId: string): Promise<void> {
  return post(`/messages/${messageId}/unlike`);
}

export async function deleteMessage(messageId: string): Promise<void> {
  const res = await fetch(`${BACKEND}/messages/${messageId}`, {
    method: 'DELETE',
    headers: headers(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
}

export async function markAsRead(targetId: string, type: 'channel' | 'conversation', messageId?: string) {
  return post(`/messages/${type}/${targetId}/read`, messageId ? { messageId } : {});
}

export async function sendTyping(type: 'channel' | 'conversation', targetId: string) {
  return post('/typing', { type, targetId });
}

export function fileDownloadUrl(fileId: string, name: string): string {
  const token = localStorage.getItem('schulchat_token') || '';
  return `${BACKEND}/file/${fileId}?name=${encodeURIComponent(name)}&token=${token}`;
}

export function fileViewUrl(fileId: string, name: string): string {
  const token = localStorage.getItem('schulchat_token') || '';
  return `${BACKEND}/file/${fileId}?name=${encodeURIComponent(name)}&token=${token}&view=1`;
}

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
  const res = await fetch(`${BACKEND}/upload/${type}/${targetId}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
}
