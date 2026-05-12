import { memo } from 'react';
import { FileText, Eye } from 'lucide-react';
import { clsx } from 'clsx';
import * as api from '../../api';
import { fileIcon } from '../../utils/fileIcon';
import type { Message } from '../../types';
import { VoiceMessagePlayer } from './VoiceMessagePlayer';

function FileListImpl({
  files,
  isOwn,
  showImagesInline,
  onImageClick,
  onPdfClick,
}: {
  files?: Message['files'];
  isOwn: boolean;
  showImagesInline: boolean;
  onImageClick?: (url: string) => void;
  onPdfClick?: (fileId: string, viewUrl: string, name: string) => void;
}) {
  if (!files || files.length === 0) return null;

  return (
    <div className="mt-1.5 flex flex-col gap-1.5">
      {files.map((f) => {
        const isImage = f.mime?.startsWith('image/');
        const isPdf = f.mime === 'application/pdf' || f.ext?.toLowerCase() === 'pdf';
        const downloadUrl = api.fileDownloadUrl(f.id, f.name);
        const viewUrl = api.fileViewUrl(f.id, f.name);

        const isVoiceMessage =
          f.name.startsWith('VoiceMessage') &&
          (f.mime?.startsWith('audio/') ||
            ['m4a', 'webm', 'ogg', 'mp3', 'wav', 'aac', 'opus'].includes((f.ext ?? '').toLowerCase()));

        return (
          <div key={f.id}>
            {isVoiceMessage && (
              <VoiceMessagePlayer file={f} isOwn={isOwn} />
            )}
            {!isVoiceMessage && isImage && showImagesInline && (
              <button
                className="mb-1 block cursor-zoom-in"
                onClick={() => onImageClick?.(downloadUrl)}
                title="Vergrößern"
              >
                <img
                  src={downloadUrl}
                  alt={f.name}
                  className="max-h-60 max-w-xs rounded-lg object-contain transition hover:opacity-90"
                  loading="lazy"
                />
              </button>
            )}
            {!isVoiceMessage && (
              <div className="flex flex-wrap items-center gap-1.5">
                <a
                  href={downloadUrl}
                  download={f.name}
                  title={`${f.name} herunterladen`}
                  className={clsx(
                    'inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition',
                    isOwn
                      ? 'bg-primary-700 text-primary-100 hover:bg-primary-800'
                      : 'bg-surface-200 text-surface-600 hover:bg-surface-300 dark:bg-surface-700 dark:text-surface-400 dark:hover:bg-surface-600',
                  )}
                >
                  <span>{fileIcon(f.mime, f.ext)}</span>
                  <span className="max-w-[120px] truncate sm:max-w-[160px]">{f.name}</span>
                  {f.size_string && <span className="hidden opacity-60 sm:inline">({f.size_string})</span>}
                </a>
                {isPdf && onPdfClick && (
                  <button
                    onClick={() => onPdfClick(f.id, viewUrl, f.name)}
                    title="PDF-Vorschau"
                    className={clsx(
                      'inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium transition',
                      isOwn
                        ? 'bg-primary-700 text-primary-100 hover:bg-primary-800'
                        : 'bg-surface-200 text-surface-600 hover:bg-surface-300 dark:bg-surface-700 dark:text-surface-400 dark:hover:bg-surface-600',
                    )}
                  >
                    <FileText size={12} /> <span className="hidden sm:inline">Vorschau</span>
                  </button>
                )}
                {api.canViewInOnlyOffice(f.name) && (
                  <button
                    onClick={() => api.openInOnlyOffice(f.id, f.name)}
                    title="In OnlyOffice ansehen"
                    className={clsx(
                      'inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium transition',
                      isOwn
                        ? 'bg-primary-700 text-primary-100 hover:bg-primary-800'
                        : 'bg-surface-200 text-surface-600 hover:bg-surface-300 dark:bg-surface-700 dark:text-surface-400 dark:hover:bg-surface-600',
                    )}
                  >
                    <Eye size={12} /> <span className="hidden sm:inline">Ansehen</span>
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export const FileList = memo(FileListImpl);
