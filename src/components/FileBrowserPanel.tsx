import { useState, useEffect, useCallback, useRef } from 'react';
import {
  X, Grid3x3, List, Upload, Folder, ChevronRight, Home,
  Trash2, Pencil, Check, Loader2, ExternalLink, ArrowUp, ArrowDown, Plus,
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
}

// ── Grid view ─────────────────────────────────────────────────────────────────

function GridView({ folders, files, onFolderClick, onImageClick, onPdfClick, onRename, onDelete, onDeleteFolder, renamingId, renameValue, setRenameValue, commitRename, onDragFileStart, onDragFileEnd, onDropOnFolder }: ViewProps) {
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  return (
    <div className="grid grid-cols-3 gap-2 p-3">
      {folders.map((f) => (
        <div
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
            'group relative flex flex-col items-center gap-1.5 rounded-xl p-2 transition cursor-pointer',
            dropTargetId === f.id
              ? 'bg-primary-100 ring-2 ring-primary-400 dark:bg-primary-900/30'
              : 'hover:bg-surface-100 dark:hover:bg-surface-800',
          )}
        >
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

function ListView({ folders, files, onFolderClick, onImageClick, onPdfClick, onRename, onDelete, onDeleteFolder, renamingId, renameValue, setRenameValue, commitRename, onDragFileStart, onDragFileEnd, onDropOnFolder, sortField, sortDirection, onSort }: ViewProps) {
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
      <div className="flex items-center gap-3 border-b border-surface-100 px-3 py-2 dark:border-surface-800">
        <div className="w-10 shrink-0" /> {/* Icon column */}
        <div className="min-w-0 flex-1">
          <SortHeader field="name" label="Name" />
        </div>
        <div className="w-16 shrink-0 text-right">
          <SortHeader field="size" label="Größe" className="justify-end" />
        </div>
        <div className="w-20 shrink-0 text-right">
          <SortHeader field="date" label="Datum" className="justify-end" />
        </div>
        <div className="w-16 shrink-0" /> {/* Actions column */}
      </div>

      <div className="flex flex-col divide-y divide-surface-100 px-1 dark:divide-surface-800">
        {folders.map((f) => (
          <div
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
              'group flex items-center gap-3 px-3 py-2.5 transition cursor-pointer',
              dropTargetId === f.id
                ? 'bg-primary-100 ring-2 ring-primary-400 dark:bg-primary-900/30'
                : 'hover:bg-surface-100 dark:hover:bg-surface-800',
            )}
          >
            <div className="w-10 shrink-0 flex justify-center">
              <Folder size={18} className="text-amber-400" fill="currentColor" />
            </div>
            <span className="min-w-0 flex-1 truncate text-left text-sm text-surface-800 dark:text-surface-200">{f.name}</span>
            <span className="w-16 shrink-0 text-right text-xs text-surface-400" />
            <span className="w-20 shrink-0 text-right text-xs text-surface-400">{formatDate(f.created)}</span>
            <div className="w-16 shrink-0 flex justify-end items-center gap-1">
              {onDeleteFolder && (
                <button
                  onClick={(e) => { e.stopPropagation(); onDeleteFolder(f); }}
                  className="rounded-full p-1 text-surface-400 opacity-0 transition hover:bg-red-100 hover:text-red-500 group-hover:opacity-100 dark:hover:bg-red-900/30"
                  title="Ordner löschen"
                >
                  <Trash2 size={14} />
                </button>
              )}
              <ChevronRight size={14} className="text-surface-400" />
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
              className="group flex items-center gap-3 px-3 py-2 hover:bg-surface-50 dark:hover:bg-surface-800/50 cursor-grab active:cursor-grabbing"
            >
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
              </div>

              {/* Size */}
              <span className="w-16 shrink-0 text-right text-xs text-surface-400">
                {f.size_string}
              </span>

              {/* Date */}
              <span className="w-20 shrink-0 text-right text-xs text-surface-400">
                {formatDate(f.uploaded)}
              </span>

              {/* Actions (visible on hover) */}
              <div className="hidden shrink-0 items-center justify-end gap-0.5 w-16 group-hover:flex">
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

  // Initialize tab based on chat availability
  const [tabInitialized, setTabInitialized] = useState(false);
  useEffect(() => {
    if (!tabInitialized) {
      setTabInitialized(true);
      if (!chat && tab !== 'personal') {
        setTab('personal');
      }
    }
  }, [chat, tab, tabInitialized, setTab]);

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
    console.log('handleUpload called:', file.name, 'folderId:', folderId);
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
          // API returns: { folder: { id: number, ... } }
          const folderId = (newFolder.folder as Record<string, unknown>)?.id;
          console.log('Created folder:', folderPath, 'ID:', folderId, 'Full response:', newFolder);
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
        console.log('Target details:', { folderPath, targetFolderId, parentId, uploadType, uploadTypeId: uploadTypeId?.slice(0, 5) + '...' });
        console.log('Uploading files to folder:', folderPath, 'targetFolderId:', targetFolderId, 'Files:', entry.files.length);
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
    </div>
  );
}
