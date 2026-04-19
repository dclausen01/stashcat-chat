/**
 * Conversations API endpoints.
 */

import { get, post } from './core';
import type { Conversation } from '../types';

export async function createConversation(memberIds: string[]): Promise<Conversation> {
  return post<Conversation>('/conversations', { member_ids: memberIds });
}

export async function getConversation(id: string): Promise<Conversation> {
  return get<Conversation>(`/conversations/${id}`);
}

export async function getConversations(limit?: number, offset?: number): Promise<Conversation[]> {
  const params = new URLSearchParams();
  if (limit !== undefined) params.set('limit', String(limit));
  if (offset !== undefined) params.set('offset', String(offset));
  const qs = params.toString();
  return get<Conversation[]>(`/conversations${qs ? `?${qs}` : ''}`);
}
