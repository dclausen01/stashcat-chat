import { useState, useEffect, useCallback, useRef } from 'react';
import {
  X, Grid3x3, List, Upload, Folder, ChevronRight, Home,
  Trash2, Pencil, Check, Loader2, ExternalLink, ArrowUp, ArrowDown, Plus,
  Square,
} from 'lucide-react';
import { useFileSorting, type SortField, type SortDirection } from '../hooks/useFileSorting';
import { FolderUploadProgress, type FolderUploadProgressData } from './FolderUploadProgress';
import { clsx } from 'clsx';
import * as api from '../api';
import { fileIcon } from '../utils/fileIcon';
import { useSettings } from '../context/SettingsContext';
import { useAuth } from '../context/AuthContext';
import type { ChatTarget } from '../types';

// ── Types ──────────────────────────────────────────────────────────────────────

interface FolderEntry {
  id: string;
  name: string;
  size_byte?: number;
  created?: string;
  modified?: string;
}

interface FileEntry {
  id: string;
  name: string;
  size_string?: string;
  size?: string;
  mime?: string;
  ext?: string;
  uploaded?: string;
  modified?: string;
  encrypted?: boolean;
  e2e_iv?: string;
}

interface Crumb { id: string | null; name: string }
type Tab = 'context' | 'personal';

interface FileBrowserPanelProps {
  chat: ChatTarget | null;
  onClose: () => void;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function formatDate(ts?: string): string {
  if (!ts) return '';
  const n = Number(ts);
  if (isNaN(n) || n === 0) return '';
  return new Date(n * 1000).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

const SHARED_PROPS = 'onFolderClick onImageClick onPdfClick onRename onDelete renamingId renameValue setRenameValue commitRename';
void SHARED_PROPS; // suppress unused warning — just for docs

interface ViewProps {
  folders: FolderEntry[];
  files: FileEntry[];
  onFolderClick: (f: FolderEntry) => void;
  onImageClick: (url: string) => void;
  onPdfClick: (fileId: string, viewUrl: string, name: string) => void;
  onRename: (f: FileEntry) => void;
  onDelete: (f: FileEntry) => void;
  onDeleteFolder?: (f: FolderEntry) => void;
  renamingId: string | null;
  renameValue: string;
  setRenameValue: (v: string) => void;
  commitRename: (f: FileEntry) => void;
  onDragFileStart?: (fileId: string) => void;
  onDragFileEnd?: () => void;
  onDropOnFolder?: (fileId: string, folderId: string) => void;
  // Sorting
  sortField?: SortField;
  sortDirection?: SortDirection;
  onSort?: (field: SortField) => void;
  // Selection
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onSelectAll: () => void;
}

// ── Grid view ─────────────────────────────────────────────────────────────────

function GridView({ folders, files, onFolderClick, onImageClick, onPdfClick, onRename, onDelete, onDeleteFolder, renamingId, renameValue, setRenameValue, commitRename, onDragFileStart, onDragFileEnd, onDropOnFolder, selectedIds, onToggleSelect }: ViewProps) {
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
                : 'hover:bg-surface-100 dark:hover:bg-surface-800',
          )}
        >
          {/* Checkbox */}
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
          <span className="w-full truncate text-center text-xs text-surface-700 dark:text-surface-300">{f.name}</span>
          {onDeleteFolder && (
            <button
              onClick={(e) => { e.stopPropagation(); onDeleteFolder(f); }}
              className="absolute right-1 top-1 rounded-full p-1 text-surface-400 opacity-0 transition hover:bg-red-100 hover:text-red-500 group-hover:opacity-100 dark:hover:bg-red-900/30"
              title="Ordner löschen"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      ))}
      {files.map((f) => {
        const isImage = f.mime?.startsWith('image/');
        const isPdf = f.mime === 'application/pdf' || f.ext?.toLowerCase() === 'pdf';
        const downloadUrl = api.fileDownloadUrl(f.id, f.name);
        const viewUrl = api.fileViewUrl(f.id, f.name);
        const isRenaming = renamingId === f.id;

        return (
          <div
            key={f.id}
            draggable
            onDragStart={(e) => { e.dataTransfer.setData('text/file-id', f.id); onDragFileStart?.(f.id); }}
            onDragEnd={() => onDragFileEnd?.()}
            onClick={(e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); onToggleSelect(f.id); } }}
            className={clsx(
              'group relative flex flex-col items-center gap-1.5 rounded-xl p-2 hover:bg-surface-100 dark:hover:bg-surface-800 cursor-grab active:cursor-grabbing',
              selectedIds.has(f.id) && 'ring-2 ring-primary-500 bg-primary-50 dark:bg-primary-900/20',
            )}
          >
            {/* Checkbox */}
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
            {/* Thumbnail or icon */}
            <button
              className="relative h-14 w-full overflow-hidden rounded-lg"
              onClick={() => isImage ? onImageClick(viewUrl) : isPdf ? onPdfClick(f.id, viewUrl, f.name) : undefined}
              title={isImage ? 'Vergrößern' : isPdf ? 'Vorschau' : f.name}
            >
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
              {/* Hover actions overlay */}
              <div className="absolute inset-0 hidden items-center justify-center gap-1 bg-black/40 group-hover:flex rounded-lg">
                <a
                  href={downloadUrl}
                  download={f.name}
                  onClick={(e) => e.stopPropagation()}
                  className="rounded-md bg-white/90 p-1 text-surface-700 hover:bg-white"
                  title="Herunterladen"
                >
                  <ExternalLink size={13} />
                </a>
                <button
                  onClick={(e) => { e.stopPropagation(); onRename(f); }}
                  className="rounded-md bg-white/90 p-1 text-surface-700 hover:bg-white"
                  title="Umbenennen"
                >
                  <Pencil size={13} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(f); }}
                  className="rounded-md bg-white/90 p-1 text-red-600 hover:bg-white"
                  title="Löschen"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </button>

            {/* Filename or rename input */}
            {isRenaming ? (
              <div className="flex w-full gap-1">
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitRename(f); if (e.key === 'Escape') commitRename({ ...f, name: f.name }); }}
                  className="min-w-0 flex-1 rounded border border-primary-400 bg-white px-1 py-0.5 text-xs text-surface-900 outline-none dark:bg-surface-700 dark:text-surface-100"
                />
                <button onClick={() => commitRename(f)} className="shrink-0 text-primary-600"><Check size={13} /></button>
              </div>
            ) : (
              <span
                className="w-full truncate text-center text-xs text-surface-700 dark:text-surface-300"
                onDoubleClick={() => onRename(f)}
                title={f.name}
              >
                {f.name}
              </span>
            )}
            {f.size_string && (
              <span className="text-[10px] text-surface-400">{f.size_string}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── List view ─────────────────────────────────────────────────────────────────

function ListView({ folders, files, onFolderClick, onImageClick, onPdfClick, onRename, onDelete, onDeleteFolder, renamingId, renameValue, setRenameValue, commitRename, onDragFileStart, onDragFileEnd, onDropOnFolder, sortField, sortDirection, onSort, selectedIds, onToggleSelect, onSelectAll }: ViewProps) {
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  function SortHeader({ field, label, className = '' }: { field: SortField; label: string; className?: string }) {
    const active = sortField === field;
    return (
      <button
        onClick={() => onSort?.(field)}
        className={clsx(
          'flex items-center gap-0.5 text-xs font-medium transition-colors',
          active ? 'text-surface-700 dark:text-surface-200' : 'text-surface-400 hover:text-surface-600 dark:hover:text-surface-300',
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
      {/* Column headers */}
      <div className="flex items-center border-b border-surface-100 px-3 py-2 dark:border-surface-800">
        {/* Checkbox column */}
        <div className="w-10 shrink-0 flex justify-center">
          <button
            onClick={() => onSelectAll()}
            className={clsx(
              'rounded-md p-1 transition',
              selectedIds.size === (folders.length + files.length) && selectedIds.size > 0
                ? 'bg-primary-500 text-white'
                : 'text-surface-400 hover:bg-surface-200 hover:text-surface-600 dark:hover:bg-surface-700',
            )}
            title={selectedIds.size === (folders.length + files.length) && selectedIds.size > 0 ? 'Auswahl aufheben' : 'Alle auswählen'}
          >
            {selectedIds.size === (folders.length + files.length) && selectedIds.size > 0 ? <Check size={14} /> : <Square size={14} />}
          </button>
        </div>
        <div className="w-10 shrink-0" /> {/* Icon column */}
        <div className="min-w-0 flex-1 px-3">
          <SortHeader field="name" label="Name" />
        </div>
        <div className="w-20 shrink-0 text-right">
          <SortHeader field="size" label="Größe" className="justify-end" />
        </div>
        <div className="w-24 shrink-0 text-right px-2">
          <SortHeader field="date" label="Datum" className="justify-end" />
        </div>
        <div className="w-12 shrink-0" /> {/* Actions column */}
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
              'group flex items-center px-3 py-2.5 transition cursor-pointer',
              dropTargetId === f.id
                ? 'bg-primary-100 ring-2 ring-primary-400 dark:bg-primary-900/30'
                : selectedIds.has(f.id)
                  ? 'bg-primary-50 dark:bg-primary-900/10 ring-2 ring-primary-500'
                  : 'hover:bg-surface-100 dark:hover:bg-surface-800',
            )}
          >
            {/* Checkbox */}
            <div className="w-10 shrink-0 flex justify-center">
              <button
                onClick={(e) => { e.stopPropagation(); onToggleSelect(f.id); }}
                className={clsx(
                  'rounded-md p-1 transition',
                  selectedIds.has(f.id)
                    ? 'bg-primary-500 text-white'
                    : 'text-surface-400 hover:bg-surface-200 hover:text-surface-600 dark:hover:bg-surface-700',
                )}
              >
                {selectedIds.has(f.id) ? <Check size={14} /> : <Square size={14} />}
              </button>
            </div>
            <div className="w-10 shrink-0 flex justify-center">
              <Folder size={18} className="text-amber-400" fill="currentColor" />
            </div>
            <span className="min-w-0 flex-1 truncate text-left text-sm text-surface-800 dark:text-surface-200 px-3">{f.name}</span>
            <span className="w-24 shrink-0 text-right text-xs text-surface-400 px-2">{formatDate(f.created)}</span>
            <div className="w-20 shrink-0 flex justify-end items-center gap-1">
              {onDeleteFolder && (
                <button
                  onClick={(e) => { e.stopPropagation(); onDeleteFolder(f); }}
                  className="rounded-full p-1 text-surface-400 opacity-0 transition hover:bg-red-100 hover:text-red-500 group-hover:opacity-100 dark:hover:bg-red-900/30"
                  title="Ordner löschen"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          </div>
        ))}
        {files.map((f) => {
          const isImage = f.mime?.startsWith('image/');
          const isPdf = f.mime === 'application/pdf' || f.ext?.toLowerCase() === 'pdf';
          const downloadUrl = api.fileDownloadUrl(f.id, f.name);
          const viewUrl = api.fileViewUrl(f.id, f.name);
          const isRenaming = renamingId === f.id;

          return (
            <div
              key={f.id}
              draggable
              onDragStart={(e) => { e.dataTransfer.setData('text/file-id', f.id); onDragFileStart?.(f.id); }}
              onDragEnd={() => onDragFileEnd?.()}
              onClick={(e) => { if (e.ctrlKey || e.metaKey) { e.preventDefault(); onToggleSelect(f.id); } }}
              className={clsx(
                'group flex items-center px-3 py-2 hover:bg-surface-50 dark:hover:bg-surface-800/50 cursor-grab active:cursor-grabbing',
                selectedIds.has(f.id) && 'bg-primary-50 dark:bg-primary-900/10 ring-2 ring-primary-500',
              )}
            >
              {/* Checkbox */}
              <div className="w-10 shrink-0 flex justify-center">
                <button
                  onClick={(e) => { e.stopPropagation(); onToggleSelect(f.id); }}
                  className={clsx(
                    'rounded-md p-1 transition',
                    selectedIds.has(f.id)
                      ? 'bg-primary-500 text-white'
                      : 'text-surface-400 hover:bg-surface-200 hover:text-surface-600 dark:hover:bg-surface-700',
                  )}
                >
                  {selectedIds.has(f.id) ? <Check size={14} /> : <Square size={14} />}
                </button>
              </div>
              {/* Icon / thumbnail */}
              <div className="w-10 shrink-0 flex justify-center">
                <button
                  onClick={() => isImage ? onImageClick(viewUrl) : isPdf ? onPdfClick(f.id, viewUrl, f.name) : undefined}
                  title={isImage ? 'Vergrößern' : isPdf ? 'Vorschau' : undefined}
                >
                  {isImage ? (
                    <img src={viewUrl} alt={f.name} className="h-9 w-9 rounded object-cover" loading="lazy" />
                  ) : (
                    <span className="text-xl">{fileIcon(f.mime, f.ext)}</span>
                  )}
                </button>
              </div>

              {/* Name */}
              <div className="min-w-0 flex-1 px-3">
                {isRenaming ? (
                  <div className="flex items-center gap-1">
                    <input
                      autoFocus
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') commitRename(f); if (e.key === 'Escape') commitRename({ ...f, name: f.name }); }}
                      className="min-w-0 flex-1 rounded border border-primary-400 bg-white px-2 py-0.5 text-xs text-surface-900 outline-none dark:bg-surface-700 dark:text-surface-100"
                    />
                    <button onClick={() => commitRename(f)} className="shrink-0 text-primary-600"><Check size={13} /></button>
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

              {/* Size */}
              <span className="w-20 shrink-0 text-right text-xs text-surface-400 transition-opacity group-hover:opacity-0">
                {f.size_string}
              </span>

              {/* Date */}
              <span className="w-24 shrink-0 text-right text-xs text-surface-400 px-2 transition-opacity group-hover:opacity-0">
                {formatDate(f.uploaded)}
              </span>

              {/* Actions (visible on hover) */}
              <div className="hidden shrink-0 items-center justify-end gap-0.5 w-20 group-hover:flex">
                <a
                  href={downloadUrl}
                  download={f.name}
                  className="rounded-md p-1.5 text-surface-400 hover:bg-surface-200 hover:text-surface-600 dark:hover:bg-surface-700"
                  title="Herunterladen"
                >
                  <ExternalLink size={14} />
                </a>
                <button
                  onClick={() => onRename(f)}
                  className="rounded-md p-1.5 text-surface-400 hover:bg-surface-200 hover:text-surface-600 dark:hover:bg-surface-700"
                  title="Umbenennen"
                >
                  <Pencil size={14} />
                </button>
                <button
                  onClick={() => onDelete(f)}
                  className="rounded-md p-1.5 text-surface-400 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400"
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

// ── Main panel ────────────────────────────────────────────────────────────────

export default function FileBrowserPanel({ chat, onClose }: FileBrowserPanelProps) {
  const settings = useSettings();
  const { user } = useAuth();
  const tab = settings.fileBrowserTab;
  const setTab = settings.setFileBrowserTab;
  const viewMode = settings.fileBrowserViewMode;
  const setViewMode = settings.setFileBrowserViewMode;

  // Panel width (horizontal resize from left edge)
  const [panelWidth, setPanelWidth] = useState(384); // 384px = w-96 default
  const panelWidthRef = useRef(384);
  const resizingWidth = useRef(false);

  const onWidthMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizingWidth.current = true;
    const startX = e.clientX;
    const startW = panelWidthRef.current;
    const onMove = (ev: MouseEvent) => {
      // Resize from left edge: moving left increases width, moving right decreases
      const newW = Math.max(280, Math.min(600, startW - (ev.clientX - startX)));
      setPanelWidth(newW);
      panelWidthRef.current = newW;
    };
    const onUp = () => {
      resizingWidth.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  // Initialize tab based on chat availability; reset to 'context' when chat changes
  const prevChatIdRef = useRef<string | undefined>(undefined);
  const initialRunRef = useRef(false);
  useEffect(() => {
    // Always run on first mount (initialRunRef check)
    if (!initialRunRef.current) {
      initialRunRef.current = true;
      if (chat) {
        setTab('context');
      } else {
        setTab('personal');
      }
      return;
    }
    // Subsequent runs: only react to chat.id changes
    const chatId = chat?.id;
    if (chatId !== prevChatIdRef.current) {
      prevChatIdRef.current = chatId;
      if (chat) {
        setTab('context');
      }
      // When chat becomes undefined, do NOT switch to personal here —
      // the user might still want to browse personal files; they can switch tabs manually
    }
  }, [chat?.id, setTab]);

  const [crumbs, setCrumbs] = useState<Crumb[]>([{ id: null, name: 'Alle Dateien' }]);
  const [folders, setFolders] = useState<FolderEntry[]>([]);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const { sortField, sortDirection, setSort, sortedFolders, sortedFiles } = useFileSorting(folders, files);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [pdfView, setPdfView] = useState<{ fileId: string; viewUrl: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<FolderUploadProgressData | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [dragFileId, setDragFileId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [moveModalOpen, setMoveModalOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentFolderId = crumbs[crumbs.length - 1].id ?? undefined;

  const loadFolder = useCallback(async () => {
    setLoading(true);
    try {
      const result = tab === 'personal'
        ? await api.listPersonalFiles(currentFolderId)
        : chat
          ? await api.listFolder(chat.type, chat.id, currentFolderId)
          : { folder: [], files: [] };

      setFolders(result.folder as unknown as FolderEntry[]);
      setFiles(result.files as unknown as FileEntry[]);
    } catch (err) {
      console.error('Failed to load folder:', err);
    } finally {
      setLoading(false);
    }
  }, [tab, chat, currentFolderId]);

  useEffect(() => { loadFolder(); }, [loadFolder]);

  // Escape key to clear selection
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedIds.size > 0) setSelectedIds(new Set());
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIds.size]);

  const handleTabChange = (t: Tab) => {
    setTab(t);
    setCrumbs([{ id: null, name: 'Alle Dateien' }]);
  };

  const navigateInto = (folder: FolderEntry) => {
    setSelectedIds(new Set()); // clear selection on navigation
    setCrumbs((prev) => [...prev, { id: folder.id, name: folder.name }]);
  };

  const navigateTo = (index: number) => {
    setCrumbs((prev) => prev.slice(0, index + 1));
  };

  const handleDelete = async (f: FileEntry) => {
    if (!confirm(`"${f.name}" wirklich löschen?`)) return;
    try {
      await api.deleteFile(f.id);
      setFiles((prev) => prev.filter((x) => x.id !== f.id));
    } catch (err) {
      alert(`Fehler: ${err instanceof Error ? err.message : err}`);
    }
  };

  const handleDeleteFolder = async (f: FolderEntry) => {
    if (!confirm(`Ordner "${f.name}" und alle Inhalte wirklich löschen?`)) return;
    try {
      await api.deleteFolder(f.id);
      setFolders((prev) => prev.filter((x) => x.id !== f.id));
    } catch (err) {
      alert(`Fehler: ${err instanceof Error ? err.message : err}`);
    }
  };

  const startRename = (f: FileEntry) => {
    setRenamingId(f.id);
    setRenameValue(f.name);
  };

  const commitRename = async (f: FileEntry) => {
    const newName = renameValue.trim();
    setRenamingId(null);
    if (!newName || newName === f.name) return;
    try {
      await api.renameFile(f.id, newName);
      setFiles((prev) => prev.map((x) => x.id === f.id ? { ...x, name: newName } : x));
    } catch (err) {
      alert(`Fehler: ${err instanceof Error ? err.message : err}`);
    }
  };

  const handleMoveToFolder = async (fileId: string, folderId: string) => {
    try {
      await api.moveFile(fileId, folderId);
      await loadFolder();
    } catch (err) {
      alert(`Verschieben fehlgeschlagen: ${err instanceof Error ? err.message : err}`);
    }
  };

  // ── Selection handlers ──────────────────────────────────────────────────────

  const handleToggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    const allIds = [...sortedFolders.map(f => f.id), ...sortedFiles.map(f => f.id)];
    setSelectedIds((prev) => prev.size === allIds.length ? new Set() : new Set(allIds));
  }, [sortedFolders, sortedFiles]);

  const handleBatchDelete = useCallback(async () => {
    const selFiles = sortedFiles.filter(f => selectedIds.has(f.id));
    const selFolders = sortedFolders.filter(f => selectedIds.has(f.id));
    const total = selFiles.length + selFolders.length;
    if (!confirm(`${total} Item(s) wirklich löschen?`)) return;
    try {
      if (selFiles.length > 0) {
        await api.deleteFiles(selFiles.map(f => f.id));
        setFiles(prev => prev.filter(f => !selectedIds.has(f.id)));
      }
      for (const folder of selFolders) {
        await api.deleteFolder(folder.id);
        setFolders(prev => prev.filter(f => f.id !== folder.id));
      }
    } catch (err) {
      alert(`Fehler: ${err instanceof Error ? err.message : err}`);
    }
    setSelectedIds(new Set());
  }, [selectedIds, sortedFiles, sortedFolders]);

  const handleBatchDownload = useCallback(() => {
    sortedFiles.filter(f => selectedIds.has(f.id)).forEach((f, i) => {
      setTimeout(() => {
        const a = document.createElement('a');
        a.href = api.fileDownloadUrl(f.id, f.name);
        a.download = f.name;
        a.click();
      }, i * 200);
    });
  }, [selectedIds, sortedFiles]);

  const handleMoveSelected = useCallback(async (targetFolderId: string) => {
    setMoveModalOpen(false);
    try {
      for (const id of selectedIds) {
        if (sortedFiles.some(f => f.id === id)) {
          await api.moveFile(id, targetFolderId);
        }
      }
      await loadFolder();
      setSelectedIds(new Set());
    } catch (err) {
      alert(`Verschieben fehlgeschlagen: ${err instanceof Error ? err.message : err}`);
    }
  }, [selectedIds, sortedFiles]);

  // ── /Selection handlers ─────────────────────────────────────────────────────

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    try {
      const uploadType = tab === 'personal' ? 'personal' : chat?.type || 'personal';
      const uploadTypeId = tab === 'personal' ? String(user?.id) : chat?.id;
      if (!uploadTypeId) {
        alert('Keine gültige Ziel-ID gefunden');
        return;
      }
      await api.createFolder(
        newFolderName.trim(),
        currentFolderId || '0',
        uploadType,
        uploadTypeId!
      );
      setNewFolderName('');
      setCreatingFolder(false);
      await loadFolder();
    } catch (err) {
      alert(`Ordner erstellen fehlgeschlagen: ${err instanceof Error ? err.message : err}`);
    }
  };

  const handleUpload = async (file: File, folderId?: string) => {
    setUploading(true);
    try {
      if (tab === 'personal') {
        const userId = user?.id ? String(user.id) : undefined;
        await api.uploadToStorage('personal', userId, file, folderId ?? currentFolderId);
      } else if (chat) {
        await api.uploadToStorage(chat.type, chat.id, file, folderId ?? currentFolderId);
      }
    } catch (err) {
      throw err;
    } finally {
      setUploading(false);
    }
  };

  const handleFolderInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    e.target.value = '';

    const files = Array.from(fileList);
    const hasFolderStructure = files.some(f => f.webkitRelativePath?.includes('/'));

    if (hasFolderStructure) {
      await handleFolderUpload(files);
    } else {
      for (const f of files) {
        try {
          await handleUpload(f);
        } catch (err) {
          alert(`Upload-Fehler: ${err instanceof Error ? err.message : err}`);
        }
      }
      await loadFolder();
    }
  };

  const handleFolderUpload = async (files: File[]) => {
    const folderMap = new Map<string, { files: File[] }>();

    for (const file of files) {
      const path = file.webkitRelativePath || file.name;
      const parts = path.split('/');
      const rootFolder = parts[0];

      if (!folderMap.has(rootFolder)) {
        folderMap.set(rootFolder, { files: [] });
      }

      if (parts.length > 2) {
        for (let i = 1; i < parts.length - 1; i++) {
          const subfolderPath = parts.slice(0, i + 1).join('/');
          if (!folderMap.has(subfolderPath)) {
            folderMap.set(subfolderPath, { files: [] });
          }
        }
      }

      if (parts.length > 1) {
        const parentPath = parts.slice(0, -1).join('/');
        const entry = folderMap.get(parentPath);
        if (entry) entry.files.push(file);
      } else {
        const entry = folderMap.get(rootFolder);
        if (entry) entry.files.push(file);
      }
    }

    const totalFiles = files.length;
    let uploadedFiles = 0;
    const errors: { file: string; error: string }[] = [];

    setUploadProgress({
      totalFiles,
      uploadedFiles: 0,
      currentFile: '',
      status: 'uploading',
      errors: [],
    });

    const uploadType = tab === 'personal' ? 'personal' : chat?.type || 'personal';
    const uploadTypeId = tab === 'personal' ? String(user?.id) : chat?.id;
    if (!uploadTypeId) {
      setUploadProgress({
        totalFiles,
        uploadedFiles: 0,
        currentFile: '',
        status: 'error',
        errors: [{ file: '', error: 'Keine gültige Ziel-ID gefunden' }],
      });
      return;
    }

    try {
      const sortedFolders = [...folderMap.entries()].sort((a, b) => {
        const depthA = a[0].split('/').length;
        const depthB = b[0].split('/').length;
        return depthA - depthB;
      });

      const folderIdMap = new Map<string, string>();

      for (const [folderPath, entry] of sortedFolders) {
        let parentId = currentFolderId || '0';
        const parts = folderPath.split('/');

        if (parts.length > 1) {
          const parentPath = parts.slice(0, -1).join('/');
          const parentFolderId = folderIdMap.get(parentPath);
          if (parentFolderId) parentId = parentFolderId;
        }

        const folderName = parts[parts.length - 1];
        let createdFolderId: string | null = null;
        try {
          const newFolder = await api.createFolder(
            folderName,
            parentId,
            uploadType,
            uploadTypeId!
          );
          // API returns: { id: number, type: "personal", ... }
          const folderId = newFolder.id;
          if (folderId) {
            createdFolderId = String(folderId);
            folderIdMap.set(folderPath, createdFolderId);
            // Wait a moment for the folder to be fully registered
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        } catch (err) {
          console.warn('Failed to create folder, might exist:', folderPath, err);
        }

        const targetFolderId = createdFolderId ?? folderIdMap.get(folderPath) ?? parentId;
        for (const file of entry.files) {
          setUploadProgress(prev => prev ? { ...prev, currentFile: file.name } : null);

          try {
            await handleUpload(file, targetFolderId);
            uploadedFiles++;
            setUploadProgress(prev => prev ? { ...prev, uploadedFiles } : null);
          } catch (err) {
            errors.push({
              file: file.webkitRelativePath || file.name,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }

      setUploadProgress({
        totalFiles,
        uploadedFiles,
        currentFile: '',
        status: errors.length > 0 ? 'error' : 'complete',
        errors,
      });

      await loadFolder();
    } catch (err) {
      setUploadProgress({
        totalFiles,
        uploadedFiles,
        currentFile: '',
        status: 'error',
        errors: [{ file: 'Allgemein', error: err instanceof Error ? err.message : String(err) }],
      });
    }
  };

  const contextLabel = chat
    ? chat.type === 'channel' ? 'Channel-Dateien' : 'Konversation'
    : null;

  const viewProps: ViewProps = {
    folders: sortedFolders,
    files: sortedFiles,
    onFolderClick: navigateInto,
    onImageClick: setLightboxUrl,
    onPdfClick: (fid, vurl, name) => setPdfView({ fileId: fid, viewUrl: vurl, name }),
    onRename: startRename,
    onDelete: handleDelete,
    onDeleteFolder: handleDeleteFolder,
    renamingId,
    renameValue,
    setRenameValue,
    commitRename,
    onDragFileStart: setDragFileId,
    onDragFileEnd: () => setDragFileId(null),
    onDropOnFolder: handleMoveToFolder,
    sortField,
    sortDirection,
    onSort: setSort,
    selectedIds,
    onToggleSelect: handleToggleSelect,
    onSelectAll: handleSelectAll,
  };

  return (
    <div
      className="relative flex h-full shrink-0 flex-col border-l border-surface-200 bg-surface-50 dark:border-surface-700 dark:bg-surface-900"
      style={{ width: panelWidth }}
      onDragOver={(e) => {
        e.preventDefault();
        // Only show drop overlay for external files, not internal drag
        if (!dragFileId && e.dataTransfer.types.includes('Files')) setDragOver(true);
      }}
      onDragLeave={(e) => { if (e.currentTarget.contains(e.relatedTarget as Node)) return; setDragOver(false); }}
      onDrop={async (e) => {
        e.preventDefault();
        setDragOver(false);

        // Get files with their relative paths from dataTransfer.items
        const filesWithPaths: { file: File; path: string }[] = [];

        if (e.dataTransfer.items) {
          // Use webkitGetAsEntry to get folder structure
          const getEntries = async (entry: FileSystemEntry, path = ''): Promise<void> => {
            if (entry.isFile) {
              const fileEntry = entry as FileSystemFileEntry;
              await new Promise<void>((resolve) => {
                fileEntry.file((file) => {
                  filesWithPaths.push({ file, path: path ? `${path}/${file.name}` : file.name });
                  resolve();
                });
              });
            } else if (entry.isDirectory) {
              const dirEntry = entry as FileSystemDirectoryEntry;
              const reader = dirEntry.createReader();
              const entries = await new Promise<FileSystemEntry[]>((resolve) => {
                reader.readEntries(resolve);
              });
              for (const childEntry of entries) {
                await getEntries(childEntry, path ? `${path}/${dirEntry.name}` : dirEntry.name);
              }
            }
          };

          const promises: Promise<void>[] = [];
          for (let i = 0; i < e.dataTransfer.items.length; i++) {
            const item = e.dataTransfer.items[i];
            const entry = item.webkitGetAsEntry();
            if (entry) {
              promises.push(getEntries(entry));
            }
          }
          await Promise.all(promises);
        }

        if (filesWithPaths.length > 0) {
          // Check if we have a folder structure
          const hasFolderStructure = filesWithPaths.some(f => f.path.includes('/'));

          if (hasFolderStructure) {
            await handleFolderUpload(filesWithPaths.map(f => {
              // Create a new File object with webkitRelativePath set
              const newFile = new File([f.file], f.file.name, { type: f.file.type });
              Object.defineProperty(newFile, 'webkitRelativePath', {
                value: f.path,
                writable: false,
              });
              return newFile;
            }));
          } else {
            for (const { file } of filesWithPaths) {
              try {
                await handleUpload(file);
              } catch (err) {
                alert(`Upload-Fehler: ${err instanceof Error ? err.message : err}`);
              }
            }
            await loadFolder();
          }
        }
      }}
    >
      {/* Resize handle (left edge) */}
      <div
        onMouseDown={onWidthMouseDown}
        className="absolute left-0 top-0 z-20 h-full w-1 cursor-col-resize border-l border-surface-200 transition-colors hover:border-primary-400 hover:border-l-2 dark:border-surface-700 dark:hover:border-primary-600"
      />

      {/* External file drop overlay */}
      {dragOver && (
        <div className="absolute inset-0 z-40 flex items-center justify-center rounded-xl border-2 border-dashed border-primary-400 bg-primary-50/80 dark:bg-primary-950/80">
          <div className="flex flex-col items-center gap-2 text-primary-600 dark:text-primary-400">
            <Upload size={32} />
            <span className="text-sm font-medium">Dateien hier ablegen</span>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="shrink-0 border-b border-surface-200 dark:border-surface-700">
        <div className="flex items-center gap-2 px-4 pt-3 pb-2">
          <h3 className="flex-1 text-sm font-semibold text-surface-900 dark:text-white">Dateiablage</h3>
          <button onClick={onClose} className="rounded-md p-1.5 text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700">
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        {contextLabel && (
          <div className="flex border-t border-surface-100 dark:border-surface-800">
            {(['context', 'personal'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => handleTabChange(t)}
                className={clsx(
                  'flex-1 border-b-2 px-3 py-2 text-xs font-medium transition-colors',
                  tab === t
                    ? 'border-primary-600 text-primary-600 dark:border-primary-400 dark:text-primary-400'
                    : 'border-transparent text-surface-500 hover:text-surface-700 dark:hover:text-surface-300',
                )}
              >
                {t === 'context' ? contextLabel : 'Meine Dateien'}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Selection action bar */}
      {selectedIds.size > 0 && (
        <div className="shrink-0 flex items-center gap-2 border-b border-surface-100 bg-primary-50 px-3 py-2 dark:bg-primary-900/20 dark:border-surface-800">
          <span className="text-xs text-primary-700 dark:text-primary-300 font-medium">
            {selectedIds.size} ausgewählt
          </span>
          <div className="flex-1" />
          <button
            onClick={() => setMoveModalOpen(true)}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-surface-600 hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-800"
          >
            <Folder size={12} /><span>Verschieben</span>
          </button>
          <button
            onClick={handleBatchDownload}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-surface-600 hover:bg-surface-100 dark:text-surface-300 dark:hover:bg-surface-800"
          >
            <ExternalLink size={12} /><span>Download</span>
          </button>
          <button
            onClick={handleBatchDelete}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
          >
            <Trash2 size={12} /><span>Löschen</span>
          </button>
          <button
            onClick={() => setSelectedIds(new Set())}
            className="rounded-md p-1 text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700"
            title="Esc"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Toolbar: breadcrumb + view toggle + upload */}
      <div className="flex shrink-0 items-center gap-1 border-b border-surface-100 px-3 py-1.5 dark:border-surface-800">
        {/* Breadcrumb */}
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
          {crumbs.map((crumb, i) => (
            <span key={i} className="flex shrink-0 items-center gap-0.5">
              {i > 0 && <ChevronRight size={11} className="text-surface-300" />}
              {i === crumbs.length - 1 ? (
                <span className="max-w-[200px] truncate text-xs font-medium text-surface-700 dark:text-surface-300">
                  {i === 0 ? <Home size={12} className="inline" /> : crumb.name}
                </span>
              ) : (
                <button
                  onClick={() => navigateTo(i)}
                  className="max-w-[140px] truncate text-xs text-surface-400 hover:text-primary-600 dark:hover:text-primary-400"
                >
                  {i === 0 ? <Home size={12} className="inline" /> : crumb.name}
                </button>
              )}
            </span>
          ))}
        </div>

        {/* View mode toggle */}
        <button
          onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
          className="rounded-md p-1.5 text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700"
          title={viewMode === 'grid' ? 'Listenansicht' : 'Rasteransicht'}
        >
          {viewMode === 'grid' ? <List size={14} /> : <Grid3x3 size={14} />}
        </button>

        {/* New Folder */}
        <button
          onClick={() => setCreatingFolder(true)}
          disabled={creatingFolder}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-surface-600 hover:bg-surface-100 disabled:opacity-50 dark:text-surface-400 dark:hover:bg-surface-800"
          title="Neuer Ordner"
        >
          <Plus size={12} />
          <span className="hidden sm:inline">Ordner</span>
        </button>

        {/* Upload */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || uploadProgress !== null}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50 disabled:opacity-50 dark:text-primary-400 dark:hover:bg-primary-900/20"
        >
          {uploading || uploadProgress !== null ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
          {uploading ? 'Lädt…' : uploadProgress !== null ? 'Upload läuft…' : 'Upload'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          {...{ webkitdirectory: '', directory: '' }}
          className="hidden"
          onChange={handleFolderInputChange}
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* New Folder Input */}
        {creatingFolder && (
          <div className="flex items-center gap-2 border-b border-surface-100 px-3 py-2 dark:border-surface-800">
            <Folder size={16} className="text-primary-500" />
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreateFolder();
                if (e.key === 'Escape') {
                  setCreatingFolder(false);
                  setNewFolderName('');
                }
              }}
              placeholder="Ordnername..."
              autoFocus
              className="flex-1 rounded-md border border-surface-200 bg-white px-2 py-1 text-sm outline-none focus:border-primary-500 dark:border-surface-700 dark:bg-surface-800"
            />
            <button
              onClick={handleCreateFolder}
              disabled={!newFolderName.trim()}
              className="rounded-md p-1 text-primary-600 hover:bg-primary-50 disabled:opacity-50 dark:text-primary-400 dark:hover:bg-primary-900/20"
              title="Erstellen"
            >
              <Check size={16} />
            </button>
            <button
              onClick={() => {
                setCreatingFolder(false);
                setNewFolderName('');
              }}
              className="rounded-md p-1 text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800"
              title="Abbrechen"
            >
              <X size={16} />
            </button>
          </div>
        )}
        {loading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 size={24} className="animate-spin text-primary-400" />
          </div>
        ) : folders.length === 0 && files.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center gap-2 text-surface-400">
            <Folder size={36} className="opacity-30" />
            <p className="text-sm">Keine Dateien vorhanden</p>
          </div>
        ) : viewMode === 'grid' ? (
          <GridView {...viewProps} />
        ) : (
          <ListView {...viewProps} />
        )}
      </div>

      {/* Image lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm"
          onClick={() => setLightboxUrl(null)}
        >
          <button className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20" onClick={() => setLightboxUrl(null)}>
            <X size={22} />
          </button>
          <img
            src={lightboxUrl}
            className="max-h-[90vh] max-w-[90vw] rounded-xl object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* PDF viewer */}
      {pdfView && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-sm"
          onClick={() => setPdfView(null)}
        >
          <div
            className="relative flex h-[90vh] w-[90vw] max-w-4xl flex-col rounded-xl bg-surface-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex shrink-0 items-center gap-3 border-b border-surface-700 px-4 py-2">
              <span className="flex-1 truncate text-sm font-medium text-white">{pdfView.name}</span>
              <a href={api.fileDownloadUrl(pdfView.fileId, pdfView.name)} download={pdfView.name} className="rounded-md p-1.5 text-surface-300 hover:bg-surface-700" title="Herunterladen">
                <ExternalLink size={16} />
              </a>
              <button onClick={() => setPdfView(null)} className="rounded-md p-1.5 text-surface-300 hover:bg-surface-700"><X size={16} /></button>
            </div>
            <iframe src={pdfView.viewUrl} className="flex-1 rounded-b-xl" title={pdfView.name} />
          </div>
        </div>
      )}

      {/* Folder upload progress */}
      {uploadProgress && (
        <FolderUploadProgress
          progress={uploadProgress}
          onClose={() => setUploadProgress(null)}
        />
      )}

      {/* Move modal */}
      {moveModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-80 rounded-xl border border-surface-200 bg-surface-50 p-4 shadow-xl dark:border-surface-700 dark:bg-surface-900">
            <h4 className="mb-3 text-sm font-semibold text-surface-900 dark:text-white">
              Verschieben nach…
            </h4>

            {/* Current folder (no-op) */}
            <button
              onClick={() => setMoveModalOpen(false)}
              className="mb-2 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-100 dark:hover:bg-surface-800"
            >
              <Home size={14} className="text-surface-400" />
              <span className="text-surface-700 dark:text-surface-300">Aktueller Ordner</span>
            </button>

            {/* Parent folder (go back one level) */}
            {crumbs.length > 1 && (
              <button
                onClick={() => { navigateTo(crumbs.length - 2); setMoveModalOpen(false); }}
                className="mb-2 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-100 dark:hover:bg-surface-800"
              >
                <ArrowUp size={14} className="text-surface-400" />
                <span className="text-surface-700 dark:text-surface-300">Eine Ebene zurück</span>
              </button>
            )}

            {/* Subfolders as destinations */}
            <div className="max-h-60 overflow-y-auto space-y-1">
              {sortedFolders.filter(f => !selectedIds.has(f.id)).map(f => (
                <button
                  key={f.id}
                  onClick={() => handleMoveSelected(f.id)}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-100 dark:hover:bg-surface-800"
                >
                  <Folder size={14} className="text-amber-400 shrink-0" />
                  <span className="truncate text-surface-700 dark:text-surface-300">{f.name}</span>
                </button>
              ))}
              {sortedFolders.filter(f => !selectedIds.has(f.id)).length === 0 && (
                <p className="py-2 text-xs text-surface-400 text-center">Keine Unterordner</p>
              )}
            </div>

            <div className="mt-3 flex justify-end">
              <button
                onClick={() => setMoveModalOpen(false)}
                className="rounded-md px-3 py-1.5 text-xs font-medium text-surface-500 hover:bg-surface-100 dark:hover:bg-surface-800"
              >
                Abbrechen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
