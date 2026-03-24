import { useState, useEffect, useCallback } from 'react';
import { X, Loader2, Save } from 'lucide-react';
import { clsx } from 'clsx';
import * as api from '../api';
import type { ChatTarget } from '../types';

/** Preset link types with emoji and label */
const LINK_PRESETS = [
  { emoji: '📹', label: 'Videokonferenz', placeholder: 'https://meet.example.com/raum' },
  { emoji: '📚', label: 'Moodle / LMS', placeholder: 'https://moodle.example.com/course/...' },
  { emoji: '📌', label: 'TaskCards', placeholder: 'https://taskcards.example.com/board/...' },
  { emoji: '📝', label: 'Dokument', placeholder: 'https://docs.example.com/...' },
  { emoji: '📊', label: 'Tabelle', placeholder: 'https://sheets.example.com/...' },
  { emoji: '📓', label: 'Notizbuch', placeholder: 'https://onenote.example.com/...' },
  { emoji: '🔗', label: 'Link', placeholder: 'https://...' },
  { emoji: '📂', label: 'Ordner', placeholder: 'https://cloud.example.com/...' },
  { emoji: '📅', label: 'Kalender', placeholder: 'https://calendar.example.com/...' },
] as const;

interface LinkRow {
  emoji: string;
  label: string;
  url: string;
}

interface ChannelDescriptionEditorProps {
  chat: ChatTarget;
  onClose: () => void;
  onSaved: (newDescription: string) => void;
}

/** Parse existing description to extract link rows */
function parseDescription(desc: string): { freeText: string; links: LinkRow[] } {
  const lines = desc.split('\n');
  const linkLines: LinkRow[] = [];
  const freeLines: string[] = [];

  for (const line of lines) {
    // Match lines like "📹 Videokonferenz: https://..." or "📹 https://..."
    const match = line.match(/^([^\w\s])\s*(?:([^:h]+?):\s*)?(https?:\/\/\S+)\s*$/u);
    if (match) {
      const [, emoji, label, url] = match;
      linkLines.push({
        emoji,
        label: label?.trim() || LINK_PRESETS.find((p) => p.emoji === emoji)?.label || '',
        url,
      });
    } else {
      freeLines.push(line);
    }
  }

  // Remove trailing empty lines from freeText
  while (freeLines.length > 0 && freeLines[freeLines.length - 1].trim() === '') freeLines.pop();

  return { freeText: freeLines.join('\n'), links: linkLines };
}

/** Build description from freeText + link rows */
function buildDescription(freeText: string, links: LinkRow[]): string {
  const parts: string[] = [];
  if (freeText.trim()) parts.push(freeText.trim());

  const linkParts = links
    .filter((l) => l.url.trim())
    .map((l) => {
      const label = l.label.trim();
      return label ? `${l.emoji} ${label}: ${l.url.trim()}` : `${l.emoji} ${l.url.trim()}`;
    });

  if (linkParts.length > 0) {
    if (parts.length > 0) parts.push(''); // blank line separator
    parts.push(...linkParts);
  }

  return parts.join('\n');
}

export default function ChannelDescriptionEditor({ chat, onClose, onSaved }: ChannelDescriptionEditorProps) {
  const parsed = parseDescription(chat.description || '');

  const [freeText, setFreeText] = useState(parsed.freeText);
  const [links, setLinks] = useState<LinkRow[]>(() => {
    // Always show 3 rows; fill from parsed, pad with defaults
    const rows: LinkRow[] = [];
    for (let i = 0; i < 3; i++) {
      if (parsed.links[i]) {
        rows.push({ ...parsed.links[i] });
      } else {
        const preset = LINK_PRESETS[i] || LINK_PRESETS[6]; // fallback to generic Link
        rows.push({ emoji: preset.emoji, label: preset.label, url: '' });
      }
    }
    return rows;
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [showEmojiPicker, setShowEmojiPicker] = useState<number | null>(null);

  // Auto-update freeText preview when links change
  const fullDescription = buildDescription(freeText, links);

  const updateLink = useCallback((index: number, field: keyof LinkRow, value: string) => {
    setLinks((prev) => prev.map((l, i) => i === index ? { ...l, [field]: value } : l));
  }, []);

  const handleSave = async () => {
    if (!chat.company_id) {
      setError('Keine company_id vorhanden');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.editChannel(chat.id, chat.company_id, fullDescription);
      onSaved(fullDescription);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  };

  // Close emoji picker on outside click
  useEffect(() => {
    if (showEmojiPicker === null) return;
    const handler = () => setShowEmojiPicker(null);
    window.addEventListener('click', handler);
    return () => window.removeEventListener('click', handler);
  }, [showEmojiPicker]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative flex w-full max-w-lg flex-col rounded-2xl bg-white shadow-2xl dark:bg-surface-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-surface-200 px-5 py-4 dark:border-surface-700">
          <h2 className="flex-1 text-base font-semibold text-surface-900 dark:text-white">
            Channel-Beschreibung bearbeiten
          </h2>
          <button onClick={onClose} className="rounded-lg p-1.5 text-surface-400 hover:bg-surface-100 dark:hover:bg-surface-800">
            <X size={18} />
          </button>
        </div>

        <div className="space-y-4 overflow-y-auto px-5 py-4" style={{ maxHeight: '70vh' }}>
          {/* Free text area */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-surface-500">
              Beschreibung
            </label>
            <textarea
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              rows={3}
              placeholder="Kurze Beschreibung des Channels…"
              className="w-full resize-y rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm text-surface-900 outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 dark:border-surface-600 dark:bg-surface-800 dark:text-white"
            />
          </div>

          {/* Quick-Link rows */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-surface-500">
              Quick-Links
            </label>
            <div className="space-y-2">
              {links.map((link, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  {/* Emoji picker button */}
                  <div className="relative">
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowEmojiPicker(showEmojiPicker === idx ? null : idx); }}
                      className="flex h-9 w-9 items-center justify-center rounded-lg border border-surface-300 text-lg transition hover:bg-surface-100 dark:border-surface-600 dark:hover:bg-surface-800"
                      title="Symbol wählen"
                    >
                      {link.emoji}
                    </button>
                    {showEmojiPicker === idx && (
                      <div
                        className="absolute left-0 top-full z-10 mt-1 w-[220px] rounded-xl border border-surface-200 bg-white p-2 shadow-xl dark:border-surface-600 dark:bg-surface-800"
                        style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '4px' }}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {LINK_PRESETS.map((p) => (
                          <button
                            key={p.emoji}
                            onClick={() => {
                              updateLink(idx, 'emoji', p.emoji);
                              updateLink(idx, 'label', p.label);
                              setShowEmojiPicker(null);
                            }}
                            className={clsx(
                              'flex h-8 w-8 items-center justify-center rounded-md text-lg transition hover:bg-surface-100 dark:hover:bg-surface-700',
                              link.emoji === p.emoji && 'bg-primary-100 dark:bg-primary-900/30',
                            )}
                            title={p.label}
                          >
                            {p.emoji}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Label */}
                  <input
                    type="text"
                    value={link.label}
                    onChange={(e) => updateLink(idx, 'label', e.target.value)}
                    placeholder="Label"
                    className="w-24 shrink-0 rounded-lg border border-surface-300 bg-white px-2.5 py-1.5 text-sm text-surface-900 outline-none transition focus:border-primary-500 dark:border-surface-600 dark:bg-surface-800 dark:text-white"
                  />

                  {/* URL */}
                  <input
                    type="url"
                    value={link.url}
                    onChange={(e) => updateLink(idx, 'url', e.target.value)}
                    placeholder={LINK_PRESETS.find((p) => p.emoji === link.emoji)?.placeholder || 'https://...'}
                    className="min-w-0 flex-1 rounded-lg border border-surface-300 bg-white px-2.5 py-1.5 text-sm text-surface-900 outline-none transition focus:border-primary-500 dark:border-surface-600 dark:bg-surface-800 dark:text-white"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Preview */}
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-surface-500">
              Vorschau
            </label>
            <div className="whitespace-pre-wrap rounded-lg bg-surface-50 px-3 py-2 text-sm text-surface-700 dark:bg-surface-800 dark:text-surface-300">
              {fullDescription || <span className="italic text-surface-400">Keine Beschreibung</span>}
            </div>
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
            className="rounded-lg px-4 py-2 text-sm font-medium text-surface-600 transition hover:bg-surface-100 dark:text-surface-400 dark:hover:bg-surface-800"
          >
            Abbrechen
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-primary-700 disabled:opacity-50"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Speichern
          </button>
        </div>
      </div>
    </div>
  );
}
