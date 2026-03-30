import { Hash, Star } from 'lucide-react';
import Avatar from './Avatar';
import type { ChatTarget } from '../types';

interface FavoriteCardsViewProps {
  channels: ChatTarget[];
  onSelectChat: (target: ChatTarget) => void;
}

export default function FavoriteCardsView({ channels, onSelectChat }: FavoriteCardsViewProps) {
  const favorites = channels.filter((ch) => ch.type === 'channel' && ch.favorite);

  if (favorites.length === 0) {
    return (
      <div className="flex h-full flex-1 flex-col items-center justify-center bg-white text-surface-500 dark:bg-surface-950">
        <Star size={64} className="mb-4 text-surface-300 dark:text-surface-600" />
        <h2 className="text-xl font-semibold text-surface-600 dark:text-surface-500">
          Keine Favoriten
        </h2>
        <p className="mt-2 max-w-md text-center text-sm text-surface-500">
          Markiere Channels als Favorit, um sie hier als Kacheln zu sehen.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-1 flex-col bg-white dark:bg-surface-950">
      <div className="shrink-0 border-b border-surface-200 px-6 py-4 dark:border-surface-700">
        <h2 className="text-lg font-semibold text-surface-900 dark:text-white">
          Favorisierte Channels
        </h2>
        <p className="text-sm text-surface-500">
          {favorites.length} Channel{favorites.length !== 1 ? 's' : ''} als Favorit markiert
        </p>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-4">
          {favorites.map((ch) => (
            <ChannelCard
              key={ch.id}
              channel={ch}
              onClick={() => onSelectChat(ch)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function ChannelCard({ channel, onClick }: { channel: ChatTarget; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group relative flex flex-col items-center rounded-xl bg-surface-50 p-4 text-center transition hover:bg-surface-200 hover:shadow-md dark:bg-surface-800 dark:hover:bg-surface-700"
    >
      {(channel.unread_count ?? 0) > 0 && (
        <span className="absolute right-2 top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-xs font-bold text-white">
          {channel.unread_count! > 99 ? '99+' : channel.unread_count}
        </span>
      )}
      <div className="relative">
        {channel.image ? (
          <Avatar name={channel.name} image={channel.image} size="lg" />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary-100 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400">
            <Hash size={24} />
          </div>
        )}
      </div>
      <span className="mt-3 line-clamp-2 w-full text-sm font-medium text-surface-700 group-hover:text-surface-900 dark:text-surface-300 dark:group-hover:text-white">
        {channel.name}
      </span>
      {channel.encrypted && (
        <span className="mt-1 text-xs text-surface-500" title="Verschlüsselt">🔒</span>
      )}
    </button>
  );
}
