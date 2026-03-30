import { useState, useRef } from 'react';
import { X, Camera, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import * as api from '../api';
import Avatar from './Avatar';

interface ProfileModalProps {
  onClose: () => void;
}

export default function ProfileModal({ onClose }: ProfileModalProps) {
  const { user, setUser } = useAuth();
  const [status, setStatus] = useState(user?.status || '');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleSaveStatus = async () => {
    if (loading) return;
    setLoading(true);
    try {
      await api.changeStatus(status);
      setUser(user ? { ...user, status } : null);
    } catch (err) {
      console.error('Failed to save status:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Check file type
    if (!file.type.startsWith('image/')) {
      alert('Bitte wähle eine Bilddatei aus.');
      return;
    }

    // Check file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      alert('Das Bild darf maximal 5 MB groß sein.');
      return;
    }

    setUploading(true);
    try {
      // Read file as base64
      const reader = new FileReader();
      reader.onload = async (event) => {
        const base64 = event.target?.result as string;
        // Remove data:image/xxx;base64, prefix
        const imgBase64 = base64.split(',')[1];
        try {
          await api.uploadProfileImage(imgBase64);
          // Update user image - add timestamp to bust cache
          const newImage = `data:${file.type};base64,${imgBase64}`;
          setUser(user ? { ...user, image: newImage } : null);
        } catch (err) {
          console.error('Failed to upload image:', err);
          alert('Fehler beim Hochladen des Bildes.');
        } finally {
          setUploading(false);
        }
      };
      reader.readAsDataURL(file);
    } catch (err) {
      console.error('Failed to read file:', err);
      setUploading(false);
    }
  };

  const handleRemoveImage = async () => {
    if (!confirm('Profilbild wirklich entfernen?')) return;
    setUploading(true);
    try {
      await api.resetProfileImage();
      setUser(user ? { ...user, image: undefined } : null);
    } catch (err) {
      console.error('Failed to remove image:', err);
      alert('Fehler beim Entfernen des Bildes.');
    } finally {
      setUploading(false);
    }
  };

  const userName = user ? `${user.first_name} ${user.last_name}` : '';
  const userEmail = user?.email || '';
  const userImage = user?.image;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl dark:bg-surface-800">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-surface-200 px-4 py-3 dark:border-surface-700">
          <h2 className="text-lg font-semibold text-surface-900 dark:text-white">Mein Profil</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-700"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Avatar with upload overlay */}
          <div className="mb-6 flex justify-center">
            <div className="relative">
              <Avatar name={userName} image={userImage} size="lg" />
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                className="absolute bottom-0 right-0 flex h-7 w-7 items-center justify-center rounded-full bg-primary-600 text-white shadow-md hover:bg-primary-700 disabled:opacity-50"
                title="Profilbild ändern"
              >
                {uploading ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={handleImageSelect}
                className="hidden"
              />
            </div>
          </div>

          {/* User info (read-only from LDAP) */}
          <div className="mb-6 space-y-3">
            <div>
              <label className="block text-xs font-medium text-surface-500">Name</label>
              <div className="mt-1 text-sm text-surface-900 dark:text-white">{userName}</div>
            </div>
            <div>
              <label className="block text-xs font-medium text-surface-500">E-Mail</label>
              <div className="mt-1 text-sm text-surface-900 dark:text-white">{userEmail}</div>
            </div>
          </div>

          {/* Status (editable) */}
          <div className="mb-6">
            <label className="block text-xs font-medium text-surface-500">Status</label>
            <div className="mt-1 flex gap-2">
              <input
                type="text"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                placeholder="z.B. Im Meeting, Arbeiten von zuhause..."
                className="flex-1 rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm text-surface-900 placeholder:text-surface-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500 dark:border-surface-600 dark:bg-surface-700 dark:text-white"
                maxLength={100}
              />
              <button
                onClick={handleSaveStatus}
                disabled={loading}
                className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
              >
                {loading ? <Loader2 size={16} className="animate-spin" /> : 'Speichern'}
              </button>
            </div>
          </div>

          {/* Remove image button */}
          {userImage && (
            <button
              onClick={handleRemoveImage}
              disabled={uploading}
              className="w-full rounded-lg border border-surface-300 py-2 text-sm text-surface-600 hover:bg-surface-50 disabled:opacity-50 dark:border-surface-600 dark:text-surface-400 dark:hover:bg-surface-700"
            >
              Profilbild entfernen
            </button>
          )}
        </div>

        {/* Footer hint */}
        <div className="rounded-b-xl border-t border-surface-200 bg-surface-50 px-4 py-3 text-center text-xs text-surface-400 dark:border-surface-700 dark:bg-surface-900">
          Name und E-Mail werden über LDAP synchronisiert.
        </div>
      </div>
    </div>
  );
}
