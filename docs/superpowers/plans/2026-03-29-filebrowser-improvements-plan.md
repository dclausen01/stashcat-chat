# Dateibrowser-Verbesserungen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drei Verbesserungen am Dateibrowser: Sortierung, Persistenz der Einstellungen, Ordner-Upload mit Progress-Bar.

**Architecture:** Extrahierte Hooks & Komponenten. Neue `useFileSorting` Hook, `FolderUploadProgress` Komponente, `createFolder()` API-Erweiterung.

**Tech Stack:** React 19, TypeScript 5.9, Lucide Icons, localStorage für Persistenz

---

## File Structure

| Datei | Verantwortung |
|-------|---------------|
| `stashcat-api/src/files/files.ts` | createFolder() API-Methode |
| `stashcat-api/src/files/types.ts` | FolderEntry Type (bestehend) |
| `server/index.ts` | /api/files/folder/create Endpoint |
| `src/api.ts` | createFolder() Frontend-Wrapper |
| `src/context/SettingsContext.tsx` | fileBrowserViewMode, fileBrowserTab Settings |
| `src/hooks/useFileSorting.ts` | Sortierlogik (neu) |
| `src/components/FileBrowserPanel.tsx` | Integration aller Features |
| `src/components/FolderUploadProgress.tsx` | Progress-Anzeige (neu) |

---

## Task 1: createFolder API in stashcat-api

**Files:**
- Modify: `stashcat-api/src/files/files.ts`
- Modify: `stashcat-api/src/files/types.ts`

- [ ] **Step 1: Add createFolder method to FileManager**

In `stashcat-api/src/files/files.ts`, add after the `copyFile` method (around line 146):

```typescript
/** Create a new folder */
async createFolder(name: string, parentId: string, type: string, typeId: string): Promise<FolderEntry> {
  const data = this.api.createAuthenticatedRequestData({
    folder_name: name,
    parent_id: parentId,
    type,
    type_id: typeId,
  });
  try {
    const response = await this.api.post<{ payload: { folder: FolderEntry } }>('/folder/create', data);
    return response.payload.folder;
  } catch (error) {
    throw new Error(`Failed to create folder: ${error instanceof Error ? error.message : error}`);
  }
}
```

- [ ] **Step 2: Build stashcat-api**

Run: `cd /home/dennis/Projekte/stashcat-api && npm run build`
Expected: Build completed without errors

- [ ] **Step 3: Commit**

```bash
git add ../stashcat-api/src/files/files.ts
git commit -m "feat(api): add createFolder method to FileManager"
```

---

## Task 2: Server Endpoint für createFolder

**Files:**
- Modify: `server/index.ts`

- [ ] **Step 1: Add createFolder endpoint**

In `server/index.ts`, add after the moveFile endpoint (around line 770):

```typescript
// ── Create folder ─────────────────────────────────────────────────────────────
app.post('/api/files/folder/create', async (req, res) => {
  try {
    const client = await getClient(req);
    const { folder_name, parent_id, type, type_id } = req.body as {
      folder_name: string;
      parent_id: string;
      type: string;
      type_id: string;
    };
    const folder = await client.createFolder(folder_name, parent_id, type, type_id);
    res.json(folder);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to create folder' });
  }
});
```

- [ ] **Step 2: Verify server builds**

Run: `cd /home/dennis/Projekte/stashcat-chat && npm run build`
Expected: Build completed without errors

- [ ] **Step 3: Commit**

```bash
git add server/index.ts
git commit -m "feat(server): add /api/files/folder/create endpoint"
```

---

## Task 3: Frontend API Wrapper für createFolder

**Files:**
- Modify: `src/api.ts`

- [ ] **Step 1: Add createFolder function**

In `src/api.ts`, add after `moveFile` (around line 215):

```typescript
export async function createFolder(name: string, parentId: string, type: string, typeId: string): Promise<Record<string, unknown>> {
  return post('/files/folder/create', { folder_name: name, parent_id: parentId, type, type_id: typeId });
}
```

- [ ] **Step 2: Build and verify**

Run: `npm run build`
Expected: Build completed without errors

- [ ] **Step 3: Commit**

```bash
git add src/api.ts
git commit -m "feat(api): add createFolder frontend wrapper"
```

---

## Task 4: SettingsContext erweitern

**Files:**
- Modify: `src/context/SettingsContext.tsx`

- [ ] **Step 1: Add new settings fields**

In `src/context/SettingsContext.tsx`, update the Settings interface (line 4-9):

```typescript
interface Settings {
  showImagesInline: boolean;
  bubbleView: boolean;
  ownBubbleColor: string;
  otherBubbleColor: string;
  homeView: 'info' | 'cards';
  fileBrowserViewMode: 'grid' | 'list';
  fileBrowserTab: 'context' | 'personal';
}
```

- [ ] **Step 2: Add setters to context value**

Update the SettingsContextValue interface (line 11-17):

```typescript
interface SettingsContextValue extends Settings {
  setShowImagesInline: (v: boolean) => void;
  setBubbleView: (v: boolean) => void;
  setOwnBubbleColor: (v: string) => void;
  setOtherBubbleColor: (v: string) => void;
  setHomeView: (v: 'info' | 'cards') => void;
  setFileBrowserViewMode: (v: 'grid' | 'list') => void;
  setFileBrowserTab: (v: 'context' | 'personal') => void;
}
```

- [ ] **Step 3: Update loadSettings defaults**

Update the loadSettings function (line 21-27):

```typescript
function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return {
      showImagesInline: true,
      bubbleView: true,
      ownBubbleColor: '#4f46e5',
      otherBubbleColor: '#f3f4f6',
      homeView: 'info',
      fileBrowserViewMode: 'grid',
      fileBrowserTab: 'context',
      ...JSON.parse(raw) as Partial<Settings>
    };
  } catch { /* ignore */ }
  return {
    showImagesInline: true,
    bubbleView: true,
    ownBubbleColor: '#4f46e5',
    otherBubbleColor: '#f3f4f6',
    homeView: 'info',
    fileBrowserViewMode: 'grid',
    fileBrowserTab: 'context',
  };
}
```

- [ ] **Step 4: Update default context value**

Update the default context value (line 29-40):

```typescript
const SettingsContext = createContext<SettingsContextValue>({
  showImagesInline: true,
  bubbleView: true,
  ownBubbleColor: '#4f46e5',
  otherBubbleColor: '#f3f4f6',
  homeView: 'info',
  fileBrowserViewMode: 'grid',
  fileBrowserTab: 'context',
  setShowImagesInline: () => {},
  setBubbleView: () => {},
  setOwnBubbleColor: () => {},
  setOtherBubbleColor: () => {},
  setHomeView: () => {},
  setFileBrowserViewMode: () => {},
  setFileBrowserTab: () => {},
});
```

- [ ] **Step 5: Add setters in provider**

Update the provider return (line 54-61):

```typescript
return (
  <SettingsContext.Provider value={{
    ...settings,
    setShowImagesInline: (v) => update({ showImagesInline: v }),
    setBubbleView: (v) => update({ bubbleView: v }),
    setOwnBubbleColor: (v) => update({ ownBubbleColor: v }),
    setOtherBubbleColor: (v) => update({ otherBubbleColor: v }),
    setHomeView: (v) => update({ homeView: v }),
    setFileBrowserViewMode: (v) => update({ fileBrowserViewMode: v }),
    setFileBrowserTab: (v) => update({ fileBrowserTab: v }),
  }}>
    {children}
  </SettingsContext.Provider>
);
```

- [ ] **Step 6: Build and verify**

Run: `npm run build`
Expected: Build completed without errors

- [ ] **Step 7: Commit**

```bash
git add src/context/SettingsContext.tsx
git commit -m "feat(settings): add fileBrowserViewMode and fileBrowserTab settings"
```

---

## Task 5: useFileSorting Hook erstellen

**Files:**
- Create: `src/hooks/useFileSorting.ts`

- [ ] **Step 1: Create the hook file**

Create `src/hooks/useFileSorting.ts`:

```typescript
import { useState, useMemo } from 'react';

export type SortField = 'name' | 'date' | 'size';
export type SortDirection = 'asc' | 'desc' | null;

interface FolderEntry {
  id: string;
  name: string;
  created?: string;
  size_byte?: number;
}

interface FileEntry {
  id: string;
  name: string;
  uploaded?: string;
  size_byte?: string;
}

export interface UseFileSortingResult {
  sortField: SortField;
  sortDirection: SortDirection;
  setSort: (field: SortField) => void;
  sortedFolders: FolderEntry[];
  sortedFiles: FileEntry[];
}

export function useFileSorting<F extends FolderEntry, T extends FileEntry>(
  folders: F[],
  files: T[]
): UseFileSortingResult {
  const [sortField, setSortField] = useState<SortField>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);

  const setSort = (field: SortField) => {
    if (sortField !== field) {
      setSortField(field);
      setSortDirection('asc');
    } else if (sortDirection === null) {
      setSortDirection('asc');
    } else if (sortDirection === 'asc') {
      setSortDirection('desc');
    } else {
      setSortDirection(null);
    }
  };

  const sortedFolders = useMemo(() => {
    if (!sortDirection) return folders;
    const sorted = [...folders].sort((a, b) => {
      switch (sortField) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'date':
          return (Number(a.created) || 0) - (Number(b.created) || 0);
        case 'size':
          return (a.size_byte || 0) - (b.size_byte || 0);
        default:
          return 0;
      }
    });
    return sortDirection === 'desc' ? sorted.reverse() : sorted;
  }, [folders, sortField, sortDirection]);

  const sortedFiles = useMemo(() => {
    if (!sortDirection) return files;
    const sorted = [...files].sort((a, b) => {
      switch (sortField) {
        case 'name':
          return a.name.localeCompare(b.name);
        case 'date':
          return (Number(a.uploaded) || 0) - (Number(b.uploaded) || 0);
        case 'size':
          return (Number(a.size_byte) || 0) - (Number(b.size_byte) || 0);
        default:
          return 0;
      }
    });
    return sortDirection === 'desc' ? sorted.reverse() : sorted;
  }, [files, sortField, sortDirection]);

  return { sortField, sortDirection, setSort, sortedFolders, sortedFiles };
}
```

- [ ] **Step 2: Build and verify**

Run: `npm run build`
Expected: Build completed without errors

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useFileSorting.ts
git commit -m "feat(hooks): add useFileSorting hook for file browser sorting"
```

---

## Task 6: FolderUploadProgress Komponente erstellen

**Files:**
- Create: `src/components/FolderUploadProgress.tsx`

- [ ] **Step 1: Create the component file**

Create `src/components/FolderUploadProgress.tsx`:

```typescript
import { X, Check, AlertCircle, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';

export interface UploadError {
  file: string;
  error: string;
}

export interface FolderUploadProgressData {
  totalFiles: number;
  uploadedFiles: number;
  currentFile: string;
  status: 'uploading' | 'complete' | 'error';
  errors: UploadError[];
}

interface FolderUploadProgressProps {
  progress: FolderUploadProgressData;
  onClose: () => void;
}

export function FolderUploadProgress({ progress, onClose }: FolderUploadProgressProps) {
  const percent = progress.totalFiles > 0
    ? Math.round((progress.uploadedFiles / progress.totalFiles) * 100)
    : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="w-96 rounded-xl bg-white p-6 shadow-2xl dark:bg-surface-800">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-surface-900 dark:text-white">
            Ordner wird hochgeladen
          </h3>
          {progress.status !== 'uploading' && (
            <button
              onClick={onClose}
              className="rounded-md p-1 text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-700"
            >
              <X size={18} />
            </button>
          )}
        </div>

        {/* Progress bar */}
        <div className="mb-3">
          <div className="h-3 w-full overflow-hidden rounded-full bg-surface-200 dark:bg-surface-700">
            <div
              className={clsx(
                'h-full rounded-full transition-all duration-300',
                progress.status === 'error' ? 'bg-red-500' : 'bg-primary-500'
              )}
              style={{ width: `${percent}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between text-xs text-surface-500 dark:text-surface-400">
            <span>{progress.uploadedFiles} / {progress.totalFiles} Dateien</span>
            <span>{percent}%</span>
          </div>
        </div>

        {/* Current file */}
        {progress.status === 'uploading' && (
          <div className="flex items-center gap-2 text-sm text-surface-600 dark:text-surface-300">
            <Loader2 size={14} className="animate-spin" />
            <span className="truncate">{progress.currentFile}</span>
          </div>
        )}

        {/* Complete status */}
        {progress.status === 'complete' && (
          <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
            <Check size={16} />
            <span>Upload abgeschlossen</span>
          </div>
        )}

        {/* Error status */}
        {progress.status === 'error' && progress.errors.length > 0 && (
          <div className="mt-3">
            <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
              <AlertCircle size={16} />
              <span>{progress.errors.length} Datei(en) fehlgeschlagen</span>
            </div>
            <div className="mt-2 max-h-32 overflow-y-auto rounded-md bg-surface-100 p-2 dark:bg-surface-900">
              {progress.errors.map((err, i) => (
                <div key={i} className="text-xs text-surface-600 dark:text-surface-400">
                  <span className="font-medium">{err.file}</span>: {err.error}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build and verify**

Run: `npm run build`
Expected: Build completed without errors

- [ ] **Step 3: Commit**

```bash
git add src/components/FolderUploadProgress.tsx
git commit -m "feat(components): add FolderUploadProgress component"
```

---

## Task 7: FileBrowserPanel - Settings Integration

**Files:**
- Modify: `src/components/FileBrowserPanel.tsx`

- [ ] **Step 1: Import useSettings and update state initialization**

At the top of `FileBrowserPanel.tsx`, add import:

```typescript
import { useSettings } from '../context/SettingsContext';
```

In the component function (around line 317), replace the local state for `tab` and `viewMode`:

```typescript
// Replace:
// const [tab, setTab] = useState<Tab>(chat ? 'context' : 'personal');
// const [viewMode, setViewMode] = useState<ViewMode>('grid');

// With:
const settings = useSettings();
const tab = settings.fileBrowserTab;
const setTab = settings.setFileBrowserTab;
const viewMode = settings.fileBrowserViewMode;
const setViewMode = settings.setFileBrowserViewMode;

// Initialize tab based on chat availability
// Use useEffect to set default tab on mount
const [tabInitialized, setTabInitialized] = useState(false);
useEffect(() => {
  if (!tabInitialized) {
    setTabInitialized(true);
    if (!chat && tab !== 'personal') {
      setTab('personal');
    }
  }
}, [chat, tab, tabInitialized, setTab]);
```

- [ ] **Step 2: Remove the unused Tab and ViewMode type definitions**

The types `Tab` and `ViewMode` are still used, keep them. But we need to ensure they match the settings types.

- [ ] **Step 3: Build and verify**

Run: `npm run build`
Expected: Build completed without errors

- [ ] **Step 4: Commit**

```bash
git add src/components/FileBrowserPanel.tsx
git commit -m "feat(filebrowser): integrate settings context for tab and viewMode persistence"
```

---

## Task 8: FileBrowserPanel - Sortierung Integration

**Files:**
- Modify: `src/components/FileBrowserPanel.tsx`

- [ ] **Step 1: Import useFileSorting and ArrowUp/ArrowDown icons**

Add to imports:

```typescript
import { ArrowUp, ArrowDown } from 'lucide-react';
import { useFileSorting, SortField, SortDirection } from '../hooks/useFileSorting';
```

- [ ] **Step 2: Use the sorting hook in the component**

In the component function, add after loading state:

```typescript
const { sortField, sortDirection, setSort, sortedFolders, sortedFiles } = useFileSorting(folders, files);
```

- [ ] **Step 3: Update ListView to use sorted data and add clickable headers**

Replace the `ListView` component call (around line 558) to pass sorting props:

First, we need to modify the ListView component interface and implementation. Let me do this step by step.

Update the ViewProps interface (around line 55):

```typescript
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
  // Sorting
  sortField?: SortField;
  sortDirection?: SortDirection;
  onSort?: (field: SortField) => void;
}
```

- [ ] **Step 4: Update ListView to show sortable column headers**

Replace the ListView function (lines 196-312):

```typescript
function ListView({ folders, files, onFolderClick, onImageClick, onPdfClick, onRename, onDelete, renamingId, renameValue, setRenameValue, commitRename, onDragFileStart, onDragFileEnd, onDropOnFolder, sortField, sortDirection, onSort }: ViewProps) {
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);

  const SortHeader = ({ field, label }: { field: SortField; label: string }) => (
    <button
      onClick={() => onSort?.(field)}
      className="flex items-center gap-1 text-xs font-medium text-surface-500 hover:text-surface-700 dark:text-surface-400 dark:hover:text-surface-200"
    >
      {label}
      {sortField === field && sortDirection && (
        sortDirection === 'asc' ? <ArrowUp size={10} /> : <ArrowDown size={10} />
      )}
    </button>
  );

  return (
    <div className="flex flex-col">
      {/* Column headers */}
      <div className="flex items-center gap-3 border-b border-surface-200 px-3 py-2 dark:border-surface-700">
        <div className="shrink-0 w-9" />
        <div className="min-w-0 flex-1">
          <SortHeader field="name" label="Name" />
        </div>
        <div className="shrink-0 w-16 text-right">
          <SortHeader field="size" label="Größe" />
        </div>
        <div className="shrink-0 w-20 text-right">
          <SortHeader field="date" label="Datum" />
        </div>
        <div className="shrink-0 w-20" /> {/* Actions placeholder */}
      </div>

      {/* Folder and file list */}
      <div className="flex flex-col divide-y divide-surface-100 dark:divide-surface-800">
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
            <span className="shrink-0 w-16 text-right text-xs text-surface-400">
              {f.size_byte ? formatSize(f.size_byte) : ''}
            </span>
            <span className="shrink-0 w-20 text-right text-xs text-surface-400">
              {formatDate(f.created)}
            </span>
            <ChevronRight size={14} className="shrink-0 w-5 text-surface-400" />
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
                className="shrink-0 w-9"
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
              </div>

              {/* Size */}
              <span className="shrink-0 w-16 text-right text-xs text-surface-400">
                {f.size_string || (f.size_byte ? formatSize(Number(f.size_byte)) : '')}
              </span>

              {/* Date */}
              <span className="shrink-0 w-20 text-right text-xs text-surface-400">
                {formatDate(f.uploaded)}
              </span>

              {/* Actions */}
              <div className="hidden shrink-0 w-20 items-center justify-end gap-0.5 group-hover:flex">
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

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
```

- [ ] **Step 5: Update viewProps to include sorting**

Update the viewProps object (around line 423):

```typescript
const viewProps: ViewProps = {
  folders: sortedFolders,
  files: sortedFiles,
  onFolderClick: navigateInto,
  onImageClick: setLightboxUrl,
  onPdfClick: (fid, vurl, name) => setPdfView({ fileId: fid, viewUrl: vurl, name }),
  onRename: startRename,
  onDelete: handleDelete,
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
```

- [ ] **Step 6: Build and verify**

Run: `npm run build`
Expected: Build completed without errors

- [ ] **Step 7: Commit**

```bash
git add src/components/FileBrowserPanel.tsx
git commit -m "feat(filebrowser): add sortable columns in list view"
```

---

## Task 9: FileBrowserPanel - Ordner-Upload

**Files:**
- Modify: `src/components/FileBrowserPanel.tsx`

- [ ] **Step 1: Import FolderUploadProgress**

Add to imports:

```typescript
import { FolderUploadProgress, FolderUploadProgressData } from './FolderUploadProgress';
```

- [ ] **Step 2: Add upload progress state**

In the component state (around line 327), add:

```typescript
const [uploadProgress, setUploadProgress] = useState<FolderUploadProgressData | null>(null);
```

- [ ] **Step 3: Add webkitdirectory attribute to file input**

Find the file input (around line 531) and add `webkitdirectory` and `directory` attributes:

```typescript
<input
  ref={fileInputRef}
  type="file"
  multiple
  webkitdirectory=""
  directory=""
  className="hidden"
  onChange={handleFolderInputChange}
/>
```

- [ ] **Step 4: Add folder upload handler**

Add the handler function before the return statement:

```typescript
const handleFolderInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
  const fileList = e.target.files;
  if (!fileList || fileList.length === 0) return;
  e.target.value = '';

  // Check if this is a folder upload (all files have relative paths with /)
  const files = Array.from(fileList);
  const hasFolderStructure = files.some(f => f.webkitRelativePath?.includes('/'));

  if (hasFolderStructure) {
    await handleFolderUpload(files);
  } else {
    // Regular multi-file upload
    for (const f of files) await handleUpload(f);
  }
};

const handleFolderUpload = async (files: File[]) => {
  // Extract folder structure from webkitRelativePath
  const folderMap = new Map<string, { files: File[]; created: boolean }>();

  // Group files by their parent folder path
  for (const file of files) {
    const path = file.webkitRelativePath;
    const parts = path.split('/');

    // Get the root folder name (first part)
    const rootFolder = parts[0];

    // Initialize root folder if not exists
    if (!folderMap.has(rootFolder)) {
      folderMap.set(rootFolder, { files: [], created: false });
    }

    // If file is in a subfolder, we need to create the subfolder path
    if (parts.length > 2) {
      // Create intermediate folders
      for (let i = 1; i < parts.length - 1; i++) {
        const subfolderPath = parts.slice(0, i + 1).join('/');
        if (!folderMap.has(subfolderPath)) {
          folderMap.set(subfolderPath, { files: [], created: false });
        }
      }
    }

    // Add file to its immediate parent folder
    if (parts.length > 1) {
      const parentPath = parts.slice(0, -1).join('/');
      const entry = folderMap.get(parentPath);
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

  // Get the type and typeId for upload
  const uploadType = tab === 'personal' ? 'personal' : chat?.type || 'personal';
  const uploadTypeId = tab === 'personal' ? undefined : chat?.id;

  try {
    // Sort folders by depth (create parent folders first)
    const sortedFolders = [...folderMap.entries()].sort((a, b) => {
      const depthA = a[0].split('/').length;
      const depthB = b[0].split('/').length;
      return depthA - depthB;
    });

    // Create folders and upload files
    const folderIdMap = new Map<string, string>();

    for (const [folderPath, entry] of sortedFolders) {
      // Determine parent folder ID
      let parentId = currentFolderId || '0';
      const parts = folderPath.split('/');

      if (parts.length > 1) {
        // This is a subfolder - find parent
        const parentPath = parts.slice(0, -1).join('/');
        const parentFolderId = folderIdMap.get(parentPath);
        if (parentFolderId) parentId = parentFolderId;
      }

      // Create folder if not root folder being created at current location
      const folderName = parts[parts.length - 1];
      try {
        const newFolder = await api.createFolder(
          folderName,
          parentId,
          uploadType,
          uploadTypeId || ''
        );
        folderIdMap.set(folderPath, String(newFolder.id));
      } catch (err) {
        // Folder might already exist - try to find it
        console.warn('Failed to create folder, might exist:', folderPath, err);
        // Continue anyway - files will be uploaded to parent
      }

      // Upload files in this folder
      const targetFolderId = folderIdMap.get(folderPath) || parentId;
      for (const file of entry.files) {
        setUploadProgress(prev => prev ? {
          ...prev,
          currentFile: file.name,
        } : null);

        try {
          if (tab === 'personal') {
            await api.uploadToStorage('personal', undefined, file, targetFolderId);
          } else if (chat) {
            await api.uploadToStorage(chat.type, chat.id, file, targetFolderId);
          }
          uploadedFiles++;
          setUploadProgress(prev => prev ? {
            ...prev,
            uploadedFiles,
          } : null);
        } catch (err) {
          errors.push({
            file: file.webkitRelativePath,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    // Final status
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
```

- [ ] **Step 5: Update the Upload button label**

Update the upload button to indicate folder upload:

```typescript
<button
  onClick={() => fileInputRef.current?.click()}
  disabled={uploading || uploadProgress !== null}
  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50 disabled:opacity-50 dark:text-primary-400 dark:hover:bg-primary-900/20"
>
  {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
  {uploading ? 'Lädt…' : 'Upload'}
</button>
```

- [ ] **Step 6: Add FolderUploadProgress component to render**

Add at the end of the component, after the PDF viewer modal:

```typescript
{/* Folder upload progress */}
{uploadProgress && (
  <FolderUploadProgress
    progress={uploadProgress}
    onClose={() => setUploadProgress(null)}
  />
)}
```

- [ ] **Step 7: Build and verify**

Run: `npm run build`
Expected: Build completed without errors

- [ ] **Step 8: Commit**

```bash
git add src/components/FileBrowserPanel.tsx
git commit -m "feat(filebrowser): add folder upload with progress bar"
```

---

## Task 10: Integration Testing

- [ ] **Step 1: Manual test - Settings persistence**

1. Open the file browser
2. Switch to "Meine Dateien" tab
3. Switch to list view
4. Refresh the page
5. Verify: tab and view mode are preserved

- [ ] **Step 2: Manual test - Sorting**

1. Open a folder with multiple files
2. Switch to list view
3. Click on "Name" header - verify alphabetical sorting
4. Click again - verify reverse alphabetical
5. Click again - verify default order
6. Repeat for "Datum" and "Größe"

- [ ] **Step 3: Manual test - Folder upload**

1. Create a test folder on your computer with:
   - Some files in the root
   - A subfolder with more files
2. Open the file browser in the app
3. Click "Upload" button
4. Select the test folder (browser will upload all files)
5. Verify: Progress bar appears
6. Verify: Folder structure is created
7. Verify: All files are uploaded
8. Verify: Folder appears in the file browser

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat(filebrowser): complete integration of sorting, settings persistence, and folder upload"
```

---

## Summary

This plan implements:
1. **API layer** - `createFolder()` in stashcat-api + server endpoint
2. **Settings persistence** - fileBrowserViewMode and fileBrowserTab in SettingsContext
3. **Sorting** - useFileSorting hook with clickable column headers
4. **Folder upload** - Progress component + recursive folder creation

Each task produces working, testable functionality.
