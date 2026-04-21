/**
 * Channel management API endpoints.
 */

import { get, post, del, patch } from './core';
import type { Channel } from '../types';

// --- Channels ---

export async function getChannels(companyId: string): Promise<Channel[]> {
  return get<Channel[]>(`/channels/${companyId}`);
}

export async function getChannelInfo(channelId: string): Promise<Channel> {
  return get<Channel>(`/channels/${channelId}/info`);
}

export async function getChannelMembers(channelId: string): Promise<
  Array<Record<string, unknown> & {
    id: string;
    first_name?: string;
    last_name?: string;
    image?: string;
    manager?: boolean;
  }>
> {
  return get<
    Array<Record<string, unknown> & {
      id: string;
      first_name?: string;
      last_name?: string;
      image?: string;
      manager?: boolean;
    }>
  >(`/channels/${channelId}/members`);
}

export async function getPendingChannelMembers(channelId: string): Promise<
  Array<Record<string, unknown> & {
    id: string;
    first_name?: string;
    last_name?: string;
    image?: string;
    email?: string | null;
    membership_pending?: boolean;
  }>
> {
  return get<
    Array<Record<string, unknown> & {
      id: string;
      first_name?: string;
      last_name?: string;
      image?: string;
      email?: string | null;
      membership_pending?: boolean;
    }>
  >(`/channels/${channelId}/pending-members`);
}

export async function inviteToChannel(channelId: string, userIds: string[]): Promise<void> {
  return post(`/channels/${channelId}/invite`, { userIds });
}

export async function removeFromChannel(channelId: string, userId: string): Promise<void> {
  return del(`/channels/${channelId}/members/${userId}`);
}

export async function addModerator(channelId: string, userId: string): Promise<void> {
  return post(`/channels/${channelId}/moderator/${userId}`);
}

export async function removeModerator(channelId: string, userId: string): Promise<void> {
  return del(`/channels/${channelId}/moderator/${userId}`);
}

export async function editChannel(channelId: string, companyId: string, description: string): Promise<void> {
  return patch(`/channels/${channelId}`, { description, company_id: companyId });
}

export async function setChannelImage(channelId: string, companyId: string, image: string): Promise<{ channel?: { image?: string } }> {
  return post(`/channels/${channelId}/image`, { company_id: companyId, image });
}

export async function deleteChannel(channelId: string): Promise<void> {
  return del(`/channels/${channelId}`);
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
}): Promise<Channel> {
  return post<Channel>('/channels', opts);
}

export async function setFavorite(type: 'channel' | 'conversation', id: string, favorite: boolean): Promise<void> {
  await post(`/${type}s/${id}/favorite`, { favorite });
}

export async function getVisibleChannels(companyId: string): Promise<Channel[]> {
  return get<Channel[]>(`/channels/${companyId}/visible`);
}

export async function joinChannel(channelId: string): Promise<void> {
  await post(`/channels/${channelId}/join`);
}

export async function acceptChannelInvite(inviteId: string, notificationId?: string): Promise<void> {
  await post(`/channels/invites/${inviteId}/accept`, notificationId ? { notificationId } : {});
}

export async function declineChannelInvite(inviteId: string, notificationId?: string): Promise<void> {
  await post(`/channels/invites/${inviteId}/decline`, notificationId ? { notificationId } : {});
}

// --- Company Members & Groups ---

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

export async function searchCompanyMembers(
  companyId: string,
  opts?: { search?: string; limit?: number; offset?: number }
): Promise<{ users: ManagedUser[]; total: number }> {
  const params = new URLSearchParams();
  if (opts?.search) params.set('search', opts.search);
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.offset) params.set('offset', String(opts.offset));
  const qs = params.toString();
  return get<{ users: ManagedUser[]; total: number }>(
    `/companies/${companyId}/members${qs ? `?${qs}` : ''}`
  );
}

export async function getCompanyGroups(companyId: string): Promise<CompanyGroup[]> {
  return get<CompanyGroup[]>(`/companies/${companyId}/groups`);
}

export async function getGroupMembers(
  companyId: string,
  groupId: string
): Promise<{ users: ManagedUser[]; total: number }> {
  return get<{ users: ManagedUser[]; total: number }>(
    `/companies/${companyId}/groups/${groupId}/members`
  );
}

export async function setChannelNotifications(channelId: string, enabled: boolean): Promise<void> {
  await post(`/channels/${channelId}/notifications`, { enabled });
}
