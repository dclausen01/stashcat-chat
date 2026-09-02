/**
 * Modal zum Anlegen und Bearbeiten einer Company-Gruppe.
 *
 * Im Bearbeiten-Modus zusaetzlich die Mitgliederpflege: vorhandene Mitglieder
 * entfernen und ueber eine Nutzersuche neue hinzufuegen.
 */

import { useCallback, useEffect, useState } from 'react';
import { X, Loader2, AlertCircle, UserPlus, UserMinus, Search } from 'lucide-react';
import * as api from '../api';
import type { AdminGroup, AdminUser } from '../api/admin';
import { isFlagSet, userDisplayName } from '../api/admin';
import Avatar from './Avatar';

interface AdminGroupModalProps {
  companyId: string;
  /** `null` = Anlegen-Modus. */
  group: AdminGroup | null;
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export default function AdminGroupModal({
  companyId, group, canEdit, onClose, onSaved,
}: AdminGroupModalProps) {
  const isCreate = group === null;

  const [name, setName] = useState(group?.name ?? '');
  const [description, setDescription] = useState(group?.description ?? '');
  const [createChannel, setCreateChannel] = useState(isFlagSet(group?.create_channel));
  const [limitCommunication, setLimitCommunication] = useState(isFlagSet(group?.limit_communication));

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const [members, setMembers] = useState<AdminUser[] | null>(null);
  const [membersLoading, setMembersLoading] = useState(false);

  // Nutzersuche zum Hinzufuegen
  const [userSearch, setUserSearch] = useState('');
  const [candidates, setCandidates] = useState<AdminUser[]>([]);
  const [searching, setSearching] = useState(false);

  const loadMembers = useCallback(async () => {
    if (isCreate || !group) return;
    setMembersLoading(true);
    try {
      setMembers(await api.getAdminGroupMembers(companyId, String(group.id), { limit: 200 }));
    } catch {
      setMembers([]);
    } finally {
      setMembersLoading(false);
    }
  }, [companyId, group, isCreate]);

  useEffect(() => { void loadMembers(); }, [loadMembers]);

  // Kandidatensuche entprellen; erst ab zwei Zeichen, sonst kaeme die halbe Company.
  useEffect(() => {
    if (isCreate || userSearch.trim().length < 2) {
      setCandidates([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const found = await api.listAdminUsers(companyId, { search: userSearch.trim(), limit: 20 });
        if (!cancelled) setCandidates(found);
      } catch {
        if (!cancelled) setCandidates([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [userSearch, companyId, isCreate]);

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
        createChannel,
        limitCommunication,
      };
      if (isCreate) {
        await api.createAdminGroup(companyId, input);
      } else {
        await api.updateAdminGroup(companyId, String(group.id), input);
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  }

  async function addMember(user: AdminUser) {
    if (!group) return;
    setError('');
    setSaving(true);
    try {
      await api.addUsersToGroup(companyId, String(group.id), [user.id]);
      setUserSearch('');
      setCandidates([]);
      await loadMembers();
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Hinzufügen fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  }

  async function removeMember(user: AdminUser) {
    if (!group) return;
    setError('');
    setSaving(true);
    try {
      await api.removeUsersFromGroup(companyId, String(group.id), [user.id]);
      await loadMembers();
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Entfernen fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  }

  const memberIds = new Set((members ?? []).map((m) => m.id));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-surface-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-surface-200 px-6 py-4 dark:border-surface-700">
          <h2 className="flex-1 text-lg font-semibold text-surface-900 dark:text-white">
            {isCreate ? 'Neue Gruppe' : 'Gruppe bearbeiten'}
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

          <form id="admin-group-form" onSubmit={handleSubmit} className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-surface-600 dark:text-surface-400">Name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!canEdit}
                className="w-full rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm text-surface-900 disabled:bg-surface-100 dark:border-surface-600 dark:bg-surface-800 dark:text-white dark:disabled:bg-surface-800/50"
                required
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-surface-600 dark:text-surface-400">Beschreibung</span>
              <input
                value={description ?? ''}
                onChange={(e) => setDescription(e.target.value)}
                disabled={!canEdit}
                className="w-full rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm text-surface-900 disabled:bg-surface-100 dark:border-surface-600 dark:bg-surface-800 dark:text-white dark:disabled:bg-surface-800/50"
              />
            </label>
            <div className="space-y-2 rounded-lg bg-surface-50 p-3 dark:bg-surface-800/50">
              <label className="flex items-start gap-2 text-sm text-surface-700 dark:text-surface-300">
                <input
                  type="checkbox"
                  checked={createChannel}
                  onChange={(e) => setCreateChannel(e.target.checked)}
                  disabled={!canEdit}
                  className="mt-0.5 rounded"
                />
                <span>
                  Zugehörigen Channel anlegen
                  <span className="block text-xs text-surface-500">
                    Mitglieder der Gruppe werden automatisch Mitglied dieses Channels.
                  </span>
                </span>
              </label>
              <label className="flex items-start gap-2 text-sm text-surface-700 dark:text-surface-300">
                <input
                  type="checkbox"
                  checked={limitCommunication}
                  onChange={(e) => setLimitCommunication(e.target.checked)}
                  disabled={!canEdit}
                  className="mt-0.5 rounded"
                />
                <span>
                  Kommunikation beschränken
                  <span className="block text-xs text-surface-500">
                    Mitglieder können nur noch mit erlaubten Gruppen schreiben.
                  </span>
                </span>
              </label>
            </div>
          </form>

          {/* --- Mitglieder (nur im Bearbeiten-Modus) --- */}
          {!isCreate && group && (
            <div className="mt-6 border-t border-surface-200 pt-5 dark:border-surface-700">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-surface-500">
                Mitglieder {members ? `(${members.length})` : ''}
              </h3>

              {canEdit && (
                <div className="mb-3">
                  <div className="relative">
                    <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
                    <input
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                      placeholder="Nutzer suchen und hinzufügen…"
                      className="w-full rounded-lg border border-surface-300 bg-white py-1.5 pl-9 pr-3 text-sm text-surface-900 dark:border-surface-600 dark:bg-surface-800 dark:text-white"
                    />
                  </div>
                  {searching && <Loader2 size={14} className="mt-2 animate-spin text-surface-400" />}
                  {candidates.length > 0 && (
                    <ul className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-surface-200 dark:border-surface-700">
                      {candidates.map((user) => (
                        <li key={user.id}>
                          <button
                            type="button"
                            disabled={saving || memberIds.has(user.id)}
                            onClick={() => void addMember(user)}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-surface-50 disabled:opacity-40 dark:hover:bg-surface-800"
                          >
                            <Avatar name={userDisplayName(user)} image={user.image} size="xs" />
                            <span className="min-w-0 flex-1 truncate">{userDisplayName(user)}</span>
                            {memberIds.has(user.id)
                              ? <span className="shrink-0 text-xs text-surface-400">bereits drin</span>
                              : <UserPlus size={14} className="shrink-0 text-primary-500" />}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {membersLoading ? (
                <Loader2 size={16} className="animate-spin text-surface-400" />
              ) : !members?.length ? (
                <p className="text-xs text-surface-500">Diese Gruppe hat noch keine Mitglieder.</p>
              ) : (
                <ul className="max-h-64 space-y-1 overflow-y-auto">
                  {members.map((user) => (
                    <li
                      key={user.id}
                      className="flex items-center gap-2 rounded-lg bg-surface-50 px-3 py-1.5 dark:bg-surface-800/50"
                    >
                      <Avatar name={userDisplayName(user)} image={user.image} size="xs" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-surface-800 dark:text-surface-200">
                          {userDisplayName(user)}
                        </p>
                        <p className="truncate text-[11px] text-surface-500">{user.email || '–'}</p>
                      </div>
                      {canEdit && (
                        <button
                          type="button"
                          disabled={saving}
                          aria-label={`${userDisplayName(user)} aus Gruppe entfernen`}
                          onClick={() => void removeMember(user)}
                          className="shrink-0 rounded-lg p-1 text-surface-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-900/20"
                        >
                          <UserMinus size={14} />
                        </button>
                      )}
                    </li>
                  ))}
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
              form="admin-group-form"
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
