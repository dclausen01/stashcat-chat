/**
 * Modal zum Anlegen und Bearbeiten eines Channels aus der Administration.
 *
 * Im Bearbeiten-Modus zusaetzlich die Mitgliederliste mit Moderatoren-Schalter
 * sowie die Channel-Statistik.
 */

import { useCallback, useEffect, useState } from 'react';
import { X, Loader2, AlertCircle, Shield, ShieldOff } from 'lucide-react';
import { clsx } from 'clsx';
import * as api from '../api';
import type { AdminChannel, AdminUser } from '../api/admin';
import { isFlagSet, userDisplayName } from '../api/admin';
import Avatar from './Avatar';

interface AdminChannelModalProps {
  companyId: string;
  /** `null` = Anlegen-Modus. */
  channel: AdminChannel | null;
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}

/** Formatiert Statistikwerte, ohne Annahmen ueber die genauen Feldnamen. */
function formatStatValue(value: unknown): string {
  if (value === null || value === undefined) return '–';
  if (typeof value === 'number') return value.toLocaleString('de-DE');
  if (typeof value === 'boolean') return value ? 'ja' : 'nein';
  if (typeof value === 'string') return value;
  return JSON.stringify(value);
}

export default function AdminChannelModal({
  companyId, channel, canEdit, onClose, onSaved,
}: AdminChannelModalProps) {
  const isCreate = channel === null;

  const [name, setName] = useState(channel?.name ?? '');
  const [description, setDescription] = useState(channel?.description ?? '');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(isFlagSet(channel?.visible));
  const [writable, setWritable] = useState(channel?.writable ?? 'all');
  const [inviteable, setInviteable] = useState(isFlagSet(channel?.inviteable));
  const [showActivities, setShowActivities] = useState(isFlagSet(channel?.show_activities));
  const [showMembershipActivities, setShowMembershipActivities] = useState(
    isFlagSet(channel?.show_membership_activities),
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [members, setMembers] = useState<AdminUser[] | null>(null);
  const [membersLoading, setMembersLoading] = useState(false);
  const [stats, setStats] = useState<Record<string, unknown> | null>(null);

  const loadMembers = useCallback(async () => {
    if (isCreate || !channel) return;
    setMembersLoading(true);
    try {
      setMembers(await api.getAdminChannelMembers(companyId, String(channel.id), { limit: 200 }));
    } catch {
      setMembers([]);
    } finally {
      setMembersLoading(false);
    }
  }, [companyId, channel, isCreate]);

  useEffect(() => { void loadMembers(); }, [loadMembers]);

  // Statistik ist ein Extra — schlaegt sie fehl, bleibt der Rest nutzbar.
  useEffect(() => {
    if (isCreate || !channel) return;
    api.getChannelStatistics(companyId, String(channel.id))
      .then(setStats)
      .catch(() => setStats(null));
  }, [companyId, channel, isCreate]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!name.trim()) {
      setError('Der Name ist ein Pflichtfeld.');
      return;
    }
    setSaving(true);
    try {
      const input = {
        name: name.trim(),
        description: description?.trim() ?? '',
        password: password || undefined,
        visible,
        writable,
        inviteable,
        showActivities,
        showMembershipActivities,
      };
      if (isCreate) {
        await api.createAdminChannel(companyId, input);
      } else {
        await api.updateAdminChannel(companyId, String(channel.id), input);
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  }

  async function toggleModerator(user: AdminUser, makeModerator: boolean) {
    if (!channel) return;
    setError('');
    setSaving(true);
    try {
      await api.setChannelModerators(companyId, String(channel.id), [user.id], makeModerator);
      await loadMembers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Moderatorstatus konnte nicht geändert werden');
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    'w-full rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm text-surface-900 disabled:bg-surface-100 dark:border-surface-600 dark:bg-surface-800 dark:text-white dark:disabled:bg-surface-800/50';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-surface-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-surface-200 px-6 py-4 dark:border-surface-700">
          <h2 className="flex-1 text-lg font-semibold text-surface-900 dark:text-white">
            {isCreate ? 'Neuer Channel' : 'Channel bearbeiten'}
          </h2>
          <button
            onClick={onClose}
            aria-label="Schließen"
            className="rounded-lg p-1.5 text-surface-500 hover:bg-surface-200 dark:hover:bg-surface-700"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {error && (
            <p className="mb-4 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
              <AlertCircle size={16} className="mt-0.5 shrink-0" /> {error}
            </p>
          )}

          <form id="admin-channel-form" onSubmit={handleSubmit} className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-surface-600 dark:text-surface-400">Name</span>
              <input value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} className={inputClass} required />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-surface-600 dark:text-surface-400">Beschreibung</span>
              <input value={description ?? ''} onChange={(e) => setDescription(e.target.value)} disabled={!canEdit} className={inputClass} />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-surface-600 dark:text-surface-400">
                Passwort {!isCreate && <span className="font-normal text-surface-400">(leer lassen = unverändert)</span>}
              </span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={!canEdit}
                autoComplete="new-password"
                className={inputClass}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-surface-600 dark:text-surface-400">Wer darf schreiben</span>
              <select value={writable ?? 'all'} onChange={(e) => setWritable(e.target.value)} disabled={!canEdit} className={inputClass}>
                <option value="all">Alle Mitglieder</option>
                <option value="restricted">Nur Moderatoren</option>
              </select>
            </label>

            <div className="space-y-2 rounded-lg bg-surface-50 p-3 dark:bg-surface-800/50">
              {([
                ['Im Verzeichnis sichtbar', visible, setVisible],
                ['Mitglieder dürfen einladen', inviteable, setInviteable],
                ['Aktivitäten anzeigen', showActivities, setShowActivities],
                ['Beitritte und Austritte anzeigen', showMembershipActivities, setShowMembershipActivities],
              ] as [string, boolean, (v: boolean) => void][]).map(([label, value, setter]) => (
                <label key={label} className="flex items-center gap-2 text-sm text-surface-700 dark:text-surface-300">
                  <input type="checkbox" checked={value} onChange={(e) => setter(e.target.checked)} disabled={!canEdit} className="rounded" />
                  {label}
                </label>
              ))}
            </div>
          </form>

          {/* --- Statistik --- */}
          {!isCreate && stats && Object.keys(stats).length > 0 && (
            <div className="mt-6 border-t border-surface-200 pt-5 dark:border-surface-700">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-surface-500">Statistik</h3>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                {Object.entries(stats).map(([key, value]) => (
                  <div key={key}>
                    <dt className="truncate text-surface-500">{key.replace(/_/g, ' ')}</dt>
                    <dd className="text-surface-800 dark:text-surface-200">{formatStatValue(value)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {/* --- Mitglieder --- */}
          {!isCreate && channel && (
            <div className="mt-6 border-t border-surface-200 pt-5 dark:border-surface-700">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-surface-500">
                Mitglieder {members ? `(${members.length})` : ''}
              </h3>
              {membersLoading ? (
                <Loader2 size={16} className="animate-spin text-surface-400" />
              ) : !members?.length ? (
                <p className="text-xs text-surface-500">Keine Mitglieder gefunden.</p>
              ) : (
                <ul className="max-h-64 space-y-1 overflow-y-auto">
                  {members.map((user) => {
                    // Moderatorstatus steckt im `manager`-Feld — siehe CLAUDE.md,
                    // die API liefert kein sauberes isModerator-Flag.
                    const isModerator = Boolean((user as unknown as { manager?: unknown }).manager);
                    return (
                      <li key={user.id} className="flex items-center gap-2 rounded-lg bg-surface-50 px-3 py-1.5 dark:bg-surface-800/50">
                        <Avatar name={userDisplayName(user)} image={user.image} size="xs" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium text-surface-800 dark:text-surface-200">
                            {userDisplayName(user)}
                          </p>
                          <p className="truncate text-[11px] text-surface-500">{user.email || '–'}</p>
                        </div>
                        {isModerator && (
                          <span className="shrink-0 rounded-full bg-primary-100 px-2 py-0.5 text-[11px] font-medium text-primary-700 dark:bg-primary-900/30 dark:text-primary-400">
                            Moderator
                          </span>
                        )}
                        {canEdit && (
                          <button
                            type="button"
                            disabled={saving}
                            title={isModerator ? 'Moderatorrechte entziehen' : 'Zum Moderator machen'}
                            aria-label={isModerator ? `${userDisplayName(user)} Moderatorrechte entziehen` : `${userDisplayName(user)} zum Moderator machen`}
                            onClick={() => void toggleModerator(user, !isModerator)}
                            className={clsx(
                              'shrink-0 rounded-lg p-1 disabled:opacity-50',
                              isModerator
                                ? 'text-surface-500 hover:bg-surface-200 dark:hover:bg-surface-700'
                                : 'text-surface-500 hover:bg-primary-50 hover:text-primary-600 dark:hover:bg-primary-900/20',
                            )}
                          >
                            {isModerator ? <ShieldOff size={14} /> : <Shield size={14} />}
                          </button>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-surface-200 px-6 py-4 dark:border-surface-700">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-surface-600 hover:bg-surface-100 dark:text-surface-400 dark:hover:bg-surface-800"
          >
            {canEdit ? 'Abbrechen' : 'Schließen'}
          </button>
          {canEdit && (
            <button
              type="submit"
              form="admin-channel-form"
              disabled={saving}
              className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              {isCreate ? 'Anlegen' : 'Speichern'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
