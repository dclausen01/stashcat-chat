import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Hash, Star, MoreHorizontal, Mail, Info, LogOut, Trash2, Archive, Loader2, Plus, ChevronDown } from 'lucide-react';
import { clsx } from 'clsx';
import Avatar from './Avatar';
import { ChannelInfoModal, LeaveConfirmModal, DeleteConfirmModal } from './ChannelDropdownMenu';
import * as api from '../api';
import type { ChatTarget } from '../types';
import { getParentId } from '../utils/subchannels';

interface ChatItemProps {
  target: ChatTarget;
  active: boolean;
  onSelect: (t: ChatTarget) => void;
  onToggleFavorite?: (t: ChatTarget) => void;
  onMarkUnread?: (t: ChatTarget) => void;
  onChannelDeleted?: (t: ChatTarget) => void;
  onChannelLeft?: (t: ChatTarget) => void;
  onConversationArchived?: (t: ChatTarget) => void;
  /** All channels — passed to DeleteConfirmModal for subchannel awareness */
  channels?: ChatTarget[];
  /** Render in a smaller variant — used for subchannels in the sidebar tree */
  compact?: boolean;
  /** Triggered from the three-dot menu — pass parent's raw name (with marker if any) */
  onAddSubchannel?: (parentId: string) => void;
  /** Subchannel-tree expand state. When defined, a chevron appears after the name. */
  expanded?: boolean;
  onToggleExpand?: () => void;
}

function ArchiveConversationModal({ target, onClose, onArchived }: {
  target: ChatTarget;
  onClose: () => void;
  onArchived: () => void;
}) {
  const [archiving, setArchiving] = useState(false);

  const handleArchive = async () => {
    setArchiving(true);
    try {
      await api.archiveConversation(target.id);
      onArchived();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Archivieren fehlgeschlagen');
      setArchiving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-sm rounded-2xl bg-white shadow-2xl dark:bg-surface-900"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex flex-col items-center px-6 pt-6 pb-2 text-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30">
            <Archive size={28} className="text-blue-500" />
          </div>
          <h3 className="text-lg font-semibold text-surface-900 dark:text-white">Konversation archivieren</h3>
          <p className="mt-2 text-sm text-surface-500">
            Möchtest du die Konversation mit <strong>"{target.name}"</strong> wirklich archivieren?
          </p>
        </div>
        <div className="flex gap-2 px-6 pb-6 pt-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-surface-300 px-4 py-2 text-sm font-medium text-surface-700 transition hover:bg-surface-200 dark:border-surface-600 dark:text-surface-300 dark:hover:bg-surface-800"
          >
            Abbrechen
          </button>
          <button
            onClick={handleArchive}
            disabled={archiving}
            className={clsx(
              'flex flex-1 items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-white transition',
              archiving ? 'cursor-not-allowed bg-blue-300' : 'bg-blue-500 hover:bg-blue-600',
            )}
          >
            {archiving ? <Loader2 size={16} className="animate-spin" /> : null}
            Archivieren
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ChatItem({
  target,
  active,
  onSelect,
  onToggleFavorite,
  onMarkUnread,
  onChannelDeleted,
  onChannelLeft,
  onConversationArchived,
  channels,
  compact = false,
  onAddSubchannel,
  expanded,
  onToggleExpand,
}: ChatItemProps) {
  // Detect: is this row already a subchannel? Either the displayed name still
  // has a marker (non-tree usage) or the original raw name in `channels` does.
  const isSubchannel = !!getParentId(target.name)
    || !!(channels && getParentId(channels.find((c) => c.id === target.id)?.name ?? null));
  const canAddSubchannel = target.type === 'channel' && !!onAddSubchannel && !isSubchannel;
  const [menuOpen, setMenuOpen] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggered = useRef(false);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const hasMenu = !!(onMarkUnread || onChannelDeleted || onChannelLeft || onConversationArchived || canAddSubchannel);
  const hasChannelActions = target.type === 'channel' && (onChannelDeleted || onChannelLeft || canAddSubchannel);
  const hasConvActions = target.type === 'conversation' && !!onConversationArchived;

  const handleTouchStart = () => {
    if (!hasMenu) return;
    longPressTriggered.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressTriggered.current = true;
      setMenuOpen(true);
    }, 500);
  };
  const cancelLongPress = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  return (
    <>
      <button
        onClick={(e) => {
          if (longPressTriggered.current) {
            longPressTriggered.current = false;
            e.preventDefault();
            return;
          }
          onSelect(target);
        }}
        onTouchStart={handleTouchStart}
        onTouchEnd={cancelLongPress}
        onTouchMove={cancelLongPress}
        onContextMenu={(e) => e.preventDefault()}
        className={clsx(
          'group/item relative flex w-full items-center rounded-lg text-left transition',
          compact ? 'gap-2 px-2 py-1' : 'gap-3 px-3 py-2',
          active
            ? 'bg-primary-100 text-primary-900 dark:bg-primary-900/30 dark:text-primary-200'
            : 'text-surface-700 hover:bg-surface-200 dark:text-surface-400 dark:hover:bg-surface-800',
        )}
      >
        {target.type === 'channel' ? (
          target.image
            ? <Avatar name={target.name} image={target.image} size={compact ? 'xs' : 'sm'} />
            : <Hash size={compact ? 13 : 17} className={clsx('shrink-0', active ? 'text-primary-600 dark:text-primary-400' : 'text-surface-500')} />
        ) : (
          <Avatar name={target.name} image={target.image} size={compact ? 'xs' : 'sm'} availability={target.userAvailability} />
        )}
        <span className={clsx('min-w-0 flex-1 truncate font-medium', compact ? 'text-xs' : 'text-sm')}>{target.name}</span>
        {hasMenu && (
          <div
            ref={menuRef}
            className={clsx(
              'relative shrink-0 md:transition-opacity md:duration-150',
              menuOpen
                ? ''
                : [
                    'hidden md:block',
                    'md:opacity-0 md:pointer-events-none',
                    'md:group-hover/item:opacity-100 md:group-hover/item:pointer-events-auto',
                  ],
            )}
          >
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v); }}
              title="Mehr"
              aria-label="Chat-Optionen"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              className={clsx(
                'rounded transition min-h-[44px] min-w-[44px] flex items-center justify-center md:min-h-0 md:min-w-0',
                menuOpen
                  ? 'text-surface-700 dark:text-surface-200'
                  : 'text-surface-400 dark:text-surface-600',
              )}
            >
              <MoreHorizontal size={14} />
            </button>
            {menuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full z-50 mt-1 min-w-[200px] overflow-hidden rounded-lg border border-surface-200 bg-white shadow-lg dark:border-surface-700 dark:bg-surface-800"
              >
                {onMarkUnread && (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpen(false);
                      onMarkUnread(target);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-surface-700 hover:bg-surface-100 dark:text-surface-200 dark:hover:bg-surface-700"
                  >
                    <Mail size={14} className="shrink-0 text-surface-500" />
                    Als ungelesen markieren
                  </button>
                )}
                {hasChannelActions && onMarkUnread && (
                  <div className="my-0.5 border-t border-surface-200 dark:border-surface-700" />
                )}
                {hasChannelActions && (
                  <>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpen(false);
                        setShowInfoModal(true);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-surface-700 hover:bg-surface-100 dark:text-surface-200 dark:hover:bg-surface-700"
                    >
                      <Info size={14} className="shrink-0 text-surface-500" />
                      Channel-Info
                    </button>
                    {canAddSubchannel && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuOpen(false);
                          onAddSubchannel?.(target.id);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-surface-700 hover:bg-surface-100 dark:text-surface-200 dark:hover:bg-surface-700"
                      >
                        <Plus size={14} className="shrink-0 text-surface-500" />
                        Subchannel hinzufügen
                      </button>
                    )}
                    {onChannelLeft && (
                      <button
                        type="button"
                        role="menuitem"
                        onClick={(e) => {
                          e.stopPropagation();
                          setMenuOpen(false);
                          setShowLeaveModal(true);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-surface-700 hover:bg-surface-100 dark:text-surface-200 dark:hover:bg-surface-700"
                      >
                        <LogOut size={14} className="shrink-0 text-surface-500" />
                        Channel verlassen
                      </button>
                    )}
                    {onChannelDeleted && (
                      <>
                        <div className="my-0.5 border-t border-surface-200 dark:border-surface-700" />
                        <button
                          type="button"
                          role="menuitem"
                          onClick={(e) => {
                            e.stopPropagation();
                            setMenuOpen(false);
                            setShowDeleteModal(true);
                          }}
                          className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-500 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
                        >
                          <Trash2 size={14} className="shrink-0" />
                          Channel löschen
                        </button>
                      </>
                    )}
                  </>
                )}
                {hasConvActions && (
                  <>
                    {onMarkUnread && (
                      <div className="my-0.5 border-t border-surface-200 dark:border-surface-700" />
                    )}
                    <button
                      type="button"
                      role="menuitem"
                      onClick={(e) => {
                        e.stopPropagation();
                        setMenuOpen(false);
                        setShowArchiveModal(true);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-surface-700 hover:bg-surface-100 dark:text-surface-200 dark:hover:bg-surface-700"
                    >
                      <Archive size={14} className="shrink-0 text-surface-500" />
                      Konversation archivieren
                    </button>
                  </>
                )}
              </div>
            )}
          </div>
        )}
        {onToggleExpand && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggleExpand(); }}
            title={expanded ? 'Subkanäle einklappen' : 'Subkanäle ausklappen'}
            aria-label={expanded ? 'Subkanäle einklappen' : 'Subkanäle ausklappen'}
            aria-expanded={!!expanded}
            className="shrink-0 rounded text-surface-400 hover:text-surface-600 dark:hover:text-surface-300 min-h-[36px] min-w-[28px] flex items-center justify-center md:min-h-0 md:min-w-0 md:p-0.5"
          >
            <ChevronDown size={14} className={clsx('transition-transform', expanded && 'rotate-180')} />
          </button>
        )}
        {onToggleFavorite && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onToggleFavorite(target); }}
            title={target.favorite ? 'Favorit entfernen' : 'Als Favorit markieren'}
            aria-label={target.favorite ? 'Favorit entfernen' : 'Als Favorit markieren'}
            aria-pressed={target.favorite}
            className={clsx(
              'shrink-0 rounded transition min-h-[44px] min-w-[44px] flex items-center justify-center md:min-h-0 md:min-w-0',
              target.favorite
                ? 'text-yellow-400'
                : 'text-transparent group-hover/item:text-surface-400 dark:group-hover/item:text-surface-600',
            )}
          >
            <Star size={13} className={target.favorite ? 'fill-yellow-400' : ''} />
          </button>
        )}
        {(target.unread_count ?? 0) > 0 && (
          <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-ci-red-500 px-1.5 text-xs font-bold text-white">
            {target.unread_count}
          </span>
        )}
      </button>

      {showInfoModal && createPortal(
        <ChannelInfoModal chat={target} channels={channels} onClose={() => setShowInfoModal(false)} />,
        document.body
      )}
      {showLeaveModal && createPortal(
        <LeaveConfirmModal
          chat={target}
          onClose={() => setShowLeaveModal(false)}
          onLeft={() => {
            setShowLeaveModal(false);
            onChannelLeft?.(target);
          }}
        />,
        document.body
      )}
      {showDeleteModal && createPortal(
        <DeleteConfirmModal
          chat={target}
          channels={channels}
          onClose={() => setShowDeleteModal(false)}
          onDeleted={() => {
            setShowDeleteModal(false);
            onChannelDeleted?.(target);
          }}
        />,
        document.body
      )}
      {showArchiveModal && createPortal(
        <ArchiveConversationModal
          target={target}
          onClose={() => setShowArchiveModal(false)}
          onArchived={() => {
            setShowArchiveModal(false);
            onConversationArchived?.(target);
          }}
        />,
        document.body
      )}
    </>
  );
}
