import { useState, useRef, useCallback, useEffect } from 'react';
import { X, Hash, Lock, KeyRound, Loader2, ChevronDown, Upload, ImageIcon, Trash2 } from 'lucide-react';
import { FocusTrap } from 'focus-trap-react';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { clsx } from 'clsx';
import * as api from '../api';
import type { Channel } from '../types';

interface NewChannelModalProps {
  companyId: string;
  onClose: () => void;
  onCreate: (channel: Channel) => void;
}

type ChannelType = 'public' | 'encrypted' | 'password';

const CHANNEL_TYPES: { value: ChannelType; label: string; desc: string; icon: React.ReactNode }[] = [
  {
    value: 'public',
    label: 'Öffentlich',
    desc: 'Jeder kann den Channel finden und beitreten.',
    icon: <Hash size={15} />,
  },
  {
    value: 'encrypted',
    label: 'Verschlüsselt',
    desc: 'Verschlüsselter Channel: Beitritt durch Einladung oder Beitrittsanfrage.',
    icon: <Lock size={15} />,
  },
  {
    value: 'password',
    label: 'Kennwortgeschützt',
    desc: 'Mitglieder benötigen ein Kennwort zum Beitreten.',
    icon: <KeyRound size={15} />,
  },
];

interface Toggle {
  key: string;
  label: string;
  desc: string;
  default: boolean;
}

const TOGGLES: Toggle[] = [
  { key: 'hidden',                     label: 'Versteckt',                   desc: 'Der Channel erscheint nicht in der Suche.',              default: false },
  { key: 'invite_only',                label: 'Einladerechte',               desc: 'Nur Manager dürfen andere Nutzer einladen.',              default: false },
  { key: 'read_only',                  label: 'Read-Only',                   desc: 'Nur Manager dürfen im Channel schreiben.',               default: false },
  { key: 'show_activities',            label: 'Ereignisinformationen',       desc: 'Anzeige von Ereignisinformationen im Chat.',             default: true  },
  { key: 'show_membership_activities', label: 'Ein-/Austrittsmeldungen',     desc: 'Anzeige von Ein- und Austrittsmeldungen im Chat.',       default: true  },
];

function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none',
        checked ? 'bg-primary-600' : 'bg-surface-300 dark:bg-surface-600',
      )}
    >
      <span
        className={clsx(
          'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-4' : 'translate-x-0',
        )}
      />
    </button>
  );
}

export default function NewChannelModal({ companyId, onClose, onCreate }: NewChannelModalProps) {
  useEscapeKey(onClose);
  const [name, setName]             = useState('');
  const [description, setDescription] = useState('');
  const [policies, setPolicies]     = useState('');
  const [channelType, setChannelType] = useState<ChannelType>('encrypted');
  const [typeOpen, setTypeOpen]     = useState(false);
  const [password, setPassword]     = useState('');
  const [password2, setPassword2]   = useState('');
  const [toggles, setToggles]       = useState<Record<string, boolean>>(
    Object.fromEntries(TOGGLES.map((t) => [t.key, t.default])),
  );
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageBase64, setImageBase64] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const setToggle = (key: string, val: boolean) =>
    setToggles((prev) => ({ ...prev, [key]: val }));

  const fileToBase64 = useCallback((file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }, []);

  const handleFile = useCallback(async (file: File) => {
    setError('');
    if (!file.type.startsWith('image/')) { setError('Bitte ein Bild auswählen.'); return; }
    if (file.size > 5 * 1024 * 1024) { setError('Max. 5 MB.'); return; }
    try {
      setImagePreview(URL.createObjectURL(file));
      setImageBase64(await fileToBase64(file));
    } catch { setError('Fehler beim Lesen der Datei.'); }
  }, [fileToBase64]);

  const removeImage = useCallback(() => {
    if (imagePreview?.startsWith('blob:')) URL.revokeObjectURL(imagePreview);
    setImagePreview(null);
    setImageBase64(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [imagePreview]);

  const selectedType = CHANNEL_TYPES.find((t) => t.value === channelType)!;

  useEffect(() => {
    return () => { if (imagePreview?.startsWith('blob:')) URL.revokeObjectURL(imagePreview); };
  }, [imagePreview]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('Name ist erforderlich'); return; }
    if (channelType === 'password' && !password) { setError('Bitte Kennwort eingeben'); return; }
    if (channelType === 'password' && password !== password2) { setError('Kennwörter stimmen nicht überein'); return; }

    setSaving(true);
    setError('');
    try {
      let channel = await api.createChannel({
        name: name.trim(),
        company_id: companyId,
        description: description.trim() || undefined,
        policies: policies.trim() || undefined,
        channel_type: channelType,
        hidden: toggles.hidden,
        invite_only: toggles.invite_only,
        read_only: toggles.read_only,
        show_activities: toggles.show_activities,
        show_membership_activities: toggles.show_membership_activities,
        ...(channelType === 'password' ? { password, password_repeat: password2 } : {}),
      });
      if (imageBase64) {
        try {
          const imgResult = await api.setChannelImage(channel.id, companyId, imageBase64);
          if (imgResult?.channel?.image) {
            channel = { ...channel, image: imgResult.channel.image };
          }
        } catch (imgErr) {
          console.error('Channel image upload failed:', imgErr);
        }
      }
      onCreate(channel);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Erstellen');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <FocusTrap focusTrapOptions={{ escapeDeactivates: false, allowOutsideClick: true }}>
      <div
        className="flex w-full max-w-lg flex-col rounded-2xl bg-white shadow-2xl dark:bg-surface-900"
        style={{ maxHeight: '90vh' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex shrink-0 items-center gap-3 border-b border-surface-200 px-5 py-4 dark:border-surface-700">
          <Hash size={18} className="text-primary-500" />
          <h2 className="flex-1 text-base font-semibold text-surface-900 dark:text-white">Neuer Channel</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-surface-600 hover:bg-surface-200 dark:hover:bg-surface-800"
          >
            <X size={18} />
          </button>
        </div>

        {/* Scrollable body */}
        <form onSubmit={handleSubmit} className="flex flex-1 flex-col overflow-hidden">
          <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">

            {/* Name */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-surface-600">
                Channel-Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="z. B. lehrerkonferenz"
                autoFocus
                className="w-full rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm text-surface-900 outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 dark:border-surface-600 dark:bg-surface-800 dark:text-white"
              />
            </div>

            {/* Channel image */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-surface-600">
                Channel-Bild <span className="text-surface-600 font-normal normal-case">(optional)</span>
              </label>
              <div className="flex items-center gap-3">
                {imagePreview ? (
                  <div className="relative">
                    <img src={imagePreview} alt="Vorschau" className="h-14 w-14 rounded-full object-cover ring-2 ring-surface-200 dark:ring-surface-700" />
                    <button
                      type="button"
                      onClick={removeImage}
                      className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600"
                      title="Entfernen"
                    >
                      <Trash2 size={10} />
                    </button>
                  </div>
                ) : (
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-surface-200 dark:bg-surface-700">
                    <ImageIcon size={20} className="text-surface-400" />
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1.5 rounded-lg border border-surface-300 px-3 py-2 text-sm font-medium text-surface-600 transition hover:bg-surface-100 dark:border-surface-600 dark:text-surface-300 dark:hover:bg-surface-800"
                >
                  <Upload size={14} />
                  Bild hochladen
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                  className="hidden"
                />
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-surface-600">
                Beschreibung <span className="text-surface-600 font-normal normal-case">(optional)</span>
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Kurze Beschreibung des Channels…"
                className="w-full rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm text-surface-900 outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 dark:border-surface-600 dark:bg-surface-800 dark:text-white"
              />
            </div>

            {/* Policies */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-surface-600">
                Channel-Richtlinien <span className="text-surface-600 font-normal normal-case">(optional)</span>
              </label>
              <textarea
                value={policies}
                onChange={(e) => setPolicies(e.target.value)}
                rows={3}
                placeholder="Channel-Richtlinien"
                className="w-full resize-y rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm text-surface-900 outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 dark:border-surface-600 dark:bg-surface-800 dark:text-white"
              />
              <p className="mt-1 text-xs text-surface-600">
                Falls gesetzt, müssen neue Mitglieder diese Richtlinien beim Beitritt akzeptieren.
              </p>
            </div>

            {/* Channel type dropdown */}
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-surface-600">
                Channeltyp <span className="text-red-400">*</span>
              </label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setTypeOpen((o) => !o)}
                  className="flex w-full items-center gap-2 rounded-lg border border-surface-300 bg-white px-3 py-2.5 text-left text-sm transition hover:border-surface-400 dark:border-surface-600 dark:bg-surface-800 dark:text-white"
                >
                  <span className="text-surface-600 dark:text-surface-400">{selectedType.icon}</span>
                  <span className="flex-1 font-medium text-surface-900 dark:text-white">{selectedType.label}</span>
                  <ChevronDown size={15} className={clsx('shrink-0 text-surface-600 transition', typeOpen && 'rotate-180')} />
                </button>
                {typeOpen && (
                  <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-surface-200 bg-white shadow-xl dark:border-surface-600 dark:bg-surface-800">
                    {CHANNEL_TYPES.map((ct) => (
                      <button
                        key={ct.value}
                        type="button"
                        onClick={() => { setChannelType(ct.value); setTypeOpen(false); }}
                        className={clsx(
                          'flex w-full items-start gap-3 px-4 py-3 text-left text-sm transition hover:bg-surface-50 dark:hover:bg-surface-700',
                          ct.value === channelType && 'bg-primary-50 dark:bg-primary-900/20',
                        )}
                      >
                        <span className={clsx('mt-0.5 shrink-0', ct.value === channelType ? 'text-primary-600 dark:text-primary-400' : 'text-surface-600')}>
                          {ct.icon}
                        </span>
                        <div>
                          <div className={clsx('font-semibold', ct.value === channelType ? 'text-primary-700 dark:text-primary-300' : 'text-surface-900 dark:text-surface-100')}>
                            {ct.label}
                          </div>
                          <div className="text-xs text-surface-600">{ct.desc}</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <p className="mt-1 text-xs text-surface-600">{selectedType.desc}</p>
            </div>

            {/* Password fields (only when password type) */}
            {channelType === 'password' && (
              <div className="space-y-2 rounded-xl bg-surface-50 p-3 dark:bg-surface-800">
                <div>
                  <label className="mb-1 block text-xs font-medium text-surface-600 dark:text-surface-400">Kennwort</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Kennwort"
                    className="w-full rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-primary-500 dark:border-surface-600 dark:bg-surface-700 dark:text-white"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-surface-600 dark:text-surface-400">Kennwort wiederholen</label>
                  <input
                    type="password"
                    value={password2}
                    onChange={(e) => setPassword2(e.target.value)}
                    placeholder="Kennwort bestätigen"
                    className="w-full rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm outline-none transition focus:border-primary-500 dark:border-surface-600 dark:bg-surface-700 dark:text-white"
                  />
                </div>
              </div>
            )}

            {/* Settings toggles */}
            <div>
              <p className="mb-2 text-sm font-semibold text-surface-700 dark:text-surface-300">Einstellungen</p>
              <div className="space-y-1">
                {TOGGLES.map((t) => (
                  <div
                    key={t.key}
                    className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-surface-50 dark:hover:bg-surface-800/60"
                  >
                    <ToggleSwitch
                      checked={toggles[t.key] ?? t.default}
                      onChange={(v) => setToggle(t.key, v)}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-surface-800 dark:text-surface-200">{t.label}</div>
                      <div className="text-xs text-surface-600">{t.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {error && (
              <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                {error}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-surface-200 px-5 py-3 dark:border-surface-700">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-surface-600 transition hover:bg-surface-200 dark:text-surface-400 dark:hover:bg-surface-800"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={saving || !name.trim()}
              className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-primary-700 disabled:opacity-50"
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Hash size={15} />}
              Channel erstellen
            </button>
          </div>
        </form>
      </div>
      </FocusTrap>
    </div>
  );
}
