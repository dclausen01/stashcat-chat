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
              className="rounded-md p-1 text-surface-500 hover:bg-surface-200 dark:hover:bg-surface-700"
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
          <div className="mt-1 flex justify-between text-xs text-surface-500 dark:text-surface-500">
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
                <div key={i} className="text-xs text-surface-600 dark:text-surface-500">
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
