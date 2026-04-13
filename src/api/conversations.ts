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

export async function getConversations(limit = 50, offset = 0): Promise<Conversation[]> {
  return get<Conversation[]>(`/conversations?limit=${limit}&offset=${offset}`);
}
