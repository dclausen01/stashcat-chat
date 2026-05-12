import { useState } from 'react';
import { Folder, Trash2, Pencil, Check, Square, Eye, Send, ExternalLink } from 'lucide-react';
import { clsx } from 'clsx';
import { fileIcon } from '../../utils/fileIcon';
import { canPreview } from './helpers';
import type { ViewProps } from './types';

export function GridView({ folders, files, onFolderClick, onFileOpen, onRename, onDelete, onDeleteFolder, renamingId, renameValue, setRenameValue, commitRename, onDragFileStart, onDragFileEnd, onDropOnFolder, selectedIds, onToggleSelect, buildDownloadUrl, buildViewUrl, onShare, onOnlyOfficeClick }: ViewProps) {
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  return (
    <div className="grid grid-cols-3 gap-2 p-3">
      {folders.map((f) => (
        <div
          key={f.id}
          onClick={(e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); onToggleSelect(f.id); } else { onFolderClick(f); } }}
          onDragOver={(e) => { e.preventDefault(); setDropTargetId(f.id); }}
          onDragLeave={() => setDropTargetId(null)}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDropTargetId(null);
            const fileId = e.dataTransfer.getData('text/file-id');
            if (fileId && onDropOnFolder) onDropOnFolder(fileId, f.id);
          }}
          className={clsx(
            'group relative flex flex-col items-center gap-1.5 rounded-xl p-2 transition cursor-pointer',
            dropTargetId === f.id
              ? 'bg-primary-100 ring-2 ring-primary-400 dark:bg-primary-900/30'
              : selectedIds.has(f.id)
                ? 'ring-2 ring-primary-500 bg-primary-50 dark:bg-primary-900/20'
                : 'hover:bg-surface-200 dark:hover:bg-surface-800',
          )}
        >
          <button
            onClick={(e) => { e.stopPropagation(); onToggleSelect(f.id); }}
            className={clsx(
              'absolute left-1 top-1 z-10 rounded-md p-0.5 transition',
              selectedIds.has(f.id)
                ? 'bg-primary-500 text-white'
                : 'bg-white/80 text-transparent group-hover:bg-surface-200 group-hover:text-surface-600 dark:bg-surface-700/80',
            )}
            title={selectedIds.has(f.id) ? 'Auswahl aufheben' : 'Auswählen'}
          >
            {selectedIds.has(f.id) ? <Check size={12} /> : <Square size={12} />}
          </button>
          <Folder size={40} className="text-amber-400" fill="currentColor" />
          <span className="w-full truncate text-center text-xs text-surface-700 dark:text-surface-400">{f.name}</span>
          {onDeleteFolder && (
            <button
              onClick={(e) => { e.stopPropagation(); onDeleteFolder(f); }}
              className="absolute right-1 top-1 rounded-full p-1 text-surface-500 opacity-0 transition hover:bg-red-100 hover:text-red-500 group-hover:opacity-100 dark:hover:bg-red-900/30"
              title="Ordner löschen"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      ))}
      {files.map((f) => {
        const isImage = f.mime?.startsWith('image/');
        const downloadUrl = buildDownloadUrl(f);
        const viewUrl = buildViewUrl(f);
        const isRenaming = renamingId === f.id;
        const previewable = canPreview(f);

        return (
          <div
            key={f.id}
            draggable
            onDragStart={(e) => { e.dataTransfer.setData('text/file-id', f.id); onDragFileStart?.(f.id); }}
            onDragEnd={() => onDragFileEnd?.()}
            onClick={(e) => {
              if (e.ctrlKey || e.metaKey) { e.preventDefault(); onToggleSelect(f.id); }
              else if (previewable) onFileOpen(f);
            }}
            className={clsx(
              'group relative flex flex-col items-center gap-1.5 rounded-xl p-2 hover:bg-surface-200 dark:hover:bg-surface-800',
              previewable ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing',
              selectedIds.has(f.id) && 'ring-2 ring-primary-500 bg-primary-50 dark:bg-primary-900/20',
            )}
          >
            <button
              onClick={(e) => { e.stopPropagation(); onToggleSelect(f.id); }}
              className={clsx(
                'absolute left-1 top-1 z-10 rounded-md p-0.5 transition',
                selectedIds.has(f.id)
                  ? 'bg-primary-500 text-white'
                  : 'bg-white/80 text-transparent group-hover:bg-surface-200 group-hover:text-surface-600 dark:bg-surface-700/80',
              )}
              title={selectedIds.has(f.id) ? 'Auswahl aufheben' : 'Auswählen'}
            >
              {selectedIds.has(f.id) ? <Check size={12} /> : <Square size={12} />}
            </button>
            <div className="relative h-14 w-full overflow-hidden rounded-lg">
              {isImage ? (
                <img
                  src={viewUrl}
                  alt={f.name}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center text-3xl">
                  {fileIcon(f.mime, f.ext)}
                </span>
              )}
              <div className="absolute inset-0 hidden items-center justify-center gap-1 bg-black/40 group-hover:flex rounded-lg">
                {onOnlyOfficeClick && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onOnlyOfficeClick(f); }}
                    className="rounded-md bg-white/90 p-1 text-primary-600 hover:bg-white dark:bg-surface-700/90 dark:text-primary-400 dark:hover:bg-surface-600"
                    title="In OnlyOffice ansehen"
                  >
                    <Eye size={13} />
                  </button>
                )}
                {onShare && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onShare(f); }}
                    className="rounded-md bg-white/90 p-1 text-teal-600 hover:bg-white dark:bg-surface-700/90 dark:text-teal-400 dark:hover:bg-surface-600"
                    title="In Chat teilen"
                  >
                    <Send size={13} />
                  </button>
                )}
                <a
                  href={downloadUrl}
                  download={f.name}
                  onClick={(e) => e.stopPropagation()}
                  className="rounded-md bg-white/90 p-1 text-surface-700 hover:bg-white dark:bg-surface-700/90 dark:text-surface-100 dark:hover:bg-surface-600"
                  title="Herunterladen"
                >
                  <ExternalLink size={13} />
                </a>
                <button
                  onClick={(e) => { e.stopPropagation(); onRename(f); }}
                  className="rounded-md bg-white/90 p-1 text-surface-700 hover:bg-white dark:bg-surface-700/90 dark:text-surface-100 dark:hover:bg-surface-600"
                  title="Umbenennen"
                >
                  <Pencil size={13} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(f); }}
                  className="rounded-md bg-white/90 p-1 text-red-600 hover:bg-white dark:bg-surface-700/90 dark:text-red-400 dark:hover:bg-surface-600"
                  title="Löschen"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>

            {isRenaming ? (
              <div className="flex w-full gap-1">
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitRename(f); if (e.key === 'Escape') commitRename({ ...f, name: f.name }); }}
                  className="min-w-0 flex-1 rounded border border-primary-400 bg-white px-1 py-0.5 text-xs text-surface-900 outline-none dark:bg-surface-700 dark:text-surface-100"
                />
                <button onClick={() => commitRename(f)} className="shrink-0 text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"><Check size={13} /></button>
              </div>
            ) : (
              <span
                className="w-full truncate text-center text-xs text-surface-700 dark:text-surface-400"
                onDoubleClick={() => onRename(f)}
                title={f.name}
              >
                {f.name}
              </span>
            )}
            {f.size_string && (
              <span className="text-[10px] text-surface-500">{f.size_string}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
