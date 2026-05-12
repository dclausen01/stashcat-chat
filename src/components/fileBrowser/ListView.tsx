import { useState } from 'react';
import { Folder, Trash2, Pencil, Check, Square, ArrowUp, ArrowDown, Eye, Send, ExternalLink } from 'lucide-react';
import { clsx } from 'clsx';
import { fileIcon } from '../../utils/fileIcon';
import type { SortField } from '../../hooks/useFileSorting';
import { formatDate, canPreview } from './helpers';
import type { ViewProps } from './types';

export function ListView({ folders, files, onFolderClick, onFileOpen, onRename, onDelete, onDeleteFolder, renamingId, renameValue, setRenameValue, commitRename, onDragFileStart, onDragFileEnd, onDropOnFolder, sortField, sortDirection, onSort, selectedIds, onToggleSelect, onSelectAll, buildDownloadUrl, buildViewUrl, onShare, onOnlyOfficeClick }: ViewProps) {
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  function SortHeader({ field, label, className = '' }: { field: SortField; label: string; className?: string }) {
    const active = sortField === field;
    return (
      <button
        onClick={() => onSort?.(field)}
        className={clsx(
          'flex w-full items-center gap-0.5 text-xs font-medium transition-colors',
          active ? 'text-surface-700 dark:text-surface-200' : 'text-surface-500 hover:text-surface-600 dark:hover:text-surface-400',
          className
        )}
      >
        {label}
        {active && sortDirection && (
          sortDirection === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />
        )}
      </button>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="flex items-center border-b border-surface-100 px-3 py-2 dark:border-surface-800">
        <div className="w-10 shrink-0 flex justify-center">
          <button
            onClick={() => onSelectAll()}
            className={clsx(
              'rounded-md p-1 transition',
              selectedIds.size === (folders.length + files.length) && selectedIds.size > 0
                ? 'bg-primary-500 text-white'
                : 'text-surface-500 hover:bg-surface-200 hover:text-surface-600 dark:hover:bg-surface-700',
            )}
            title={selectedIds.size === (folders.length + files.length) && selectedIds.size > 0 ? 'Auswahl aufheben' : 'Alle auswählen'}
          >
            {selectedIds.size === (folders.length + files.length) && selectedIds.size > 0 ? <Check size={14} /> : <Square size={14} />}
          </button>
        </div>
        <div className="w-8 shrink-0" />
        <div className="min-w-0 flex-1 px-2">
          <SortHeader field="name" label="Name" />
        </div>
        <div className="w-16 shrink-0">
          <SortHeader field="size" label="Größe" className="justify-end" />
        </div>
        <div className="w-20 shrink-0 pl-2">
          <SortHeader field="date" label="Datum" className="justify-end" />
        </div>
      </div>

      <div className="flex flex-col divide-y divide-surface-100 px-1 dark:divide-surface-800">
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
              'group relative flex items-center px-3 py-2.5 transition cursor-pointer',
              dropTargetId === f.id
                ? 'bg-primary-100 ring-2 ring-primary-400 dark:bg-primary-900/30'
                : selectedIds.has(f.id)
                  ? 'bg-primary-50 dark:bg-primary-900/10 ring-2 ring-primary-500'
                  : 'hover:bg-surface-200 dark:hover:bg-surface-800',
            )}
          >
            <div className="w-10 shrink-0 flex justify-center">
              <button
                onClick={(e) => { e.stopPropagation(); onToggleSelect(f.id); }}
                className={clsx(
                  'rounded-md p-1 transition',
                  selectedIds.has(f.id)
                    ? 'bg-primary-500 text-white'
                    : 'text-surface-500 hover:bg-surface-200 hover:text-surface-600 dark:hover:bg-surface-700',
                )}
              >
                {selectedIds.has(f.id) ? <Check size={14} /> : <Square size={14} />}
              </button>
            </div>
            <div className="w-8 shrink-0 flex justify-center">
              <Folder size={18} className="text-amber-400" fill="currentColor" />
            </div>
            <span className="min-w-0 flex-1 truncate text-left text-sm text-surface-800 dark:text-surface-200 px-2">{f.name}</span>
            <span className="w-16 shrink-0 text-right text-xs text-surface-500" />
            <span className="w-20 shrink-0 text-right text-xs text-surface-500 pl-2">{formatDate(f.created)}</span>
            {onDeleteFolder && (
              <div className="absolute right-2 top-1/2 -translate-y-1/2 hidden items-center gap-0.5 rounded-md bg-surface-100/95 px-1 shadow-sm backdrop-blur-sm group-hover:flex dark:bg-surface-800/95">
                <button
                  onClick={(e) => { e.stopPropagation(); onDeleteFolder(f); }}
                  className="rounded-full p-1 text-surface-500 transition hover:bg-red-100 hover:text-red-500 dark:hover:bg-red-900/30"
                  title="Ordner löschen"
                >
                  <Trash2 size={14} />
                </button>
              </div>
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
                'group relative flex items-center px-3 py-2 hover:bg-surface-50 dark:hover:bg-surface-800/50',
                previewable ? 'cursor-pointer' : 'cursor-grab active:cursor-grabbing',
                selectedIds.has(f.id) && 'bg-primary-50 dark:bg-primary-900/10 ring-2 ring-primary-500',
              )}
            >
              <div className="w-10 shrink-0 flex justify-center">
                <button
                  onClick={(e) => { e.stopPropagation(); onToggleSelect(f.id); }}
                  className={clsx(
                    'rounded-md p-1 transition',
                    selectedIds.has(f.id)
                      ? 'bg-primary-500 text-white'
                      : 'text-surface-500 hover:bg-surface-200 hover:text-surface-600 dark:hover:bg-surface-700',
                  )}
                >
                  {selectedIds.has(f.id) ? <Check size={14} /> : <Square size={14} />}
                </button>
              </div>
              <div className="w-8 shrink-0 flex justify-center">
                {isImage ? (
                  <img src={viewUrl} alt={f.name} className="h-8 w-8 rounded object-cover" loading="lazy" />
                ) : (
                  <span className="text-xl">{fileIcon(f.mime, f.ext)}</span>
                )}
              </div>

              <div className="min-w-0 flex-1 px-2">
                {isRenaming ? (
                  <div className="flex items-center gap-1">
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') commitRename(f); if (e.key === 'Escape') commitRename({ ...f, name: f.name }); }}
                      className="min-w-0 flex-1 rounded border border-primary-400 bg-white px-2 py-0.5 text-xs text-surface-900 outline-none dark:bg-surface-700 dark:text-surface-100"
                    />
                    <button onClick={() => commitRename(f)} className="shrink-0 text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300"><Check size={13} /></button>
                  </div>
                ) : (
                  <span
                    className="block truncate text-sm text-surface-800 dark:text-surface-200"
                    onDoubleClick={() => onRename(f)}
                    title={`${f.name} — Doppelklick zum Umbenennen`}
                  >
                    {f.name}
                  </span>
                )}
              </div>

              <span className="w-16 shrink-0 text-right text-xs text-surface-500 tabular-nums">
                {f.size_string}
              </span>

              <span className="w-20 shrink-0 text-right text-xs text-surface-500 pl-2 tabular-nums">
                {formatDate(f.uploaded)}
              </span>

              <div className="absolute right-2 top-1/2 -translate-y-1/2 hidden items-center gap-0.5 rounded-md bg-surface-100/95 px-1 shadow-sm backdrop-blur-sm group-hover:flex dark:bg-surface-800/95">
                {onShare && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onShare(f); }}
                    className="rounded-md p-1.5 text-teal-500 hover:bg-teal-50 hover:text-teal-600 dark:text-teal-400 dark:hover:bg-teal-900/30 dark:hover:text-teal-300"
                    title="In Chat teilen"
                  >
                    <Send size={14} />
                  </button>
                )}
                <a
                  href={downloadUrl}
                  download={f.name}
                  onClick={(e) => e.stopPropagation()}
                  className="rounded-md p-1.5 text-surface-500 hover:bg-surface-200 hover:text-surface-600 dark:hover:bg-surface-700"
                  title="Herunterladen"
                >
                  <ExternalLink size={14} />
                </a>
                {onOnlyOfficeClick && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onOnlyOfficeClick(f); }}
                    className="rounded-md p-1.5 text-primary-500 hover:bg-primary-100 hover:text-primary-600 dark:hover:bg-primary-900/30"
                    title="In OnlyOffice ansehen"
                  >
                    <Eye size={14} />
                  </button>
                )}
                <button
                  onClick={(e) => { e.stopPropagation(); onRename(f); }}
                  className="rounded-md p-1.5 text-surface-500 hover:bg-surface-200 hover:text-surface-600 dark:hover:bg-surface-700"
                  title="Umbenennen"
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(f); }}
                  className="rounded-md p-1.5 text-surface-500 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400"
                  title="Löschen"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
