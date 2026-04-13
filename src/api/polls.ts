/**
 * Polls (Umfragen) API endpoints.
 */

import { get, post, del } from './core';

export interface PollUser {
  id: string;
  first_name?: string;
  last_name?: string;
  image?: string;
}

export interface PollAnswer {
  id: string;
  answer_text: string;
  position?: number;
  votes?: number;
  users?: PollUser[];
}

export interface PollQuestion {
  id: string;
  name: string;
  type?: string;
  answer_limit?: number;
  position?: number;
  answers?: PollAnswer[];
  user_answers?: string[];
}

export interface Poll {
  id: string;
  name: string;
  description?: string;
  start_time?: number;
  end_time?: number;
  privacy_type?: 'open' | 'hidden' | 'anonymous';
  hidden_results?: boolean;
  status?: string;
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
  questions: Array<{
    name: string;
    answer_limit?: number;
    answers: string[];
  }>;
  invite_channel_ids?: string[];
  invite_conversation_ids?: string[];
  notify_chat_id?: string;
  notify_chat_type?: 'channel' | 'conversation';
}

export async function listPolls(
  constraint:
    | 'created_by_and_not_archived'
    | 'invited_and_not_archived'
    | 'archived_or_over'
    | string = 'invited_and_not_archived',
  companyId?: string
): Promise<Poll[]> {
  let url = `/polls?constraint=${constraint}`;
  if (companyId) url += `&company_id=${encodeURIComponent(companyId)}`;
  return get<Poll[]>(url);
}

export async function getPoll(id: string, companyId?: string): Promise<Poll> {
  let url = `/polls/${id}`;
  if (companyId) url += `?company_id=${encodeURIComponent(companyId)}`;
  return get<Poll>(url);
}

export async function createPoll(data: CreatePollData): Promise<{ id: string }> {
  return post<{ id: string }>('/polls', data as unknown as Record<string, unknown>);
}

export async function deletePoll(id: string): Promise<void> {
  return del(`/polls/${id}`);
}

export async function archivePoll(id: string, archive = true): Promise<void> {
  await post(`/polls/${id}/archive`, { archive });
}

export async function closePoll(
  id: string,
  name: string,
  companyId: string,
  startTime: number
): Promise<void> {
  await post(`/polls/${id}/close`, {
    name,
    company_id: companyId,
    start_time: startTime,
  });
}

export async function submitPollAnswer(
  pollId: string,
  questionId: string,
  answerIds: string[]
): Promise<void> {
  await post(`/polls/${pollId}/answer`, {
    question_id: questionId,
    answer_ids: answerIds,
  });
}
