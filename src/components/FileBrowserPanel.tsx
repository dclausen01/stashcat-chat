import { useState, useEffect, useCallback, useRef } from 'react';
import {
  X, Grid3x3, List, Upload, Folder, ChevronRight, Home,
  Trash2, Pencil, Check, Loader2, ExternalLink,
} from 'lucide-react';
import { clsx } from 'clsx';
import * as api from '../api';
import { fileIcon } from '../utils/fileIcon';
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
type ViewMode = 'grid' | 'list';

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
  renamingId: string | null;
  renameValue: string;
  setRenameValue: (v: string) => void;
  commitRename: (f: FileEntry) => void;
  onDragFileStart?: (fileId: string) => void;
  onDragFileEnd?: () => void;
  onDropOnFolder?: (fileId: string, folderId: string) => void;
}

// ── Grid view ─────────────────────────────────────────────────────────────────

function GridView({ folders, files, onFolderClick, onImageClick, onPdfClick, onRename, onDelete, renamingId, renameValue, setRenameValue, commitRename, onDragFileStart, onDragFileEnd, onDropOnFolder }: ViewProps) {
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  return (
    <div className="grid grid-cols-3 gap-2 p-3">
      {folders.map((f) => (
        <button
          key={f.id}
          onClick={() => onFolderClick(f)}
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
            'group flex flex-col items-center gap-1.5 rounded-xl p-2 transition',
            dropTargetId === f.id
              ? 'bg-primary-100 ring-2 ring-primary-400 dark:bg-primary-900/30'
              : 'hover:bg-surface-100 dark:hover:bg-surface-800',
          )}
        >
          <Folder size={40} className="text-amber-400" fill="currentColor" />
          <span className="w-full truncate text-center text-xs text-surface-700 dark:text-surface-300">{f.name}</span>
        </button>
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
            className="group relative flex flex-col items-center gap-1.5 rounded-xl p-2 hover:bg-surface-100 dark:hover:bg-surface-800 cursor-grab active:cursor-grabbing"
          >
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

function ListView({ folders, files, onFolderClick, onImageClick, onPdfClick, onRename, onDelete, renamingId, renameValue, setRenameValue, commitRename, onDragFileStart, onDragFileEnd, onDropOnFolder }: ViewProps) {
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  return (
    <div className="flex flex-col divide-y divide-surface-100 px-1 dark:divide-surface-800">
      {folders.map((f) => (
        <button
          key={f.id}
          onClick={() => onFolderClick(f)}
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
            'flex items-center gap-3 px-3 py-2.5 transition',
            dropTargetId === f.id
              ? 'bg-primary-100 ring-2 ring-primary-400 dark:bg-primary-900/30'
              : 'hover:bg-surface-100 dark:hover:bg-surface-800',
          )}
        >
          <Folder size={18} className="shrink-0 text-amber-400" fill="currentColor" />
          <span className="min-w-0 flex-1 truncate text-left text-sm text-surface-800 dark:text-surface-200">{f.name}</span>
          <ChevronRight size={14} className="shrink-0 text-surface-400" />
        </button>
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
            className="group flex items-center gap-3 px-3 py-2 hover:bg-surface-50 dark:hover:bg-surface-800/50 cursor-grab active:cursor-grabbing"
          >
            {/* Icon / thumbnail */}
            <button
              className="shrink-0"
              onClick={() => isImage ? onImageClick(viewUrl) : isPdf ? onPdfClick(f.id, viewUrl, f.name) : undefined}
              title={isImage ? 'Vergrößern' : isPdf ? 'Vorschau' : undefined}
            >
              {isImage ? (
                <img src={viewUrl} alt={f.name} className="h-9 w-9 rounded object-cover" loading="lazy" />
              ) : (
                <span className="text-xl">{fileIcon(f.mime, f.ext)}</span>
              )}
            </button>

            {/* Name */}
            <div className="min-w-0 flex-1">
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
              <span className="text-xs text-surface-400">
                {f.size_string}
                {f.size_string && f.uploaded && ' · '}
                {formatDate(f.uploaded)}
              </span>
            </div>

            {/* Actions (visible on hover) */}
            <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
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
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function FileBrowserPanel({ chat, onClose }: FileBrowserPanelProps) {
  const [tab, setTab] = useState<Tab>(chat ? 'context' : 'personal');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [crumbs, setCrumbs] = useState<Crumb[]>([{ id: null, name: 'Alle Dateien' }]);
  const [folders, setFolders] = useState<FolderEntry[]>([]);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [pdfView, setPdfView] = useState<{ fileId: string; viewUrl: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [dragFileId, setDragFileId] = useState<string | null>(null);
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

  const handleTabChange = (t: Tab) => {
    setTab(t);
    setCrumbs([{ id: null, name: 'Alle Dateien' }]);
  };

  const navigateInto = (folder: FolderEntry) => {
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

  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      if (tab === 'personal') {
        await api.uploadToStorage('personal', undefined, file, currentFolderId);
      } else if (chat) {
        await api.uploadToStorage(chat.type, chat.id, file, currentFolderId);
      }
      await loadFolder();
    } catch (err) {
      alert(`Upload-Fehler: ${err instanceof Error ? err.message : err}`);
    } finally {
      setUploading(false);
    }
  };

  const contextLabel = chat
    ? chat.type === 'channel' ? 'Channel-Dateien' : 'Konversation'
    : null;

  const viewProps: ViewProps = {
    folders, files, onFolderClick: navigateInto,
    onImageClick: setLightboxUrl,
    onPdfClick: (fid, vurl, name) => setPdfView({ fileId: fid, viewUrl: vurl, name }),
    onRename: startRename, onDelete: handleDelete,
    renamingId, renameValue, setRenameValue, commitRename,
    onDragFileStart: setDragFileId,
    onDragFileEnd: () => setDragFileId(null),
    onDropOnFolder: handleMoveToFolder,
  };

  return (
    <div
      className="relative flex h-full w-96 shrink-0 flex-col border-l border-surface-200 bg-surface-50 dark:border-surface-700 dark:bg-surface-900"
      onDragOver={(e) => {
        e.preventDefault();
        // Only show drop overlay for external files, not internal drag
        if (!dragFileId && e.dataTransfer.types.includes('Files')) setDragOver(true);
      }}
      onDragLeave={(e) => { if (e.currentTarget.contains(e.relatedTarget as Node)) return; setDragOver(false); }}
      onDrop={async (e) => {
        e.preventDefault();
        setDragOver(false);
        const droppedFiles = Array.from(e.dataTransfer.files);
        for (const f of droppedFiles) await handleUpload(f);
      }}
    >
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

      {/* Toolbar: breadcrumb + view toggle + upload */}
      <div className="flex shrink-0 items-center gap-1 border-b border-surface-100 px-3 py-1.5 dark:border-surface-800">
        {/* Breadcrumb */}
        <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
          {crumbs.map((crumb, i) => (
            <span key={i} className="flex shrink-0 items-center gap-0.5">
              {i > 0 && <ChevronRight size={11} className="text-surface-300" />}
              {i === crumbs.length - 1 ? (
                <span className="max-w-[120px] truncate text-xs font-medium text-surface-700 dark:text-surface-300">
                  {i === 0 ? <Home size={12} className="inline" /> : crumb.name}
                </span>
              ) : (
                <button
                  onClick={() => navigateTo(i)}
                  className="max-w-[80px] truncate text-xs text-surface-400 hover:text-primary-600 dark:hover:text-primary-400"
                >
                  {i === 0 ? <Home size={12} className="inline" /> : crumb.name}
                </button>
              )}
            </span>
          ))}
        </div>

        {/* View mode toggle */}
        <button
          onClick={() => setViewMode((m) => m === 'grid' ? 'list' : 'grid')}
          className="rounded-md p-1.5 text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700"
          title={viewMode === 'grid' ? 'Listenansicht' : 'Rasteransicht'}
        >
          {viewMode === 'grid' ? <List size={14} /> : <Grid3x3 size={14} />}
        </button>

        {/* Upload */}
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50 disabled:opacity-50 dark:text-primary-400 dark:hover:bg-primary-900/20"
        >
          {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
          {uploading ? 'Lädt…' : 'Upload'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            const list = Array.from(e.target.files || []);
            e.target.value = '';
            list.forEach(handleUpload);
          }}
        />
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
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
    </div>
  );
}
