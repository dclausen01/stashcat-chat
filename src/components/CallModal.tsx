import { useState, useEffect } from 'react';
import { Phone, PhoneOff, Mic, MicOff } from 'lucide-react';
import { clsx } from 'clsx';
import type { ActiveCall } from '../hooks/useCallManager';

interface CallModalProps {
  call: ActiveCall;
  onAccept: () => void;
  onReject: () => void;
  onHangUp: () => void;
  isMuted: boolean;
  onToggleMute: () => void;
}

const COLORS = [
  'bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-orange-500',
  'bg-pink-500', 'bg-teal-500', 'bg-indigo-500', 'bg-rose-500',
];
function avatarColor(name: string): string {
  let h = 0;
  for (const c of name) h = c.charCodeAt(0) + ((h << 5) - h);
  return COLORS[Math.abs(h) % COLORS.length];
}
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('') || '?';
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, '0')}`;
}

export default function CallModal({
  call, onAccept, onReject, onHangUp, isMuted, onToggleMute,
}: CallModalProps) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (call.status !== 'connected' || !call.startedAt) return;
    setElapsed(Date.now() - call.startedAt);
    const id = setInterval(() => setElapsed(Date.now() - call.startedAt!), 1000);
    return () => clearInterval(id);
  }, [call.status, call.startedAt]);

  const party = call.otherParty;
  const name = `${party.first_name} ${party.last_name}`;

  const statusLabel: Record<string, string> = {
    calling: 'Wird angerufen…',
    ringing: 'Klingelt…',
    incoming: 'Eingehender Anruf',
    connecting: 'Verbinde…',
    connected: formatDuration(elapsed),
    ended: call.error ?? 'Anruf beendet',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className={clsx(
        'w-72 rounded-2xl shadow-2xl p-6 flex flex-col items-center gap-5',
        'bg-surface-900 border border-surface-700 text-white',
        call.status === 'ended' && 'opacity-70',
      )}>
        {/* Avatar — large for quick identification */}
        <div className="relative mt-1">
          {party.image ? (
            <img
              src={party.image}
              alt={name}
              className="w-24 h-24 rounded-full object-cover shadow-lg"
            />
          ) : (
            <div className={clsx(
              'w-24 h-24 rounded-full flex items-center justify-center text-3xl font-semibold text-white shadow-lg',
              avatarColor(name),
            )}>
              {initials(name)}
            </div>
          )}
          {call.status === 'connected' && (
            <span className="absolute bottom-0.5 right-0.5 w-5 h-5 rounded-full bg-green-400 border-2 border-surface-900 animate-pulse" />
          )}
        </div>

        {/* Name + status */}
        <div className="text-center">
          <p className="text-base font-semibold leading-tight">{name}</p>
          <p className={clsx(
            'text-sm mt-1',
            call.status === 'connected' ? 'text-green-400 font-mono' : 'text-surface-400',
          )}>
            {statusLabel[call.status] ?? ''}
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-5 mt-1">
          {call.status === 'incoming' ? (
            <>
              <button
                onClick={onReject}
                className="w-14 h-14 rounded-full bg-red-500 hover:bg-red-600 active:bg-red-700 flex items-center justify-center transition"
                title="Ablehnen"
              >
                <PhoneOff size={22} />
              </button>
              <button
                onClick={onAccept}
                className="w-14 h-14 rounded-full bg-green-500 hover:bg-green-600 active:bg-green-700 flex items-center justify-center transition"
                title="Annehmen"
              >
                <Phone size={22} />
              </button>
            </>
          ) : call.status === 'connected' ? (
            <>
              <button
                onClick={onToggleMute}
                className={clsx(
                  'w-12 h-12 rounded-full flex items-center justify-center transition',
                  isMuted
                    ? 'bg-red-500 hover:bg-red-600'
                    : 'bg-surface-700 hover:bg-surface-600',
                )}
                title={isMuted ? 'Stummschaltung aufheben' : 'Stumm schalten'}
              >
                {isMuted ? <MicOff size={20} /> : <Mic size={20} />}
              </button>
              <button
                onClick={onHangUp}
                className="w-14 h-14 rounded-full bg-red-500 hover:bg-red-600 active:bg-red-700 flex items-center justify-center transition"
                title="Auflegen"
              >
                <PhoneOff size={22} />
              </button>
            </>
          ) : call.status !== 'ended' ? (
            <button
              onClick={onHangUp}
              className="w-14 h-14 rounded-full bg-red-500 hover:bg-red-600 active:bg-red-700 flex items-center justify-center transition"
              title="Abbrechen"
            >
              <PhoneOff size={22} />
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
