import { useRef, useState } from 'react';
import { Mic, Play, Pause } from 'lucide-react';
import { clsx } from 'clsx';
import * as api from '../../api';
import type { Message } from '../../types';

export function VoiceMessagePlayer({
  file,
  isOwn,
}: {
  file: NonNullable<Message['files']>[number];
  isOwn: boolean;
}) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef<HTMLAudioElement>(null);
  const viewUrl = api.fileViewUrl(file.id, file.name);

  const fmt = (secs: number) => {
    if (!isFinite(secs) || isNaN(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const togglePlay = () => {
    const a = audioRef.current;
    if (!a) return;
    if (isPlaying) { a.pause(); } else { void a.play(); }
  };

  return (
    <div className={clsx(
      'flex items-center gap-2.5 rounded-xl px-3 py-2.5 min-w-[180px] max-w-[280px]',
      isOwn
        ? 'bg-primary-700 text-primary-100'
        : 'bg-surface-200 text-surface-700 dark:bg-surface-700 dark:text-surface-200',
    )}>
      <audio
        ref={audioRef}
        src={viewUrl}
        onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime ?? 0)}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration ?? 0)}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => {
          setIsPlaying(false);
          setCurrentTime(0);
          if (audioRef.current) audioRef.current.currentTime = 0;
        }}
        preload="metadata"
      />
      <Mic size={13} className="shrink-0 opacity-60" />
      <button
        onClick={togglePlay}
        aria-label={isPlaying ? 'Pause' : 'Abspielen'}
        className={clsx(
          'flex shrink-0 items-center justify-center rounded-full p-1 transition',
          isOwn ? 'hover:bg-primary-600' : 'hover:bg-surface-300 dark:hover:bg-surface-600',
        )}
      >
        {isPlaying ? <Pause size={16} className="fill-current" /> : <Play size={16} className="fill-current" />}
      </button>
      <div className="relative flex min-w-[60px] flex-1 items-center">
        <div className={clsx(
          'pointer-events-none absolute h-1.5 w-full rounded-full',
          isOwn ? 'bg-primary-500/40' : 'bg-surface-400/50 dark:bg-surface-500/50',
        )} />
        <div
          className={clsx(
            'pointer-events-none absolute h-1.5 rounded-full',
            isOwn ? 'bg-primary-100' : 'bg-surface-500 dark:bg-surface-300',
          )}
          style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
        />
        <input
          type="range"
          min={0}
          max={duration > 0 ? duration : 100}
          value={currentTime}
          step={0.1}
          onChange={(e) => {
            const t = Number(e.target.value);
            setCurrentTime(t);
            if (audioRef.current) audioRef.current.currentTime = t;
          }}
          className="relative h-1.5 w-full cursor-pointer appearance-none bg-transparent"
          style={{ accentColor: isOwn ? 'rgba(255,255,255,0.9)' : undefined }}
        />
      </div>
      <span className="shrink-0 tabular-nums font-mono text-xs opacity-75">
        {fmt(isPlaying || currentTime > 0 ? currentTime : duration)}
      </span>
    </div>
  );
}
