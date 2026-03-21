const BASE = '/api';

async function post<T>(endpoint: string, params: Record<string, string> = {}): Promise<T> {
  const body = new URLSearchParams(params);
  const res = await fetch(`${BASE}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.status?.value !== 'OK') {
    throw new Error(json.status?.message || 'API error');
  }
  return json.payload;
}

let clientKey = '';
let deviceId = '';

function authParams(): Record<string, string> {
  return { client_key: clientKey, device_id: deviceId };
}

export function isLoggedIn(): boolean {
  return !!clientKey;
}

export function getDeviceId(): string {
  return deviceId;
}

export function getClientKey(): string {
  return clientKey;
}

export function restoreSession(key: string, device: string) {
  clientKey = key;
  deviceId = device;
}

export function clearSession() {
  clientKey = '';
  deviceId = '';
}

export async function login(email: string, password: string, appName = 'schulchat-web') {
  deviceId = crypto.randomUUID().replace(/-/g, '');
  const payload = await post<{
    client_key: string;
    userinfo: Record<string, unknown>;
  }>('/auth/login', {
    email,
    password,
    app_name: appName,
    device_id: deviceId,
  });
  clientKey = payload.client_key;
  return payload;
}

export async function getMe() {
  return post<{ userinfo: Record<string, unknown> }>('/users/me', authParams());
}

export async function getCompanies() {
  return post<{ companies: Array<Record<string, unknown>> }>('/company/member', authParams());
}

export async function getChannels(companyId: string) {
  return post<{ channels: Array<Record<string, unknown>> }>('/channels/subscripted', {
    ...authParams(),
    company_id: companyId,
  });
}

export async function getConversations(limit = 50, offset = 0) {
  return post<{ conversations: Array<Record<string, unknown>> }>('/message/conversations', {
    ...authParams(),
    limit: String(limit),
    offset: String(offset),
  });
}

export async function getMessages(targetId: string, type: 'channel' | 'conversation', limit = 40, offset = 0) {
  return post<{ messages: Array<Record<string, unknown>> }>('/message/content', {
    ...authParams(),
    [`${type}_id`]: targetId,
    limit: String(limit),
    offset: String(offset),
  });
}

export async function sendMessage(targetId: string, type: 'channel' | 'conversation', text: string) {
  const params: Record<string, string> = {
    ...authParams(),
    text,
    type: type === 'channel' ? 'channel' : 'private',
  };
  if (type === 'channel') {
    params.channel_id = targetId;
  } else {
    params.conversation_id = targetId;
  }
  return post<Record<string, unknown>>('/message/send', params);
}

export async function markAsRead(targetId: string, type: 'channel' | 'conversation') {
  return post<Record<string, unknown>>('/message/mark_read', {
    ...authParams(),
    [`${type}_id`]: targetId,
  });
}

export async function getChannelMembers(channelId: string) {
  return post<{ members: Array<Record<string, unknown>> }>('/channels/members', {
    ...authParams(),
    channel_id: channelId,
  });
}
