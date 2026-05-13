import { memo } from 'react';
import { Video } from 'lucide-react';
import type { Message } from '../../types';
import { isMobileBridge } from '../../lib/mobileBridge';
import { bridge } from '../../lib/flutterBridge';

const VIDEO_MSG_RE = /^📹 Videokonferenz gestartet um (\d{2}:\d{2}) Uhr\nJetzt beitreten: (https?:\/\/stash\.cat\/l\/[a-zA-Z0-9_-]+)$/;

export function isVideoMeetingMessage(msg: Message): boolean {
  return VIDEO_MSG_RE.test(msg.text || '');
}

function VideoMeetingCardImpl({ msg }: { msg: Message }) {
  const match = (msg.text || '').match(VIDEO_MSG_RE);
  if (!match) return null;
  const [, startTime, link] = match;
  const senderName = msg.sender ? `${msg.sender.first_name ?? ''} ${msg.sender.last_name ?? ''}`.trim() || 'Jemand' : 'Jemand';
  const date = msg.time
    ? new Date(msg.time * 1000).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : '';

  return (
    <div className="flex justify-center py-3">
      <div className="w-full max-w-sm overflow-hidden rounded-2xl border-2 border-primary-300 bg-gradient-to-br from-primary-500 to-primary-700 shadow-lg dark:border-primary-600">
        <div className="flex items-center gap-3 px-5 py-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/20 text-2xl">
            📹
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-base font-bold text-white">Videokonferenz läuft!</p>
            <p className="text-xs text-primary-100">
              Gestartet von {senderName} · {date && `${date}, `}{startTime} Uhr
            </p>
          </div>
        </div>
        <div className="px-5 pb-4">
          <a
            href={link}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => {
              if (isMobileBridge()) {
                e.preventDefault();
                bridge.jitsi(link);
              }
            }}
            className="flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-primary-700 shadow transition hover:bg-primary-50 active:scale-95"
          >
            <Video size={16} />
            🎙️ Jetzt beitreten
          </a>
          <p className="mt-2 text-center text-xs text-primary-200">
            Link ist 2 Stunden gültig
          </p>
        </div>
      </div>
    </div>
  );
}

export const VideoMeetingCard = memo(VideoMeetingCardImpl);
