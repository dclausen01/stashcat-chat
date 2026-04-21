import { useState, useRef, useCallback, useEffect } from 'react';
import { X, Loader2, Upload, ImageIcon, Trash2 } from 'lucide-react';
import { clsx } from 'clsx';
import * as api from '../api';
import type { ChatTarget } from '../types';

interface ChannelImageEditorProps {
  chat: ChatTarget;
  onClose: () => void;
  onSaved: (imageUrl: string) => void;
}

const MAX_FILE_SIZE_MB = 5;

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Remove data:*/*;base64, prefix
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function ChannelImageEditor({ chat, onClose, onSaved }: ChannelImageEditorProps) {
  const [preview, setPreview] = useState<string | null>(chat.image || null);
  const [base64Image, setBase64Image] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (file: File) => {
    setError('');
    if (!file.type.startsWith('image/')) {
      setError('Bitte wähle ein Bild aus (JPG, PNG, GIF, etc.)');
      return;
    }
    if (file.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
      setError(`Das Bild darf maximal ${MAX_FILE_SIZE_MB} MB groß sein.`);
      return;
    }
    try {
      const objectUrl = URL.createObjectURL(file);
      setPreview(objectUrl);
      const b64 = await fileToBase64(file);
      setBase64Image(b64);
    } catch {
      setError('Fehler beim Lesen der Datei.');
    }
  }, []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setDragOver(false);
  }, []);

  // Cleanup object URLs to avoid memory leaks
  useEffect(() => {
    return () => {
      if (preview && preview.startsWith('blob:')) {
        URL.revokeObjectURL(preview);
      }
    };
  }, [preview]);

  const handleRemoveImage = useCallback(() => {
    if (preview && preview.startsWith('blob:')) {
      URL.revokeObjectURL(preview);
    }
    setPreview(null);
    setBase64Image(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [preview]);

  const handleSave = async () => {
    if (!chat.company_id) {
      setError('Keine company_id vorhanden');
      return;
    }
    if (!base64Image) {
      setError('Bitte wähle ein Bild aus');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.setChannelImage(chat.id, chat.company_id, base64Image);
      // The API doesn't return the new image URL, so we construct a data URL from the preview
      // In practice the consumer should refetch channel info to get the real URL
      onSaved(preview || '');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative flex w-full max-w-md flex-col rounded-2xl bg-white shadow-2xl dark:bg-surface-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-surface-200 px-5 py-4 dark:border-surface-700">
          <ImageIcon size={18} className="text-primary-500" />
          <h2 className="flex-1 text-base font-semibold text-surface-900 dark:text-white">
            Channel-Bild ändern
          </h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-surface-500 hover:bg-surface-200 dark:hover:bg-surface-800">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 px-5 py-5">
          {/* Preview area */}
          <div className="flex flex-col items-center gap-3">
            <div className="relative">
              {preview ? (
                <img
                  src={preview}
                  alt={chat.name}
                  className="h-32 w-32 rounded-full object-cover ring-4 ring-surface-200 dark:ring-surface-700"
                />
              ) : (
                <div className="flex h-32 w-32 items-center justify-center rounded-full bg-surface-200 ring-4 ring-surface-200 dark:bg-surface-700 dark:ring-surface-700">
                  <ImageIcon size={40} className="text-surface-400" />
                </div>
              )}
              {preview && (
                <button
                  onClick={handleRemoveImage}
                  className="absolute -right-1 -top-1 flex h-8 w-8 items-center justify-center rounded-full bg-red-500 text-white shadow-lg hover:bg-red-600"
                  title="Bild entfernen"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
            <p className="text-sm text-surface-500">{chat.name}</p>
          </div>

          {/* Upload area */}
          <div
            onClick={() => fileInputRef.current?.click()}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            className={clsx(
              'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 transition',
              dragOver
                ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                : 'border-surface-300 hover:border-surface-400 dark:border-surface-600 dark:hover:border-surface-500',
            )}
          >
            <Upload size={24} className={clsx('transition', dragOver ? 'text-primary-500' : 'text-surface-400')} />
            <p className="text-sm font-medium text-surface-600 dark:text-surface-300">
              Bild hierher ziehen oder klicken
            </p>
            <p className="text-xs text-surface-400">JPG, PNG, GIF — max. {MAX_FILE_SIZE_MB} MB</p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleInputChange}
              className="hidden"
            />
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-surface-200 px-5 py-3 dark:border-surface-700">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-surface-600 transition hover:bg-surface-200 dark:text-surface-500 dark:hover:bg-surface-800"
          >
            Abbrechen
          </button>
          <button
            onClick={handleSave}
            disabled={saving || !base64Image}
            className={clsx(
              'flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium text-white transition',
              saving || !base64Image
                ? 'cursor-not-allowed bg-primary-300'
                : 'bg-primary-600 hover:bg-primary-700',
            )}
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
            Speichern
          </button>
        </div>
      </div>
    </div>
  );
}
