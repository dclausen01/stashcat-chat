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
