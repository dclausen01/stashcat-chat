import { useState, useRef, useCallback, useEffect } from 'react';
import { useRealtimeEvents } from './useRealtimeEvents';
import { useAuth } from '../context/AuthContext';
import {
  getTurnServer,
  createCall,
  sendCallSignal,
  endCall,
  type CallParty,
  type TurnServer,
} from '../api/calls';

export type CallStatus =
  | 'idle'
  | 'calling'      // outgoing: created, waiting for ringing
  | 'ringing'      // outgoing: callee is ringing
  | 'incoming'     // incoming call waiting for user action
  | 'connecting'   // incoming: accepted, establishing connection
  | 'connected'    // call active
  | 'ended';       // call ended (briefly shown before null)

export interface ActiveCall {
  status: CallStatus;
  callId: number;
  direction: 'outgoing' | 'incoming';
  otherParty: CallParty;
  startedAt?: number;
  error?: string;
}

interface SignalEvent {
  call_id: number;
  fromUserId: number;
  toUserId: number;
  sdp?: string;
  signalType: string;
  candidates?: Record<string, RTCIceCandidateInit & { candidate: string }>;
  deviceId?: string;
}

interface CallCreatedSSEEvent {
  call: {
    id: number;
    caller: CallParty;
    callee: CallParty;
    target_id: number;
    turn_server: TurnServer;
  };
}

function waitForIceGathering(pc: RTCPeerConnection): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') { resolve(); return; }
    const handler = () => {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', handler);
        resolve();
      }
    };
    pc.addEventListener('icegatheringstatechange', handler);
    // Fallback: resolve after 5s regardless
    setTimeout(resolve, 5000);
  });
}

export function useCallManager(enabled: boolean) {
  const { user } = useAuth();
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [isMuted, setIsMuted] = useState(false);

  // Use ref so SSE handlers always read the latest call state without stale closures
  const activeCallRef = useRef<ActiveCall | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const pendingOfferRef = useRef<string | null>(null);
  const pendingCandidatesRef = useRef<(RTCIceCandidateInit & { candidate: string })[]>([]);

  useEffect(() => { activeCallRef.current = activeCall; }, [activeCall]);

  // Create persistent remote audio element
  useEffect(() => {
    const audio = new Audio();
    audio.autoplay = true;
    remoteAudioRef.current = audio;
    return () => { audio.srcObject = null; };
  }, []);

  const cleanup = useCallback(() => {
    if (peerRef.current) { peerRef.current.close(); peerRef.current = null; }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(t => t.stop());
      localStreamRef.current = null;
    }
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
    pendingOfferRef.current = null;
    pendingCandidatesRef.current = [];
    setIsMuted(false);
  }, []);

  const finishCall = useCallback((callId?: number) => {
    cleanup();
    setActiveCall(null);
    activeCallRef.current = null;
    if (callId) endCall(callId).catch(() => {});
  }, [cleanup]);

  const buildPeerConnection = useCallback((turnServer: TurnServer): RTCPeerConnection => {
    const pc = new RTCPeerConnection({
      iceServers: [{
        urls: `${turnServer.stun_turn_url}:${turnServer.port}`,
        username: turnServer.username,
        credential: turnServer.password,
      }],
    });
    pc.ontrack = (e) => {
      if (remoteAudioRef.current && e.streams[0]) {
        remoteAudioRef.current.srcObject = e.streams[0];
      }
    };
    return pc;
  }, []);

  // ── Outgoing call ─────────────────────────────────────────────────────────

  const startCall = useCallback(async (calleeId: string, targetId: string, callee: CallParty) => {
    if (activeCallRef.current) return;

    try {
      const turnServer = await getTurnServer();
      const pc = buildPeerConnection(turnServer);
      peerRef.current = pc;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;
      stream.getTracks().forEach(t => pc.addTrack(t, stream));

      const verification = crypto.randomUUID();
      const callInfo = await createCall({ calleeId, targetId, verification });

      const newCall: ActiveCall = {
        status: 'calling',
        callId: callInfo.id,
        direction: 'outgoing',
        otherParty: callee,
      };
      setActiveCall(newCall);
      activeCallRef.current = newCall;

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitForIceGathering(pc);

      await sendCallSignal({
        call_id: callInfo.id,
        fromUserId: Number(user?.id),
        toUserId: Number(calleeId),
        sdp: pc.localDescription?.sdp,
        signalType: 'offer',
      });

    } catch (err) {
      cleanup();
      const msg = err instanceof Error ? err.message : 'Anruf fehlgeschlagen';
      setActiveCall(prev => prev ? { ...prev, status: 'ended', error: msg } : {
        status: 'ended', callId: 0, direction: 'outgoing',
        otherParty: callee, error: msg,
      });
      activeCallRef.current = null;
      setTimeout(() => { setActiveCall(null); }, 3000);
    }
  }, [user, buildPeerConnection, cleanup]);

  // ── Incoming call: accept ─────────────────────────────────────────────────

  const acceptCall = useCallback(async () => {
    const call = activeCallRef.current;
    if (!call || call.status !== 'incoming') return;

    try {
      // Wait up to 5s for the offer to arrive via SSE
      let waited = 0;
      while (!pendingOfferRef.current && waited < 50) {
        await new Promise(r => setTimeout(r, 100));
        waited++;
      }
      if (!pendingOfferRef.current) throw new Error('Kein Angebot vom Anrufer erhalten');

      const updated: ActiveCall = { ...call, status: 'connecting' };
      setActiveCall(updated);
      activeCallRef.current = updated;

      const turnServer = await getTurnServer();
      const pc = buildPeerConnection(turnServer);
      peerRef.current = pc;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;
      stream.getTracks().forEach(t => pc.addTrack(t, stream));

      await pc.setRemoteDescription({ type: 'offer', sdp: pendingOfferRef.current });

      // Apply any ICE candidates buffered before accept
      for (const c of pendingCandidatesRef.current) {
        if (c.candidate) await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
      }
      pendingCandidatesRef.current = [];

      // Notify caller that we're ringing
      await sendCallSignal({
        call_id: call.callId,
        fromUserId: Number(user?.id),
        toUserId: Number(call.otherParty.id),
        signalType: 'ringing',
      });

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForIceGathering(pc);

      await sendCallSignal({
        call_id: call.callId,
        fromUserId: Number(user?.id),
        toUserId: Number(call.otherParty.id),
        sdp: pc.localDescription?.sdp,
        signalType: 'answer',
      });

      const connected: ActiveCall = { ...call, status: 'connected', startedAt: Date.now() };
      setActiveCall(connected);
      activeCallRef.current = connected;

    } catch (err) {
      cleanup();
      const msg = err instanceof Error ? err.message : 'Verbindung fehlgeschlagen';
      setActiveCall(prev => prev ? { ...prev, status: 'ended', error: msg } : null);
      activeCallRef.current = null;
      setTimeout(() => { setActiveCall(null); }, 3000);
    }
  }, [user, buildPeerConnection, cleanup]);

  // ── Incoming call: reject ─────────────────────────────────────────────────

  const rejectCall = useCallback(async () => {
    const call = activeCallRef.current;
    if (!call) return;
    await sendCallSignal({
      call_id: call.callId,
      fromUserId: Number(user?.id),
      toUserId: Number(call.otherParty.id),
      signalType: 'quit',
    }).catch(() => {});
    finishCall(call.callId);
  }, [user, finishCall]);

  // ── Hang up (both sides) ──────────────────────────────────────────────────

  const hangUp = useCallback(async () => {
    const call = activeCallRef.current;
    if (!call) return;
    await sendCallSignal({
      call_id: call.callId,
      fromUserId: Number(user?.id),
      toUserId: Number(call.otherParty.id),
      signalType: 'quit',
    }).catch(() => {});
    finishCall(call.callId);
  }, [user, finishCall]);

  // ── Mute toggle ───────────────────────────────────────────────────────────

  const toggleMute = useCallback(() => {
    setIsMuted(prev => {
      const next = !prev;
      localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = !next; });
      return next;
    });
  }, []);

  // ── SSE event handlers ────────────────────────────────────────────────────

  const handleCallCreated = useCallback((data: unknown) => {
    const event = data as CallCreatedSSEEvent;
    if (!user || !event?.call) return;
    const call = event.call;
    // Only react if we're the callee
    if (String(call.callee.id) !== String(user.id)) return;
    // Don't interrupt an active call
    if (activeCallRef.current) return;

    const incoming: ActiveCall = {
      status: 'incoming',
      callId: call.id,
      direction: 'incoming',
      otherParty: call.caller,
    };
    setActiveCall(incoming);
    activeCallRef.current = incoming;
  }, [user]);

  const handleCallSignal = useCallback((data: unknown) => {
    const signal = data as SignalEvent;
    const call = activeCallRef.current;
    if (!call || signal.call_id !== call.callId) return;

    switch (signal.signalType) {
      case 'ringing':
        if (call.direction === 'outgoing') {
          setActiveCall(prev => prev ? { ...prev, status: 'ringing' } : null);
        }
        break;

      case 'offer':
        // Callee stores latest offer (used in acceptCall)
        if (call.direction === 'incoming') {
          pendingOfferRef.current = signal.sdp ?? null;
        }
        break;

      case 'answer':
        // Caller receives answer → set remote description
        if (call.direction === 'outgoing' && peerRef.current && signal.sdp) {
          peerRef.current.setRemoteDescription({ type: 'answer', sdp: signal.sdp })
            .then(() => sendCallSignal({
              call_id: call.callId,
              fromUserId: Number(user?.id),
              toUserId: Number(call.otherParty.id),
              signalType: 'answer_received',
            }))
            .then(() => {
              const connected: ActiveCall = { ...call, status: 'connected', startedAt: Date.now() };
              setActiveCall(connected);
              activeCallRef.current = connected;
            })
            .catch(console.error);
        }
        break;

      case 'candidate':
        if (signal.candidates) {
          const candidates = Object.values(signal.candidates);
          if (peerRef.current) {
            candidates.forEach(c => {
              if (c.candidate) peerRef.current!.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
            });
          } else {
            pendingCandidatesRef.current.push(...candidates);
          }
        }
        break;

      case 'quit':
        cleanup();
        setActiveCall(prev => prev ? { ...prev, status: 'ended' } : null);
        activeCallRef.current = null;
        setTimeout(() => setActiveCall(null), 2000);
        break;
    }
  }, [user, cleanup]);

  const handleCallChange = useCallback((data: unknown) => {
    const change = data as { object?: { id: number; status: string } };
    const call = activeCallRef.current;
    if (!call || !change?.object || change.object.id !== call.callId) return;

    if (change.object.status === 'ended' || change.object.status === 'missed') {
      cleanup();
      setActiveCall(prev => prev ? { ...prev, status: 'ended' } : null);
      activeCallRef.current = null;
      setTimeout(() => setActiveCall(null), 2000);
    }
  }, [cleanup]);

  useRealtimeEvents({
    call_created: handleCallCreated,
    call_signal: handleCallSignal,
    call_change: handleCallChange,
  }, enabled);

  return { activeCall, startCall, acceptCall, rejectCall, hangUp, isMuted, toggleMute };
}
