import { useState, useRef, useEffect } from 'react';
import { MoreVertical, Users, Pencil, Download, Trash2, Loader2, Info, ImageIcon, LogOut, Type, Plus } from 'lucide-react';
import { clsx } from 'clsx';
import type { ChatTarget } from '../types';
import { getParentId } from '../utils/subchannels';
import { exportChatAsMarkdown } from '../utils/exportChat';
import { ChannelInfoModal } from './channels/ChannelInfoModal';
import { LeaveConfirmModal } from './channels/LeaveConfirmModal';
import { DeleteConfirmModal } from './channels/DeleteConfirmModal';
import { RenameChannelModal } from './channels/RenameChannelModal';

export { exportChatAsMarkdown, ChannelInfoModal, LeaveConfirmModal, DeleteConfirmModal, RenameChannelModal };

interface ChannelDropdownMenuProps {
  chat: ChatTarget;
  isManager: boolean;
  onOpenMembers: () => void;
  onOpenDescriptionEditor: () => void;
  onOpenImageEditor?: () => void;
  onDeleted?: () => void;
  onRenamed?: (newName: string) => void;
  /** All channels — used for subchannel detection in delete flow */
  channels?: ChatTarget[];
}


export default function ChannelDropdownMenu({
  chat,
  isManager,
  onOpenMembers,
  onOpenDescriptionEditor,
  onOpenImageEditor,
  onDeleted,
  onRenamed,
  channels,
}: ChannelDropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showLeaveModal, setShowLeaveModal] = useState(false);
  const [showInfoModal, setShowInfoModal] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [exporting, setExporting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  if (!isManager) return null;

  const handleExport = async () => {
    setOpen(false);
    setExporting(true);
    try {
      await exportChatAsMarkdown(chat);
    } catch (err) {
      alert('Export fehlgeschlagen: ' + (err instanceof Error ? err.message : err));
    } finally {
      setExporting(false);
    }
  };

  const handleDelete = () => {
    setOpen(false);
    setShowDeleteModal(true);
  };

  const handleLeave = () => {
    setOpen(false);
    setShowLeaveModal(true);
  };

  return (
    <>
      <div className="relative" ref={menuRef}>
        <button
          onClick={() => setOpen(o => !o)}
          className={clsx(
            'rounded-lg p-2 transition',
            open
              ? 'bg-primary-100 text-primary-600 dark:bg-primary-900/30 dark:text-primary-400'
              : 'text-surface-500 hover:bg-surface-200 dark:hover:bg-surface-800',
          )}
          title="Channel-Optionen"
        >
          {exporting ? <Loader2 size={18} className="animate-spin" /> : <MoreVertical size={18} />}
        </button>

        {open && (
          <div className="absolute right-0 top-full z-40 mt-1 w-52 rounded-xl border border-surface-200 bg-white py-1 shadow-xl dark:border-surface-700 dark:bg-surface-800">
            <button
              onClick={() => { setOpen(false); onOpenMembers(); }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-surface-700 transition hover:bg-surface-200 dark:text-surface-200 dark:hover:bg-surface-700"
            >
              <Users size={16} className="text-surface-500" />
              Channel-Mitglieder
            </button>
            <button
              onClick={() => { setOpen(false); setShowInfoModal(true); }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-surface-700 transition hover:bg-surface-200 dark:text-surface-200 dark:hover:bg-surface-700"
            >
              <Info size={16} className="text-surface-500" />
              Channel-Info
            </button>
            {!getParentId(chat.name) && (
              <button
                onClick={() => {
                  setOpen(false);
                  window.dispatchEvent(new CustomEvent('open-new-channel-modal', { detail: { parentId: chat.id } }));
                }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-surface-700 transition hover:bg-surface-200 dark:text-surface-200 dark:hover:bg-surface-700"
              >
                <Plus size={16} className="text-surface-500" />
                Subchannel hinzufügen
              </button>
            )}
            <button
              onClick={() => { setOpen(false); onOpenDescriptionEditor(); }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-surface-700 transition hover:bg-surface-200 dark:text-surface-200 dark:hover:bg-surface-700"
            >
              <Pencil size={16} className="text-surface-500" />
              Beschreibung bearbeiten
            </button>
            <button
              onClick={() => { setOpen(false); setShowRenameModal(true); }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-surface-700 transition hover:bg-surface-200 dark:text-surface-200 dark:hover:bg-surface-700"
            >
              <Type size={16} className="text-surface-500" />
              Channel umbenennen
            </button>
            {onOpenImageEditor && (
              <button
                onClick={() => { setOpen(false); onOpenImageEditor(); }}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-surface-700 transition hover:bg-surface-200 dark:text-surface-200 dark:hover:bg-surface-700"
              >
                <ImageIcon size={16} className="text-surface-500" />
                Bild ändern
              </button>
            )}
            <button
              onClick={handleExport}
              disabled={exporting}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-surface-700 transition hover:bg-surface-200 disabled:opacity-50 dark:text-surface-200 dark:hover:bg-surface-700"
            >
              <Download size={16} className="text-surface-500" />
              Als Markdown exportieren
            </button>
            <div className="my-1 border-t border-surface-200 dark:border-surface-700" />
            <button
              onClick={handleLeave}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-surface-700 transition hover:bg-surface-200 dark:text-surface-200 dark:hover:bg-surface-700"
            >
              <LogOut size={16} className="text-surface-500" />
              Channel verlassen
            </button>
            <div className="my-1 border-t border-surface-200 dark:border-surface-700" />
            <button
              onClick={handleDelete}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-red-500 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
            >
              <Trash2 size={16} />
              Channel löschen
            </button>
          </div>
        )}
      </div>

      {showLeaveModal && (
        <LeaveConfirmModal
          chat={chat}
          onClose={() => setShowLeaveModal(false)}
          onLeft={() => {
            setShowLeaveModal(false);
            onDeleted?.();
          }}
        />
      )}
      {showDeleteModal && (
        <DeleteConfirmModal
          chat={chat}
          channels={channels}
          onClose={() => setShowDeleteModal(false)}
          onDeleted={() => {
            setShowDeleteModal(false);
            onDeleted?.();
          }}
        />
      )}
      {showInfoModal && (
        <ChannelInfoModal chat={chat} channels={channels} onClose={() => setShowInfoModal(false)} />
      )}
      {showRenameModal && (
        <RenameChannelModal
          chat={chat}
          onClose={() => setShowRenameModal(false)}
          onRenamed={(newName) => {
            setShowRenameModal(false);
            onRenamed?.(newName);
          }}
        />
      )}
    </>
  );
}
