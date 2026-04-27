import { useState, useCallback, useMemo } from 'react';
import { Hash, Star, ArrowUpDown, ArrowDownAZ, Hand, ChevronDown } from 'lucide-react';
import Avatar from './Avatar';
import { useSettings } from '../context/SettingsContext';
import type { ChatTarget } from '../types';

interface FavoriteCardsViewProps {
  channels: ChatTarget[];
  conversations: ChatTarget[];
  onSelectChat: (target: ChatTarget) => void;
  onOpenSidebar?: () => void;
}

const MANUAL_ORDER_KEY = 'schulchat_favorite_manual_order';

function loadManualOrder(): string[] {
  try {
    const raw = localStorage.getItem(MANUAL_ORDER_KEY);
    if (raw) return JSON.parse(raw) as string[];
  } catch { /* ignore */ }
  return [];
}

function saveManualOrder(order: string[]) {
  localStorage.setItem(MANUAL_ORDER_KEY, JSON.stringify(order));
}

export default function FavoriteCardsView({ channels, conversations, onSelectChat, onOpenSidebar }: FavoriteCardsViewProps) {
  const { favoriteCardsSortMode, setFavoriteCardsSortMode } = useSettings();
  const [manualOrder, setManualOrder] = useState<string[]>(loadManualOrder);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const sortFavs = (favs: ChatTarget[]) => {
    switch (favoriteCardsSortMode) {
      case 'alphabetical':
        return [...favs].sort((a, b) => a.name.localeCompare(b.name));
      case 'manual': {
        const orderMap = new Map<string, number>();
        manualOrder.forEach((id, idx) => orderMap.set(id, idx));
        return [...favs].sort((a, b) => {
          const ai = orderMap.get(a.id);
          const bi = orderMap.get(b.id);
          if (ai !== undefined && bi !== undefined) return ai - bi;
          if (ai !== undefined) return -1;
          if (bi !== undefined) return 1;
          return a.name.localeCompare(b.name);
        });
      }
      default:
        return favs;
    }
  };

  const favorites = useMemo(() => sortFavs(channels.filter((ch) => ch.favorite)), [channels, favoriteCardsSortMode, manualOrder]);
  const favoritesConvs = useMemo(() => sortFavs(conversations.filter((ch) => ch.favorite)), [conversations, favoriteCardsSortMode, manualOrder]);

  const handleDragStart = useCallback((e: React.DragEvent, id: string) => {
    if (favoriteCardsSortMode !== 'manual') {
      e.preventDefault();
      return;
    }
    setDraggingId(id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  }, [favoriteCardsSortMode]);

  const handleDragOver = useCallback((e: React.DragEvent, id: string) => {
    if (favoriteCardsSortMode !== 'manual' || !draggingId || draggingId === id) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverId(id);
  }, [favoriteCardsSortMode, draggingId]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverId(null);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    setDragOverId(null);
    const sourceId = e.dataTransfer.getData('text/plain') || draggingId;
    if (!sourceId || sourceId === targetId) {
      setDraggingId(null);
      return;
    }

    setManualOrder((prev) => {
      const favIds = [...favorites.map((f) => f.id), ...favoritesConvs.map((f) => f.id)];
      const currentOrder = prev.filter((id) => favIds.includes(id));
      // Ensure all favorites are in the order list
      for (const id of favIds) {
        if (!currentOrder.includes(id)) currentOrder.push(id);
      }
      const fromIndex = currentOrder.indexOf(sourceId);
      const toIndex = currentOrder.indexOf(targetId);
      if (fromIndex === -1 || toIndex === -1) {
        setDraggingId(null);
        return prev;
      }
      const newOrder = [...currentOrder];
      newOrder.splice(fromIndex, 1);
      newOrder.splice(toIndex, 0, sourceId);
      saveManualOrder(newOrder);
      return newOrder;
    });
    setDraggingId(null);
  }, [draggingId, favorites, favoritesConvs]);

  const handleDragEnd = useCallback(() => {
    setDraggingId(null);
    setDragOverId(null);
  }, []);

  if (favorites.length === 0 && favoritesConvs.length === 0) {
    return (
      <div className="flex h-full flex-1 flex-col items-center justify-center bg-white text-surface-500 dark:bg-surface-950">
        <Star size={64} className="mb-4 text-surface-300 dark:text-surface-400" />
        <h2 className="text-xl font-semibold text-surface-600 dark:text-surface-500">
          Keine Favoriten
        </h2>
        <p className="mt-2 max-w-md text-center text-sm text-surface-500">
          Markiere Channels oder Konversationen als Favorit, um sie hier als Kacheln zu sehen.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-1 flex-col bg-white dark:bg-surface-950">
      <div className="shrink-0 border-b border-surface-200 px-6 py-4 dark:border-surface-700">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <button
              onClick={onOpenSidebar}
              className="flex items-center gap-1.5 text-left md:cursor-default"
              title="Menü öffnen"
            >
              <h2 className="text-lg font-semibold text-surface-900 dark:text-white">
                Favoriten
              </h2>
              <ChevronDown size={14} className="shrink-0 text-surface-400 md:hidden" />
            </button>
            <p className="text-sm text-surface-500">
              {favorites.length + favoritesConvs.length} {favorites.length + favoritesConvs.length !== 1 ? 'Favoriten' : 'Favorit'}
            </p>
          </div>
          <div className="flex items-center gap-1 rounded-lg bg-surface-100 p-1 dark:bg-surface-800">
            <SortModeButton
              active={favoriteCardsSortMode === 'sidebar'}
              onClick={() => setFavoriteCardsSortMode('sidebar')}
              icon={<ArrowUpDown size={14} />}
              label="Sidebar"
            />
            <SortModeButton
              active={favoriteCardsSortMode === 'alphabetical'}
              onClick={() => setFavoriteCardsSortMode('alphabetical')}
              icon={<ArrowDownAZ size={14} />}
              label="A-Z"
            />
            <SortModeButton
              active={favoriteCardsSortMode === 'manual'}
              onClick={() => setFavoriteCardsSortMode('manual')}
              icon={<Hand size={14} />}
              label="Manuell"
            />
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-3 sm:p-6">
        {/* Channels section */}
        <FavoriteSection
          title="Favorisierte Channels"
          channels={favorites.filter((ch) => ch.type === 'channel')}
          onSelectChat={onSelectChat}
          favoriteCardsSortMode={favoriteCardsSortMode}
          draggingId={draggingId}
          dragOverId={dragOverId}
          handleDragStart={handleDragStart}
          handleDragOver={handleDragOver}
          handleDragLeave={handleDragLeave}
          handleDrop={handleDrop}
          handleDragEnd={handleDragEnd}
        />

        {/* Conversations section — separator + same layout */}
        <FavoriteSection
          title="Favorisierte Direktnachrichten"
          channels={favoritesConvs}
          onSelectChat={onSelectChat}
          favoriteCardsSortMode={favoriteCardsSortMode}
          draggingId={draggingId}
          dragOverId={dragOverId}
          handleDragStart={handleDragStart}
          handleDragOver={handleDragOver}
          handleDragLeave={handleDragLeave}
          handleDrop={handleDrop}
          handleDragEnd={handleDragEnd}
        />
      </div>
    </div>
  );
}

function SortModeButton({ active, onClick, icon, label }: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={
        `flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition ` +
        (active
          ? 'bg-white text-primary-600 shadow-sm dark:bg-surface-700 dark:text-primary-400'
          : 'text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-200')
      }
      title={label}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

interface FavoriteSectionProps {
  title: string;
  channels: ChatTarget[];
  onSelectChat: (target: ChatTarget) => void;
  favoriteCardsSortMode: 'sidebar' | 'alphabetical' | 'manual';
  draggingId: string | null;
  dragOverId: string | null;
  handleDragStart: (e: React.DragEvent, id: string) => void;
  handleDragOver: (e: React.DragEvent, id: string) => void;
  handleDragLeave: (e: React.DragEvent) => void;
  handleDrop: (e: React.DragEvent, id: string) => void;
  handleDragEnd: () => void;
}

function FavoriteSection({
  title,
  channels,
  onSelectChat,
  favoriteCardsSortMode,
  draggingId,
  dragOverId,
  handleDragStart,
  handleDragOver,
  handleDragLeave,
  handleDrop,
  handleDragEnd,
}: FavoriteSectionProps) {
  if (channels.length === 0) return null;

  const isConversation = channels[0]?.type === 'conversation';

  return (
    <div className="mb-6">
      {/* Section title */}
      <h3 className="mb-3 px-1 text-xs font-semibold uppercase tracking-wider text-surface-500">
        {title}
      </h3>

      {/* Mobile: List layout */}
      <div className="flex flex-col gap-2 md:hidden">
        {channels.map((ch) => (
          <button
            key={ch.id}
            onClick={() => onSelectChat(ch)}
            draggable={favoriteCardsSortMode === 'manual'}
            onDragStart={favoriteCardsSortMode === 'manual' ? (e) => handleDragStart(e, ch.id) : undefined}
            onDragOver={favoriteCardsSortMode === 'manual' ? (e) => handleDragOver(e, ch.id) : undefined}
            onDragLeave={handleDragLeave}
            onDrop={favoriteCardsSortMode === 'manual' ? (e) => handleDrop(e, ch.id) : undefined}
            onDragEnd={handleDragEnd}
            className="group flex items-center gap-3 rounded-lg bg-surface-50 p-3 text-left transition hover:bg-surface-200 dark:bg-surface-800 dark:hover:bg-surface-700"
          >
            <div className="relative shrink-0">
              {ch.image ? (
                <Avatar name={ch.name} image={ch.image} size="md" />
              ) : isConversation ? (
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-200 text-surface-600 dark:bg-surface-700 dark:text-surface-300">
                  <span className="text-sm font-medium">{ch.name.charAt(0).toUpperCase()}</span>
                </div>
              ) : (
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-100 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400">
                  <Hash size={18} />
                </div>
              )}
              {(ch.unread_count ?? 0) > 0 && (
                <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-xs font-bold text-white">
                  {(ch.unread_count ?? 0) > 99 ? '99+' : ch.unread_count}
                </span>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-surface-700 group-hover:text-surface-900 dark:text-surface-300 dark:group-hover:text-white">
                  {ch.name}
                </span>
                {ch.encrypted && <span className="shrink-0 text-xs text-surface-500">🔒</span>}
              </div>
            </div>
          </button>
        ))}
      </div>

      {/* Desktop: Grid layout */}
      <div className="hidden grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-4 md:grid">
        {channels.map((ch) => (
          <ChannelCard
            key={ch.id}
            channel={ch}
            onClick={() => onSelectChat(ch)}
            draggable={favoriteCardsSortMode === 'manual'}
            isDragging={draggingId === ch.id}
            isDragOver={dragOverId === ch.id}
            onDragStart={(e) => handleDragStart(e, ch.id)}
            onDragOver={(e) => handleDragOver(e, ch.id)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, ch.id)}
            onDragEnd={handleDragEnd}
          />
        ))}
      </div>
    </div>
  );
}

interface ChannelCardProps {
  channel: ChatTarget;
  onClick: () => void;
  draggable: boolean;
  isDragging: boolean;
  isDragOver: boolean;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  onDragEnd: () => void;
}

function ChannelCard({
  channel,
  onClick,
  draggable,
  isDragging,
  isDragOver,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}: ChannelCardProps) {
  const isConversation = channel.type === 'conversation';
  return (
    <button
      onClick={onClick}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={
        `group relative flex flex-col items-center rounded-xl bg-surface-50 p-4 text-center transition ` +
        `hover:bg-surface-200 hover:shadow-md dark:bg-surface-800 dark:hover:bg-surface-700 ` +
        (isDragging ? 'opacity-40' : '') +
        (isDragOver ? ' ring-2 ring-primary-400 dark:ring-primary-500' : '') +
        (draggable ? ' cursor-move' : ' cursor-pointer')
      }
    >
      {(channel.unread_count ?? 0) > 0 && (
        <span className="absolute right-2 top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-xs font-bold text-white">
          {(channel.unread_count ?? 0) > 99 ? '99+' : channel.unread_count}
        </span>
      )}
      <div className="relative">
        {channel.image ? (
          <Avatar name={channel.name} image={channel.image} size="lg" />
        ) : isConversation ? (
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-200 text-lg font-medium text-surface-600 dark:bg-surface-700 dark:text-surface-300">
            {channel.name.charAt(0).toUpperCase()}
          </div>
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
