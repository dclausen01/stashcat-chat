/**
 * Calendar and event management API endpoints.
 */

import { get, post, del, put } from './core';

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
  creator?: {
    id: number | string;
    first_name?: string;
    last_name?: string;
    image?: string;
  };
  invites?: Array<{
    id: number;
    status: string;
    user: { id: number | string; first_name?: string; last_name?: string };
  }>;
  channel?: Record<string, unknown>;
  channel_invites?: unknown[];
  members?: unknown[];
}

export async function listCalendarEvents(
  start: number,
  end: number
): Promise<CalendarEvent[]> {
  return get<CalendarEvent[]>(`/calendar/events?start=${start}&end=${end}`);
}

export async function getCalendarEvent(id: string): Promise<CalendarEvent> {
  return get<CalendarEvent>(`/calendar/events/${id}`);
}

export async function createCalendarEvent(
  data: Record<string, unknown>
): Promise<{ id: string }> {
  return post<{ id: string }>('/calendar/events', data);
}

export async function editCalendarEvent(
  id: string,
  data: Record<string, unknown>
): Promise<{ id: string }> {
  return put<{ id: string }>(`/calendar/events/${id}`, data);
}

export async function deleteCalendarEvent(id: string): Promise<void> {
  return del(`/calendar/events/${id}`);
}

export async function respondToCalendarEvent(
  id: string,
  status: 'accepted' | 'declined' | 'open'
): Promise<void> {
  await post(`/calendar/events/${id}/respond`, { status });
}

export async function getCalendarChannels(
  companyId: string
): Promise<Array<Record<string, unknown>>> {
  return get<Array<Record<string, unknown>>>(`/calendar/channels/${companyId}`);
}
