// Push-related API endpoints (FCM token registration + mobile push prefs).

import { get, post, del, patch } from './core';

export type Platform = 'android' | 'ios';
export type PushPreviewMode = 'full' | 'silent';

export interface PushToken {
  token: string;
  platform: Platform;
  appVersion?: string;
  locale?: string;
  createdAt: number;
  lastSeenAt: number;
  pushPreviewMode?: PushPreviewMode;
}

export async function registerPushToken(body: {
  token: string;
  platform: Platform;
  appVersion?: string;
  locale?: string;
}): Promise<{ ok: true }> {
  return post<{ ok: true }>('/push-tokens', body as unknown as Record<string, unknown>);
}

export async function unregisterPushToken(token: string): Promise<void> {
  await del(`/push-tokens/${encodeURIComponent(token)}`);
}

export async function listOwnPushTokens(): Promise<PushToken[]> {
  return get<PushToken[]>('/push-tokens');
}

export async function getMobilePushPreview(): Promise<PushPreviewMode> {
  try {
    const res = await get<{ pushPreviewMode: PushPreviewMode }>('/account/push-preferences');
    return res.pushPreviewMode ?? 'full';
  } catch {
    return 'full';
  }
}

export async function setMobilePushPreview(mode: PushPreviewMode): Promise<void> {
  await patch('/account/push-preferences', { pushPreviewMode: mode });
}
