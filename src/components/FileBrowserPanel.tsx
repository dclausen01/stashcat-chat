import { useState, useEffect, useCallback, useRef, useMemo, type CSSProperties } from 'react';
import {
  X, Grid3x3, List, Upload, Folder, ChevronRight, Home,
  Trash2, Loader2, Plus, Cloud, ArrowLeft, ExternalLink, Check, HardDrive, ArrowUp,
} from 'lucide-react';
import { useFileSorting } from '../hooks/useFileSorting';
import { FolderUploadProgress, type FolderUploadProgressData } from './FolderUploadProgress';
import { clsx } from 'clsx';
import * as api from '../api';
import { useSettings } from '../context/SettingsContext';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../context/ConfirmContext';
import type { ChatTarget } from '../types';
import ShareToChatModal from './ShareToChatModal';
import { QuotaBar } from './fileBrowser/QuotaBar';
import { NCQuotaBar } from './fileBrowser/NCQuotaBar';
import { GridView } from './fileBrowser/GridView';
import { ListView } from './fileBrowser/ListView';
import { formatBytes } from './fileBrowser/helpers';
import type { FolderEntry, FileEntry, Crumb, Tab, ViewProps } from './fileBrowser/types';

interface FileBrowserPanelProps {
  chat: ChatTarget | null;
  onClose: () => void;
  fullscreen?: boolean;
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function FileBrowserPanel({ chat, onClose, fullscreen = false }: FileBrowserPanelProps) {
  const settings = useSettings();
  const { user } = useAuth();
  const confirmAsync = useConfirm();
  const setTab = settings.setFileBrowserTab;
  const viewMode = settings.fileBrowserViewMode;
  const setViewMode = settings.setFileBrowserViewMode;

  // Panel width (horizontal resize from left edge)
  const [panelWidth, setPanelWidth] = useState(() => {
    const saved = localStorage.getItem('schulchat_filebrowser_width');
    return saved ? Number(saved) : (window.innerWidth < 640 ? window.innerWidth - 16 : 384);
  });
  const panelWidthRef = useRef(panelWidth);
  const resizingWidth = useRef(false);

  const onWidthMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizingWidth.current = true;
    const startX = e.clientX;
    const startW = panelWidthRef.current;
    const onMove = (ev: MouseEvent) => {
      // Resize from left edge: moving left increases width, moving right decreases
      const minW = window.innerWidth < 768 ? 280 : 280;
      const maxW = window.innerWidth < 768 ? window.innerWidth - 16 : 600;
      const newW = Math.max(minW, Math.min(maxW, startW - (ev.clientX - startX)));
      setPanelWidth(newW);
      panelWidthRef.current = newW;
    };
    const onUp = () => {
      resizingWidth.current = false;
      localStorage.setItem('schulchat_filebrowser_width', String(panelWidthRef.current));
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  const [crumbs, setCrumbs] = useState<Crumb[]>([{ id: null, name: 'Alle Dateien' }]);

  // Local tab state. Initialized to 'context' when opening with a chat,
  // else to the persisted preference. Resets to 'context' whenever the
  // active chat changes (different chat id).
  const [tab, setTabState] = useState<Tab>(() => chat ? 'context' : settings.fileBrowserTab);

  const prevChatIdRef = useRef<string | undefined>(chat?.id);
  useEffect(() => {
    const newId = chat?.id;
    if (newId !== prevChatIdRef.current) {
      prevChatIdRef.current = newId;
      if (chat) setTabState('context');
    }
  }, [chat]);
  const [folders, setFolders] = useState<FolderEntry[]>([]);
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const { sortField, sortDirection, setSort, sortedFolders, sortedFiles } = useFileSorting(folders, files);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [pdfView, setPdfView] = useState<{ fileId: string; viewUrl: string; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadByteProgress, setUploadByteProgress] = useState<number | null>(null);
  const [uploadProgress, setUploadProgress] = useState<FolderUploadProgressData | null>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [dragFileId, setDragFileId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [moveModalOpen, setMoveModalOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Quota state
  const [personalQuota, setPersonalQuota] = useState<api.FileQuota | null>(null);

  // Nextcloud state
  const [ncProbeStatus, setNcProbeStatus] = useState<api.NCStatus | null>(null);
  const [ncProbing, setNcProbing] = useState(false);
  const [ncAppPwInput, setNcAppPwInput] = useState('');
  const [ncUsernameInput, setNcUsernameInput] = useState('');
  const [ncSaving, setNcSaving] = useState(false);

  // Pre-fill from localStorage on first mount only (don't override user input on re-render)
  const isFirstMount = useRef(true);
  useEffect(() => {
    if (!isFirstMount.current) return;
    isFirstMount.current = false;
    const storedPw = api.ncGetStoredAppPassword() || '';
    const storedUser = api.ncGetUsernameOverride() || '';
    if (storedPw) setNcAppPwInput(storedPw);
    if (storedUser) setNcUsernameInput(storedUser);
  }, []);
  const [shareFile, setShareFile] = useState<FileEntry | null>(null);

  const currentFolderId = useMemo(() => crumbs[crumbs.length - 1].id ?? undefined, [crumbs]);

  const loadFolder = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === 'nextcloud') {
        const entries = await api.ncList(currentFolderId || '/');
        setFolders(entries.filter(e => e.isFolder).map(e => ({
          id: e.path,
          name: e.name,
          modified: e.modified,
        })));
        setFiles(entries.filter(e => !e.isFolder).map(e => ({
          id: e.path,
          name: e.name,
          size_string: e.size != null ? formatBytes(e.size) : undefined,
          mime: e.mime,
          ext: e.name.split('.').pop()?.toLowerCase(),
          uploaded: e.modified,
          modified: e.modified,
        })));
      } else {
        const result = tab === 'personal'
          ? await api.listPersonalFiles(currentFolderId)
          : chat
            ? await api.listFolder(chat.type, chat.id, currentFolderId)
            : { folder: [], files: [] };
        setFolders(result.folder as unknown as FolderEntry[]);
        setFiles(result.files as unknown as FileEntry[]);
      }
    } catch (err) {
      console.error('Failed to load folder:', err);
    } finally {
      setLoading(false);
    }
  }, [tab, chat, crumbs]);

  // Load quotas when tab or chat changes
  useEffect(() => {
    if (tab !== 'nextcloud' && user?.id) {
      api.getFileQuota('personal', String(user.id))
        .then(setPersonalQuota)
        .catch(() => setPersonalQuota(null));
    }
  }, [tab, chat?.id, chat?.type, user?.id]);

  // Probe NC credentials when NC tab is opened
  useEffect(() => {
    if (tab !== 'nextcloud') return;
    setNcProbing(true);
    api.ncProbeAndDetect()
      .then(setNcProbeStatus)
      .catch(() => setNcProbeStatus({ configured: false, needsAppPassword: true }))
      .finally(() => setNcProbing(false));
  }, [tab]);

  // Escape key to clear selection
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedIds.size > 0) setSelectedIds(new Set());
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIds.size]);

  const handleTabChange = (t: Tab) => {
    setTabState(t);
    setTab(t);
    setCrumbs([{ id: null, name: 'Alle Dateien' }]);
  };

  // Auto-reload when crumbs change (folder navigation, tab switch).
  // Skip Nextcloud loads while throttled — would just produce more 429s.
  useEffect(() => {
    if (tab === 'nextcloud' && ncProbeStatus?.throttled) return;
    loadFolder();
  }, [crumbs, tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const navigateInto = (folder: FolderEntry) => {
    setSelectedIds(new Set()); // clear selection on navigation
    setCrumbs((prev) => [...prev, { id: folder.id, name: folder.name }]);
  };

  const navigateTo = (index: number) => {
    setCrumbs((prev) => prev.slice(0, index + 1));
  };

  const handleDelete = async (f: FileEntry) => {
    if (!await confirmAsync(`"${f.name}" wirklich löschen?`)) return;
    try {
      if (tab === 'nextcloud') {
        await api.ncDelete([f.id]);
      } else {
        await api.deleteFile(f.id);
      }
      setFiles((prev) => prev.filter((x) => x.id !== f.id));
    } catch (err) {
      alert(`Fehler: ${err instanceof Error ? err.message : err}`);
    }
  };

  const handleDeleteFolder = async (f: FolderEntry) => {
    if (!await confirmAsync(`Ordner "${f.name}" und alle Inhalte wirklich löschen?`)) return;
    try {
      if (tab === 'nextcloud') {
        await api.ncDelete([f.id]);
      } else {
        await api.deleteFolder(f.id);
      }
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
      if (tab === 'nextcloud') {
        await api.ncRename(f.id, newName);
        // Update the id (path) to reflect the new name
        const parent = f.id.substring(0, f.id.lastIndexOf('/')) || '/';
        const newPath = parent.replace(/\/$/, '') + '/' + newName;
        setFiles((prev) => prev.map((x) => x.id === f.id ? { ...x, id: newPath, name: newName } : x));
      } else {
        await api.renameFile(f.id, newName);
        setFiles((prev) => prev.map((x) => x.id === f.id ? { ...x, name: newName } : x));
      }
    } catch (err) {
      alert(`Fehler: ${err instanceof Error ? err.message : err}`);
    }
  };

  const handleMoveToFolder = async (fileId: string, folderId: string) => {
    try {
      if (tab === 'nextcloud') {
        const fileName = fileId.split('/').pop() || fileId;
        const toPath = folderId.replace(/\/$/, '') + '/' + fileName;
        await api.ncMove(fileId, toPath);
      } else {
        await api.moveFile(fileId, folderId);
      }
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
    if (!await confirmAsync(`${total} Item(s) wirklich löschen?`)) return;
    try {
      if (tab === 'nextcloud') {
        const allPaths = [...selFiles.map(f => f.id), ...selFolders.map(f => f.id)];
        await api.ncDelete(allPaths);
        setFiles(prev => prev.filter(f => !selectedIds.has(f.id)));
        setFolders(prev => prev.filter(f => !selectedIds.has(f.id)));
      } else {
        if (selFiles.length > 0) {
          await api.deleteFiles(selFiles.map(f => f.id));
          setFiles(prev => prev.filter(f => !selectedIds.has(f.id)));
        }
        for (const folder of selFolders) {
          await api.deleteFolder(folder.id);
          setFolders(prev => prev.filter(f => f.id !== folder.id));
        }
      }
    } catch (err) {
      alert(`Fehler: ${err instanceof Error ? err.message : err}`);
    }
    setSelectedIds(new Set());
  }, [tab, selectedIds, sortedFiles, sortedFolders]);

  const handleBatchDownload = useCallback(() => {
    sortedFiles.filter(f => selectedIds.has(f.id)).forEach((f, i) => {
      setTimeout(() => {
        const a = document.createElement('a');
        a.href = tab === 'nextcloud' ? api.ncDownloadUrl(f.id) : api.fileDownloadUrl(f.id, f.name);
        a.download = f.name;
        a.click();
      }, i * 200);
    });
  }, [tab, selectedIds, sortedFiles]);

  const handleMoveSelected = useCallback(async (targetFolderId: string) => {
    setMoveModalOpen(false);
    try {
      for (const id of selectedIds) {
        if (sortedFiles.some(f => f.id === id)) {
          if (tab === 'nextcloud') {
            const fileName = id.split('/').pop() || id;
            await api.ncMove(id, targetFolderId.replace(/\/$/, '') + '/' + fileName);
          } else {
            await api.moveFile(id, targetFolderId);
          }
        }
      }
      await loadFolder();
      setSelectedIds(new Set());
    } catch (err) {
      alert(`Verschieben fehlgeschlagen: ${err instanceof Error ? err.message : err}`);
    }
  }, [tab, selectedIds, sortedFiles, loadFolder]);

  // ── /Selection handlers ─────────────────────────────────────────────────────

  const handleCreateFolder = async () => {
    if (!newFolderName.trim()) return;
    try {
      if (tab === 'nextcloud') {
        const basePath = currentFolderId || '/';
        const newPath = basePath.replace(/\/$/, '') + '/' + newFolderName.trim();
        await api.ncMkcol(newPath);
      } else {
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
      }
      setNewFolderName('');
      setCreatingFolder(false);
      await loadFolder();
    } catch (err) {
      alert(`Ordner erstellen fehlgeschlagen: ${err instanceof Error ? err.message : err}`);
    }
  };

  const handleUpload = async (file: File, folderId?: string) => {
    setUploading(true);
    setUploadByteProgress(0);
    const onProgress = (pct: number) => setUploadByteProgress(pct);
    try {
      if (tab === 'nextcloud') {
        const uploadPath = folderId ?? currentFolderId ?? '/';
        await api.ncUpload(uploadPath, file);
      } else if (tab === 'personal') {
        const userId = user?.id ? String(user.id) : undefined;
        await api.uploadToStorage('personal', userId, file, folderId ?? currentFolderId, onProgress);
      } else if (chat) {
        await api.uploadToStorage(chat.type, chat.id, file, folderId ?? currentFolderId, onProgress);
      }
    } catch (err) {
      throw err;
    } finally {
      setUploading(false);
      setUploadByteProgress(null);
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
          // console.warn('Failed to create folder, might exist:', folderPath, err);
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

  /** Open a file preview: images → lightbox, PDF → iframe modal, Office → OnlyOffice viewer, others → new tab */
  const handleFileOpen = useCallback((f: FileEntry) => {
    const viewUrl = tab === 'nextcloud' ? api.ncViewUrl(f.id) : api.fileViewUrl(f.id, f.name);
    if (f.mime?.startsWith('image/')) {
      setLightboxUrl(viewUrl);
    } else if (f.mime === 'application/pdf' || f.ext?.toLowerCase() === 'pdf') {
      setPdfView({ fileId: f.id, viewUrl, name: f.name });
    } else if (tab !== 'nextcloud' && api.canViewInOnlyOffice(f.name)) {
      api.openInOnlyOffice(f.id, f.name);
    } else if (tab === 'nextcloud' && api.canViewInOnlyOffice(f.name)) {
      api.ncOpenInOnlyOffice(f.id, f.name);
    } else {
      window.open(viewUrl, '_blank', 'noopener');
    }
  }, [tab]);

  const buildDownloadUrl = useCallback((f: FileEntry) =>
    tab === 'nextcloud' ? api.ncDownloadUrl(f.id) : api.fileDownloadUrl(f.id, f.name),
  [tab]);

  const buildViewUrl = useCallback((f: FileEntry) =>
    tab === 'nextcloud' ? api.ncViewUrl(f.id) : api.fileViewUrl(f.id, f.name),
  [tab]);

  const viewProps: ViewProps = {
    folders: sortedFolders,
    files: sortedFiles,
    onFolderClick: navigateInto,
    onFileOpen: handleFileOpen,
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
    buildDownloadUrl,
    buildViewUrl,
    onShare: tab === 'nextcloud' ? (f) => setShareFile(f) : undefined,
    onOnlyOfficeClick:
      api.canViewInOnlyOffice('')
        ? (f) => tab === 'nextcloud'
          ? api.ncOpenInOnlyOffice(f.id, f.name)
          : api.openInOnlyOffice(f.id, f.name)
        : undefined,
  };

  return (
    <div
      className={clsx(
        'relative flex h-full shrink-0 flex-col bg-surface-50 dark:bg-surface-900',
        fullscreen
          ? 'w-full flex-1'
          : 'w-full border-l border-surface-200 md:w-[var(--filebrowser-w)] dark:border-surface-700',
      )}
      style={fullscreen ? undefined : ({ '--filebrowser-w': `${panelWidth}px` } as CSSProperties)}
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
      {/* Resize handle (left edge) — only in side-panel mode */}
      {!fullscreen && (
        <div
          onMouseDown={onWidthMouseDown}
          className="absolute left-0 top-0 z-20 h-full w-1 cursor-col-resize border-l border-surface-200 transition-colors hover:border-primary-400 hover:border-l-2 dark:border-surface-700 dark:hover:border-primary-600"
        />
      )}

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
      <div className="bridge-sticky-top shrink-0 border-b border-surface-200 dark:border-surface-700">
        <div className="flex items-center gap-2 px-4 pt-3 pb-2">
          {!fullscreen && (
            <button
              onClick={onClose}
              aria-label="Zurück"
              className="-ml-1 rounded-md p-1.5 text-surface-600 hover:bg-surface-200 dark:hover:bg-surface-700 md:hidden"
            >
              <ArrowLeft size={20} />
            </button>
          )}
          <h3 className="flex-1 text-sm font-semibold text-surface-900 dark:text-white">Dateiablage</h3>
          <button
            onClick={onClose}
            className={clsx('rounded-md p-1.5 text-surface-500 hover:bg-surface-200 dark:hover:bg-surface-700', fullscreen ? 'block' : 'hidden md:block')}
          >
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-t border-surface-100 dark:border-surface-800">
          {contextLabel && (['context', 'personal'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => handleTabChange(t)}
              className={clsx(
                'border-b-2 px-3 py-2 text-left text-xs font-medium transition-colors',
                tab === t
                  ? 'border-primary-600 text-primary-600 dark:border-primary-400 dark:text-primary-400'
                  : 'border-transparent text-surface-500 hover:text-surface-700 dark:hover:text-surface-400',
              )}
            >
              {t === 'context' ? contextLabel : 'Meine Dateien'}
            </button>
          ))}
          {!contextLabel && (
            <button
              onClick={() => handleTabChange('personal')}
              className={clsx(
                'border-b-2 px-3 py-2 text-left text-xs font-medium transition-colors',
                tab === 'personal'
                  ? 'border-primary-600 text-primary-600 dark:border-primary-400 dark:text-primary-400'
                  : 'border-transparent text-surface-500 hover:text-surface-700 dark:hover:text-surface-400',
              )}
            >
              Meine Dateien
            </button>
          )}
          <button
            onClick={() => handleTabChange('nextcloud')}
            className={clsx(
              'flex items-center gap-1 border-b-2 px-3 py-2 text-left text-xs font-medium transition-colors',
              tab === 'nextcloud'
                ? 'border-blue-700 text-blue-700 dark:border-blue-400 dark:text-blue-400'
                : 'border-transparent text-surface-500 hover:text-surface-700 dark:hover:text-surface-400',
            )}
          >
            <Cloud size={12} />
            Nextcloud
          </button>
        </div>
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
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-surface-600 hover:bg-surface-200 dark:text-surface-400 dark:hover:bg-surface-800"
          >
            <Folder size={12} /><span>Verschieben</span>
          </button>
          <button
            onClick={handleBatchDownload}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-surface-600 hover:bg-surface-200 dark:text-surface-400 dark:hover:bg-surface-800"
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
            className="rounded-md p-1 text-surface-500 hover:bg-surface-200 dark:hover:bg-surface-700"
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
              {i > 0 && <ChevronRight size={11} className="text-surface-400" />}
              {i === crumbs.length - 1 ? (
                <span className="max-w-[200px] truncate text-xs font-medium text-surface-700 dark:text-surface-400">
                  {i === 0 ? <Home size={12} className="inline" /> : crumb.name}
                </span>
              ) : (
                <button
                  onClick={() => navigateTo(i)}
                  className="max-w-[140px] truncate text-xs text-surface-500 hover:text-primary-600 dark:hover:text-primary-400"
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
          className="rounded-md p-1.5 text-surface-500 hover:bg-surface-200 dark:hover:bg-surface-700"
          title={viewMode === 'grid' ? 'Listenansicht' : 'Rasteransicht'}
        >
          {viewMode === 'grid' ? <List size={14} /> : <Grid3x3 size={14} />}
        </button>

        {/* New Folder */}
        <button
          onClick={() => setCreatingFolder(true)}
          disabled={creatingFolder}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-surface-600 hover:bg-surface-200 disabled:opacity-50 dark:text-surface-500 dark:hover:bg-surface-800"
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
          {uploading
            ? uploadByteProgress !== null && uploadByteProgress < 100
              ? `${uploadByteProgress}%`
              : 'Verarbeitung…'
            : uploadProgress !== null
              ? 'Upload läuft…'
              : 'Upload'}
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
              className="flex-1 rounded-md border border-surface-200 bg-white px-2 py-1 text-sm text-surface-900 outline-none focus:border-primary-500 dark:border-surface-700 dark:bg-surface-800 dark:text-white"
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
              className="rounded-md p-1 text-surface-500 hover:bg-surface-200 dark:hover:bg-surface-800"
              title="Abbrechen"
            >
              <X size={16} />
            </button>
          </div>
        )}
        {/* Nextcloud throttled banner — credentials are saved but Nextcloud is rate-limiting */}
        {tab === 'nextcloud' && !ncProbing && ncProbeStatus?.throttled && (
          <div className="m-4 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950/40">
            <div className="flex items-center gap-2 mb-2">
              <Cloud size={18} className="text-amber-600 dark:text-amber-400" />
              <h4 className="text-sm font-semibold text-amber-800 dark:text-amber-200">Nextcloud drosselt aktuell die Verbindung</h4>
            </div>
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Deine Anmeldedaten sind gespeichert, aber Nextcloud lehnt Anfragen vorübergehend ab (HTTP 429 — Brute-Force-Schutz).
              Bitte einige Minuten warten und dann erneut versuchen. Wenn das Problem länger andauert, bitte einem Admin Bescheid geben.
            </p>
          </div>
        )}
        {/* Nextcloud setup panel — shown when credentials are missing or probe failed */}
        {tab === 'nextcloud' && !ncProbeStatus?.throttled && (ncProbing || ncProbeStatus?.needsAppPassword || (ncProbeStatus && !ncProbeStatus.configured)) && (
          <div className="m-4 rounded-xl border border-teal-200 bg-teal-50 p-4 dark:border-teal-800 dark:bg-teal-950/40">
            {ncProbing ? (
              <div className="flex items-center gap-2 text-teal-600 dark:text-teal-400">
                <Loader2 size={16} className="animate-spin" />
                <span className="text-sm">Nextcloud-Verbindung wird geprüft…</span>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 mb-3">
                  <Cloud size={18} className="text-teal-600 dark:text-teal-400" />
                  <h4 className="text-sm font-semibold text-teal-800 dark:text-teal-200">Nextcloud-Zugang einrichten</h4>
                </div>
                <p className="text-xs text-teal-700 dark:text-teal-300 mb-2">
                  Dein Nextcloud-Server nutzt ADFS-Anmeldung. Erstelle ein App-Passwort und trage es hier ein.
                </p>
                <details className="mb-3 text-xs text-teal-700 dark:text-teal-300">
                  <summary className="cursor-pointer font-medium hover:text-teal-900 dark:hover:text-teal-100 select-none">
                    Wie erstelle ich ein App-Passwort?
                  </summary>
                  <ol className="mt-2 ml-5 list-decimal space-y-1">
                    <li>Wechsle in der BBZ Cloud in den <strong>"Nextcloud"</strong>-Tab.</li>
                    <li>Klicke rechts oben auf dein <strong>Profilbild</strong>.</li>
                    <li>Wähle <strong>"Persönliche Einstellungen"</strong>.</li>
                    <li>Klicke in der Seitenleiste auf <strong>"Sicherheit"</strong>.</li>
                    <li>Scrolle ganz nach unten zu <strong>"Geräte & Sitzungen"</strong>.</li>
                    <li>Gib bei <strong>App-Name</strong> z. B. <em>"BBZ Chat"</em> ein.</li>
                    <li>Klicke auf <strong>"Neues App-Passwort erstellen"</strong>.</li>
                    <li>Das <strong>Login-Kürzel</strong> und das <strong>App-Passwort</strong> werden angezeigt. Das Passwort bitte gut sichern – es kann <strong>nicht wieder angezeigt</strong> werden!</li>
                    <li>Trage das Login-Kürzel und das Passwort unten ein und klicke auf <strong>"Speichern & verbinden"</strong>.</li>
                  </ol>
                </details>
                <div className="space-y-2">
                  <input
                    type="text"
                    value={ncUsernameInput}
                    onChange={(e) => setNcUsernameInput(e.target.value)}
                    placeholder="Lehrerkürzel (z. B. MuelM)"
                    className="w-full rounded-lg border border-teal-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-teal-500 dark:border-teal-700 dark:bg-surface-800 dark:text-surface-100"
                  />
                  <input
                    type="password"
                    value={ncAppPwInput}
                    onChange={(e) => setNcAppPwInput(e.target.value)}
                    placeholder="App-Passwort"
                    className="w-full rounded-lg border border-teal-300 bg-white px-3 py-1.5 text-sm outline-none focus:border-teal-500 dark:border-teal-700 dark:bg-surface-800 dark:text-surface-100"
                  />
                  <button
                    onClick={async () => {
                      if (!ncAppPwInput.trim() || !ncUsernameInput.trim()) return;
                      setNcSaving(true);
                      try {
                        api.ncSetCredentials(ncAppPwInput.trim(), ncUsernameInput.trim());
                        setNcAppPwInput('');
                        setNcUsernameInput('');
                        setNcProbing(true);
                        const status = await api.ncProbeAndDetect();
                        setNcProbeStatus(status);
                        if (!status.needsAppPassword && status.configured && !status.throttled) await loadFolder();
                      } catch {
                        setNcProbeStatus({ configured: false, needsAppPassword: true });
                      } finally {
                        setNcSaving(false);
                        setNcProbing(false);
                      }
                    }}
                    disabled={!ncAppPwInput.trim() || !ncUsernameInput.trim() || ncSaving}
                    className="w-full rounded-lg bg-teal-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-50 dark:bg-teal-700 dark:hover:bg-teal-600"
                  >
                    {ncSaving ? 'Wird gespeichert…' : 'Speichern & verbinden'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {loading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 size={24} className="animate-spin text-primary-400" />
          </div>
        ) : folders.length === 0 && files.length === 0 && !(tab === 'nextcloud' && (ncProbing || ncProbeStatus?.needsAppPassword || (ncProbeStatus && !ncProbeStatus.configured))) ? (
          <div className="flex h-32 flex-col items-center justify-center gap-2 text-surface-500">
            <Folder size={36} className="opacity-30" />
            <p className="text-sm">Keine Dateien vorhanden</p>
          </div>
        ) : !loading && (folders.length > 0 || files.length > 0) && viewMode === 'grid' ? (
          <GridView {...viewProps} />
        ) : !loading && (folders.length > 0 || files.length > 0) ? (
          <ListView {...viewProps} />
        ) : null}
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
              <a href={tab === 'nextcloud' ? api.ncDownloadUrl(pdfView.fileId) : api.fileDownloadUrl(pdfView.fileId, pdfView.name)} download={pdfView.name} className="rounded-md p-1.5 text-surface-400 hover:bg-surface-700" title="Herunterladen">
                <ExternalLink size={16} />
              </a>
              <button onClick={() => setPdfView(null)} className="rounded-md p-1.5 text-surface-400 hover:bg-surface-700"><X size={16} /></button>
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

      {/* Quota footer */}
      {personalQuota && tab !== 'nextcloud' && (
        <div className="shrink-0 border-t border-surface-200 px-4 py-3 space-y-2.5 dark:border-surface-700">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wider">
            <HardDrive size={12} />
            Speicherplatz
          </div>
          <QuotaBar
            label="Persönlich"
            quota={personalQuota}
          />
        </div>
      )}

      {/* Nextcloud quota footer */}
      {tab === 'nextcloud' && ncProbeStatus?.configured && !ncProbeStatus.needsAppPassword && (
        <NCQuotaBar />
      )}

      {/* Share to chat modal */}
      {shareFile && (
        <ShareToChatModal file={shareFile} onClose={() => setShareFile(null)} />
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
              className="mb-2 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-200 dark:hover:bg-surface-800"
            >
              <Home size={14} className="text-surface-500" />
              <span className="text-surface-700 dark:text-surface-400">Aktueller Ordner</span>
            </button>

            {/* Parent folder (go back one level) */}
            {crumbs.length > 1 && (
              <button
                onClick={() => { navigateTo(crumbs.length - 2); setMoveModalOpen(false); }}
                className="mb-2 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-200 dark:hover:bg-surface-800"
              >
                <ArrowUp size={14} className="text-surface-500" />
                <span className="text-surface-700 dark:text-surface-400">Eine Ebene zurück</span>
              </button>
            )}

            {/* Subfolders as destinations */}
            <div className="max-h-60 overflow-y-auto space-y-1">
              {sortedFolders.filter(f => !selectedIds.has(f.id)).map(f => (
                <button
                  key={f.id}
                  onClick={() => handleMoveSelected(f.id)}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-200 dark:hover:bg-surface-800"
                >
                  <Folder size={14} className="text-amber-400 shrink-0" />
                  <span className="truncate text-surface-700 dark:text-surface-400">{f.name}</span>
                </button>
              ))}
              {sortedFolders.filter(f => !selectedIds.has(f.id)).length === 0 && (
                <p className="py-2 text-xs text-surface-500 text-center">Keine Unterordner</p>
              )}
            </div>

            <div className="mt-3 flex justify-end">
              <button
                onClick={() => setMoveModalOpen(false)}
                className="rounded-md px-3 py-1.5 text-xs font-medium text-surface-500 hover:bg-surface-200 dark:hover:bg-surface-800"
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
