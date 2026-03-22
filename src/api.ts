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

export async function addModerator(channelId: string, userId: string): Promise<void> {
  return post(`/channels/${channelId}/moderator/${userId}`);
}

export async function removeModerator(channelId: string, userId: string): Promise<void> {
  const res = await fetch(`${BACKEND}/channels/${channelId}/moderator/${userId}`, {
    method: 'DELETE',
    headers: headers(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
}

export async function editChannel(channelId: string, companyId: string, description: string): Promise<void> {
  const res = await fetch(`${BACKEND}/channels/${channelId}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify({ description, company_id: companyId }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
}

export async function getCompanyMembers(companyId: string) {
  return get<Array<Record<string, unknown>>>(`/companies/${companyId}/members`);
}

export async function createChannel(opts: {
  name: string;
  company_id: string;
  description?: string;
  policies?: string;
  channel_type?: 'public' | 'encrypted' | 'password';
  hidden?: boolean;
  invite_only?: boolean;
  read_only?: boolean;
  show_activities?: boolean;
  show_membership_activities?: boolean;
  password?: string;
  password_repeat?: string;
}): Promise<Record<string, unknown>> {
  return post<Record<string, unknown>>('/channels', opts);
}

// --- Conversations ---

export async function createConversation(memberIds: string[]): Promise<Record<string, unknown>> {
  return post<Record<string, unknown>>('/conversations', { member_ids: memberIds });
}

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

// --- File Browser ---

export interface FolderContent {
  folder: Array<Record<string, unknown>>;
  files: Array<Record<string, unknown>>;
}

export async function listFolder(type: string, typeId: string, folderId?: string, offset = 0, limit = 200): Promise<FolderContent> {
  let url = `/files/folder?type=${encodeURIComponent(type)}&typeId=${encodeURIComponent(typeId)}&offset=${offset}&limit=${limit}`;
  if (folderId) url += `&folderId=${encodeURIComponent(folderId)}`;
  return get<FolderContent>(url);
}

export async function listPersonalFiles(folderId?: string, offset = 0, limit = 200): Promise<FolderContent> {
  let url = `/files/personal?offset=${offset}&limit=${limit}`;
  if (folderId) url += `&folderId=${encodeURIComponent(folderId)}`;
  return get<FolderContent>(url);
}

export async function deleteFile(fileId: string): Promise<void> {
  const res = await fetch(`${BACKEND}/files/${fileId}`, { method: 'DELETE', headers: headers() });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
}

export async function renameFile(fileId: string, name: string): Promise<void> {
  const res = await fetch(`${BACKEND}/files/${fileId}`, {
    method: 'PATCH',
    headers: headers(),
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
}

export async function uploadToStorage(
  type: string,
  typeId: string | undefined,
  file: File,
  folderId?: string,
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
    throw new Error(err.error || `HTTP ${res.status}`);
  }
}

export function fileDownloadUrl(fileId: string, name: string): string {
  const token = localStorage.getItem('schulchat_token') || '';
  return `${BACKEND}/file/${fileId}?name=${encodeURIComponent(name)}&token=${token}`;
}

export function fileViewUrl(fileId: string, name: string): string {
  const token = localStorage.getItem('schulchat_token') || '';
  return `${BACKEND}/file/${fileId}?name=${encodeURIComponent(name)}&token=${token}&view=1`;
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
