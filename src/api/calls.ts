/**
 * Call (WebRTC audio) API endpoints.
 */

import { post } from './core';

export interface TurnServer {
  stun_turn_url: string;
  port: number;
  username: string;
  password: string;
}

export interface CallParty {
  id: string;
  first_name: string;
  last_name: string;
  image?: string;
}

export interface CallInfo {
  id: number;
  caller: CallParty;
  callee: CallParty;
  type: 'audio' | 'video';
  target: string;
  target_id: number;
  created_at: number;
  started_at: number | null;
  ended_at: number | null;
  verification: string;
  status: string;
  turn_server: TurnServer;
}

export async function getTurnServer(): Promise<TurnServer> {
  return post<TurnServer>('/call/get_turn_server');
}

export async function createCall(params: {
  calleeId: string;
  targetId: string;
  verification: string;
  type?: 'audio';
}): Promise<CallInfo> {
  return post<CallInfo>('/call/create', {
    callee_id: params.calleeId,
    target_id: params.targetId,
    target: 'conversation',
    type: params.type ?? 'audio',
    verification: params.verification,
  });
}

export async function sendCallSignal(signal: Record<string, unknown>): Promise<void> {
  await post('/call/signal', signal);
}

export async function endCall(callId: number): Promise<void> {
  await post('/call/end', { call_id: callId }).catch(() => {});
}
