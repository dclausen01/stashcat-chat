/**
 * Authentication and user-related API endpoints.
 */

import { get, post, persistToken, clearSession, BACKEND } from './core';
import type { User, Company } from '../types';

// --- Auth ---

export async function login(email: string, password: string, securityPassword: string) {
  const res = await post<{ token: string; user: User }>('/login', {
    email,
    password,
    securityPassword,
  });
  persistToken(res.token);
  return res;
}

// --- Phased Login (multi-step wizard) ---

export async function loginCredentials(email: string, password: string): Promise<{ preAuthToken: string }> {
  return post<{ preAuthToken: string }>('/login/credentials', { email, password });
}

export async function loginFinalizeWithPassword(preAuthToken: string, securityPassword: string): Promise<{ token: string; user: User }> {
  const res = await post<{ token: string; user: User }>('/login/password', { preAuthToken, securityPassword });
  persistToken(res.token);
  return res;
}

export async function initiateDeviceKeyTransfer(preAuthToken: string): Promise<void> {
  await post<{ ok: boolean }>('/login/device/initiate', { preAuthToken });
}

export async function loginFinalizeWithDeviceCode(preAuthToken: string, code: string): Promise<{ token: string; user: User }> {
  const res = await post<{ token: string; user: User }>('/login/device/complete', { preAuthToken, code });
  persistToken(res.token);
  return res;
}

export async function logout(): Promise<void> {
  await post('/logout').catch(() => {});
  clearSession();
}

// --- Mobile (Flutter shell) login ---

export interface MobileLoginResult {
  mobileToken: string;
  token: string;
  user: User;
}

export async function mobileLogin(
  email: string,
  password: string,
  securityPassword: string,
): Promise<MobileLoginResult> {
  const res = await post<MobileLoginResult>('/auth/mobile-login', { email, password, securityPassword });
  persistToken(res.token);
  return res;
}

/**
 * Exchange a long-lived `mobileToken` (issued by `/auth/mobile-login` and
 * stored by the Flutter shell) for a regular session token. The caller is
 * responsible for `persistToken()`-ing the result.
 */
export async function mobileSession(mobileToken: string): Promise<{ token: string; user: User }> {
  const res = await fetch(`${BACKEND}/auth/mobile-session`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${mobileToken}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

export async function mobileLogout(mobileToken: string): Promise<void> {
  await fetch(`${BACKEND}/auth/mobile-logout`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${mobileToken}` },
  }).catch(() => {});
}

// --- User ---

export async function getMe(): Promise<User> {
  return get<User>('/me');
}

// --- Companies ---

export async function getCompanies(): Promise<Company[]> {
  return get<Company[]>('/companies');
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

export async function setOnlineStatus(status: 'available' | 'do_not_disturb'): Promise<void> {
  const statusText = status === 'available' ? 'verfügbar' : 'Bitte nicht stören!';
  await post('/account/status', { status: statusText });
}

/** Derive availability from status text */
export function deriveAvailability(status?: string): 'available' | 'do_not_disturb' | undefined {
  if (status === 'Bitte nicht stören!') return 'do_not_disturb';
  if (status === 'verfügbar') return 'available';
  return undefined;
}

export async function uploadProfileImage(imgBase64: string): Promise<void> {
  await post('/account/profile-image', { imgBase64 });
}

export async function resetProfileImage(): Promise<void> {
  await post('/account/profile-image/reset');
}
