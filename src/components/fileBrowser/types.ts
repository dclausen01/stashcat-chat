import type { SortField, SortDirection } from '../../hooks/useFileSorting';

export interface FolderEntry {
  id: string;
  name: string;
  size_byte?: number;
  created?: string;
  modified?: string;
}

export interface FileEntry {
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

export interface Crumb { id: string | null; name: string }
export type Tab = 'context' | 'personal' | 'nextcloud';

export interface ViewProps {
  folders: FolderEntry[];
  files: FileEntry[];
  onFolderClick: (f: FolderEntry) => void;
  onFileOpen: (f: FileEntry) => void;
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
  // URL builders (allow Nextcloud paths to generate different URLs)
  buildDownloadUrl: (f: FileEntry) => string;
  buildViewUrl: (f: FileEntry) => string;
  // Share to chat (Nextcloud only)
  onShare?: (f: FileEntry) => void;
  // OnlyOffice preview (per-system)
  onOnlyOfficeClick?: (f: FileEntry) => void;
}
