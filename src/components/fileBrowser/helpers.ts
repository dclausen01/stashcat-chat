import * as api from '../../api';
import type { FileEntry } from './types';

export function formatDate(ts?: string): string {
  if (!ts) return '';
  const n = Number(ts);
  if (isNaN(n) || n === 0) return '';
  return new Date(n * 1000).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

/** Extensible check: can the file be previewed inline? Add new formats here. */
export function canPreview(f: FileEntry): boolean {
  if (f.mime?.startsWith('image/')) return true;
  if (f.mime === 'application/pdf' || f.ext?.toLowerCase() === 'pdf') return true;
  // Text / code files viewable in iframe
  if (f.mime?.startsWith('text/')) return true;
  // Audio / video playable in browser
  if (f.mime?.startsWith('audio/') || f.mime?.startsWith('video/')) return true;
  // Office files viewable in OnlyOffice
  if (api.canViewInOnlyOffice(f.name)) return true;
  return false;
}
