const BACKEND = import.meta.env.DEV ? '/backend/api' : '/api';

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
    const e = new Error(err.error || `HTTP ${res.status}`);
    (e as unknown as Record<string, unknown>).debug = err;
    throw e;
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

export async function getChannelInfo(channelId: string): Promise<Record<string, unknown>> {
  return get<Record<string, unknown>>(`/channels/${channelId}/info`);
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

export async function deleteChannel(channelId: string): Promise<void> {
  const res = await fetch(`${BACKEND}/channels/${channelId}`, {
    method: 'DELETE',
    headers: headers(),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
}

export interface ManagedUser {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  image?: string;
  roles?: Array<{ id: string; name: string; company_id: string }>;
  active?: boolean;
}

export interface CompanyGroup {
  id: string;
  name: string;
  count: number;
  ldap_group?: string;
}

export async function searchCompanyMembers(companyId: string, opts?: { search?: string; limit?: number; offset?: number }) {
  const params = new URLSearchParams();
  if (opts?.search) params.set('search', opts.search);
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.offset) params.set('offset', String(opts.offset));
  const qs = params.toString();
  return get<{ users: ManagedUser[]; total: number }>(`/companies/${companyId}/members${qs ? `?${qs}` : ''}`);
}

export async function getCompanyGroups(companyId: string) {
  return get<CompanyGroup[]>(`/companies/${companyId}/groups`);
}

export async function getGroupMembers(companyId: string, groupId: string) {
  return get<{ users: ManagedUser[]; total: number }>(`/companies/${companyId}/groups/${groupId}/members`);
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

export async function setFavorite(type: 'channel' | 'conversation', id: string, favorite: boolean): Promise<void> {
  await post(`/${type}s/${id}/favorite`, { favorite });
}

export async function getVisibleChannels(companyId: string) {
  return get<Array<Record<string, unknown>>>(`/channels/${companyId}/visible`);
}

export async function joinChannel(channelId: string): Promise<void> {
  await post(`/channels/${channelId}/join`);
}

export async function moveFile(fileId: string, targetFolderId: string): Promise<void> {
  await post(`/files/${fileId}/move`, { target_folder_id: targetFolderId });
}

export async function createFolder(name: string, parentId: string, type: string, typeId: string): Promise<Record<string, unknown>> {
  return post('/files/folder/create', { folder_name: name, parent_id: parentId, type, type_id: typeId });
}

// --- Conversations ---

export async function createConversation(memberIds: string[]): Promise<Record<string, unknown>> {
  return post<Record<string, unknown>>('/conversations', { member_ids: memberIds });
}

export async function getConversation(id: string): Promise<Record<string, unknown>> {
  return get<Record<string, unknown>>(`/conversations/${id}`);
}

export async function getConversations(limit = 50, offset = 0) {
  return get<Array<Record<string, unknown>>>(`/conversations?limit=${limit}&offset=${offset}`);
}

// --- Messages ---

export async function getMessages(targetId: string, type: 'channel' | 'conversation', limit = 40, offset = 0) {
  return get<Array<Record<string, unknown>>>(`/messages/${type}/${targetId}?limit=${limit}&offset=${offset}`);
}

export async function sendMessage(targetId: string, type: 'channel' | 'conversation', text: string, opts?: { is_forwarded?: boolean; reply_to_id?: string; files?: string[] }) {
  return post(`/messages/${type}/${targetId}`, { text, ...opts });
}

export async function likeMessage(messageId: string): Promise<void> {
  return post(`/messages/${messageId}/like`);
}

export interface LikeInfo {
  user: { id: string; first_name: string; last_name: string; image?: string };
  liked_at: number;
}

export async function listLikes(messageId: string): Promise<LikeInfo[]> {
  const data = await get<{ likes: LikeInfo[] }>(`/messages/${messageId}/likes`);
  return data.likes ?? [];
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
  const res = await fetch(`${BACKEND}/files/delete`, {
    method: 'POST',
    headers: { ...headers(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileIds: [fileId] }),
  });
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

// --- Broadcasts ---

export async function listBroadcasts() {
  return get<Array<Record<string, unknown>>>('/broadcasts');
}

export async function createBroadcast(name: string, memberIds: string[]): Promise<Record<string, unknown>> {
  return post<Record<string, unknown>>('/broadcasts', { name, memberIds });
}

export async function deleteBroadcast(id: string): Promise<void> {
  const res = await fetch(`${BACKEND}/broadcasts/${id}`, { method: 'DELETE', headers: headers() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function renameBroadcast(id: string, name: string): Promise<void> {
  const res = await fetch(`${BACKEND}/broadcasts/${id}`, {
    method: 'PATCH', headers: headers(), body: JSON.stringify({ name }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function getBroadcastMessages(id: string, limit = 50, offset = 0) {
  return get<Array<Record<string, unknown>>>(`/broadcasts/${id}/messages?limit=${limit}&offset=${offset}`);
}

export async function sendBroadcastMessage(id: string, text: string) {
  return post<Record<string, unknown>>(`/broadcasts/${id}/messages`, { text });
}

export async function getBroadcastMembers(id: string) {
  return get<Array<Record<string, unknown>>>(`/broadcasts/${id}/members`);
}

export async function addBroadcastMembers(id: string, memberIds: string[]): Promise<void> {
  await post(`/broadcasts/${id}/members`, { memberIds });
}

export async function removeBroadcastMembers(id: string, memberIds: string[]): Promise<void> {
  const res = await fetch(`${BACKEND}/broadcasts/${id}/members`, {
    method: 'DELETE', headers: headers(), body: JSON.stringify({ memberIds }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

// --- Calendar ---

export interface CalendarEvent {
  id: number;
  name: string;
  description?: string;
  location?: string;
  start: number;
  end: number;
  type: string;
  type_id?: number;
  allday?: string;
  repeat?: string;
  repeat_end?: number | null;
  creator?: { id: number | string; first_name?: string; last_name?: string; image?: string };
  invites?: Array<{
    id: number;
    status: string;
    user: { id: number | string; first_name?: string; last_name?: string };
  }>;
  channel?: Record<string, unknown>;
  channel_invites?: unknown[];
  members?: unknown[];
}

export async function listCalendarEvents(start: number, end: number) {
  return get<CalendarEvent[]>(`/calendar/events?start=${start}&end=${end}`);
}

export async function getCalendarEvent(id: string) {
  return get<CalendarEvent>(`/calendar/events/${id}`);
}

export async function createCalendarEvent(data: Record<string, unknown>): Promise<{ id: string }> {
  return post<{ id: string }>('/calendar/events', data);
}

export async function editCalendarEvent(id: string, data: Record<string, unknown>): Promise<{ id: string }> {
  const res = await fetch(`${BACKEND}/calendar/events/${id}`, {
    method: 'PUT', headers: headers(), body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export async function deleteCalendarEvent(id: string): Promise<void> {
  const res = await fetch(`${BACKEND}/calendar/events/${id}`, { method: 'DELETE', headers: headers() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function respondToCalendarEvent(id: string, status: 'accepted' | 'declined' | 'open'): Promise<void> {
  await post(`/calendar/events/${id}/respond`, { status });
}

export async function getCalendarChannels(companyId: string) {
  return get<Array<Record<string, unknown>>>(`/calendar/channels/${companyId}`);
}

// --- File Upload (chat) ---

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

// --- Video Meeting ---

export async function startVideoMeeting(targetId: string, targetType: 'channel' | 'conversation'): Promise<{ inviteLink: string | null; moderatorLink: string | null }> {
  return post<{ inviteLink: string | null; moderatorLink: string | null }>('/video/start-meeting', { targetId, targetType });
}

// --- Notifications ---

export interface AppNotification {
  id: string;
  type: string;
  text?: string;
  content?: unknown;  // API sends objects or strings depending on notification type
  time?: number;
  created_at?: string;
  channel?: { id: string; name: string };
  event?: { id: string; name: string };
  survey?: { id: string; name?: string; creator?: { id: string; first_name?: string; last_name?: string } };
  sender?: { id: string; first_name: string; last_name: string; image?: string };
  read?: boolean;
}

export async function getNotifications(limit = 50, offset = 0) {
  return get<AppNotification[]>(`/notifications?limit=${limit}&offset=${offset}`);
}

export async function getNotificationCount() {
  return get<{ count: number }>('/notifications/count');
}

export async function deleteNotification(notificationId: string) {
  const res = await fetch(`${BACKEND}/notifications/${notificationId}`, {
    method: 'DELETE',
    headers: headers(),
  });
  if (!res.ok) throw new Error('Failed to delete notification');
  return res.json();
}

// --- Polls (Umfragen) ---

export interface PollAnswer {
  id: string;
  answer_text: string;
  position?: number;
  votes?: number;
}

export interface PollQuestion {
  id: string;
  name: string;
  type?: string;
  answer_limit?: number;
  position?: number;
  answers?: PollAnswer[];
  user_answers?: string[]; // IDs the current user already voted for
}

export interface Poll {
  id: string;
  name: string;
  description?: string;
  start_time?: number;
  end_time?: number;
  privacy_type?: 'open' | 'hidden' | 'anonymous';
  hidden_results?: boolean;
  status?: string; // 'draft' | 'active' | 'archived'
  company_id?: string;
  creator?: { id: string; first_name?: string; last_name?: string };
  participant_count?: number;
  questions?: PollQuestion[];
}

export interface CreatePollData {
  name: string;
  description?: string;
  start_time: number;
  end_time: number;
  privacy_type?: 'open' | 'hidden' | 'anonymous';
  hidden_results?: boolean;
  questions: Array<{ name: string; answer_limit?: number; answers: string[] }>;
  invite_channel_ids?: string[];
  invite_conversation_ids?: string[];
  notify_chat_id?: string;
  notify_chat_type?: 'channel' | 'conversation';
}

export async function listPolls(constraint: 'created_by_and_not_archived' | 'invited_and_not_archived' | 'archived_or_over' | string = 'invited_and_not_archived', companyId?: string) {
  let url = `/polls?constraint=${constraint}`;
  if (companyId) url += `&company_id=${encodeURIComponent(companyId)}`;
  return get<Poll[]>(url);
}

export async function getPoll(id: string, companyId?: string) {
  let url = `/polls/${id}`;
  if (companyId) url += `?company_id=${encodeURIComponent(companyId)}`;
  return get<Poll>(url);
}

export async function createPoll(data: CreatePollData): Promise<{ id: string }> {
  return post<{ id: string }>('/polls', data as unknown as Record<string, unknown>);
}

export async function deletePoll(id: string): Promise<void> {
  const res = await fetch(`${BACKEND}/polls/${id}`, { method: 'DELETE', headers: headers() });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function archivePoll(id: string, archive = true): Promise<void> {
  await post(`/polls/${id}/archive`, { archive });
}

export async function submitPollAnswer(pollId: string, questionId: string, answerIds: string[]): Promise<void> {
  await post(`/polls/${pollId}/answer`, { question_id: questionId, answer_ids: answerIds });
}

// --- Account ---

export interface AccountSettings {
  email: string;
  first_name: string;
  last_name: string;
  status?: string;
}

export async function getAccountSettings(): Promise<AccountSettings> {
  return get<AccountSettings>('/account/settings');
}

export async function changeStatus(status: string): Promise<void> {
  await post('/account/status', { status });
}

export async function uploadProfileImage(imgBase64: string): Promise<void> {
  await post('/account/profile-image', { imgBase64 });
}

export async function resetProfileImage(): Promise<void> {
  await post('/account/profile-image/reset');
}
