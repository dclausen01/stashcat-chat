import { useState, useEffect, useRef } from 'react';
import { X, Presentation } from 'lucide-react';

interface Props {
  onConfirm: (title: string) => void;
  onClose: () => void;
}

export default function CreateWhiteboardModal({ onConfirm, onClose }: Props) {
  const [title, setTitle] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = () => {
    onConfirm(title.trim());
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl dark:bg-surface-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-surface-200 px-5 py-4 dark:border-surface-700">
          <div className="flex items-center gap-2">
            <Presentation size={18} className="text-purple-500" />
            <h2 className="text-base font-semibold text-surface-900 dark:text-white">
              Kollaboratives Whiteboard
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1 text-surface-500 hover:bg-surface-100 hover:text-surface-700 dark:hover:bg-surface-800"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-5">
          <label className="mb-1.5 block text-sm font-medium text-surface-700 dark:text-surface-300">
            Titel <span className="font-normal text-surface-400">(optional)</span>
          </label>
          <input
            ref={inputRef}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit(); if (e.key === 'Escape') onClose(); }}
            placeholder="z. B. Brainstorming Sprint 3"
            maxLength={120}
            className="w-full rounded-xl border border-surface-200 bg-surface-50 px-3 py-2.5 text-sm text-surface-900 outline-none transition placeholder:text-surface-400 focus:border-purple-400 focus:ring-2 focus:ring-purple-400/20 dark:border-surface-600 dark:bg-surface-800 dark:text-white"
          />
          <p className="mt-2 text-xs text-surface-400">
            Ein neues Excalidraw-Whiteboard wird erstellt und der Link im Chat geteilt.
          </p>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 border-t border-surface-200 px-5 py-4 dark:border-surface-700">
          <button
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm text-surface-600 hover:bg-surface-100 dark:text-surface-400 dark:hover:bg-surface-800"
          >
            Abbrechen
          </button>
          <button
            onClick={handleSubmit}
            className="rounded-xl bg-purple-500 px-4 py-2 text-sm font-medium text-white hover:bg-purple-600"
          >
            Whiteboard erstellen
          </button>
        </div>
      </div>
    </div>
  );
}
