/**
 * Modal zum Anlegen und Bearbeiten einer Rolle.
 *
 * Die Rechte sind thematisch gruppiert und deutsch beschriftet (siehe
 * `src/lib/permissionLabels.ts`). Rechte, die die API liefert, wir aber nicht
 * kennen, erscheinen unter „Weitere Rechte" mit ihrem Rohnamen — so gehen sie
 * beim Speichern nicht verloren.
 *
 * Systemrollen (`editable: false`) werden nur angezeigt.
 */

import { useState } from 'react';
import { X, Loader2, AlertCircle, Lock, Info } from 'lucide-react';
import { clsx } from 'clsx';
import * as api from '../api';
import type { AdminRole } from '../api/admin';
import { isRoleEditable, rolePermissions } from '../api/admin';
import { buildPermissionGroups, permissionLabel } from '../lib/permissionLabels';

interface AdminRoleModalProps {
  companyId: string;
  /** `null` = Anlegen-Modus. */
  role: AdminRole | null;
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}

export default function AdminRoleModal({
  companyId, role, canEdit, onClose, onSaved,
}: AdminRoleModalProps) {
  const isCreate = role === null;
  const editable = isCreate || isRoleEditable(role);
  const writable = canEdit && editable;

  const [name, setName] = useState(role?.name ?? '');
  const [isGlobal, setIsGlobal] = useState(Boolean(role?.global) && role?.global !== '0');
  const [selected, setSelected] = useState<string[]>(() => (role ? rolePermissions(role) : []));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Unbekannte Rechte der Rolle mit einbeziehen, damit sie erhalten bleiben.
  const groups = buildPermissionGroups(selected);

  function toggle(key: string) {
    setSelected((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }

  function toggleGroup(keys: string[], on: boolean) {
    setSelected((prev) => (on
      ? [...new Set([...prev, ...keys])]
      : prev.filter((k) => !keys.includes(k))));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!name.trim()) {
      setError('Der Name ist ein Pflichtfeld.');
      return;
    }
    setSaving(true);
    try {
      const input = { name: name.trim(), permissions: selected, isGlobal };
      if (isCreate) {
        await api.createAdminRole(companyId, input);
      } else {
        await api.updateAdminRole(companyId, String(role.id), input);
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-surface-900"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-surface-200 px-6 py-4 dark:border-surface-700">
          <h2 className="flex-1 text-lg font-semibold text-surface-900 dark:text-white">
            {isCreate ? 'Neue Rolle' : 'Rolle bearbeiten'}
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
          {!isCreate && !editable && (
            <p className="mb-4 flex items-start gap-2 rounded-lg bg-surface-100 px-3 py-2 text-xs text-surface-700 dark:bg-surface-800 dark:text-surface-300">
              <Lock size={15} className="mt-0.5 shrink-0" />
              Systemrolle — kann nur angesehen werden.
            </p>
          )}

          <form id="admin-role-form" onSubmit={handleSubmit} className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-surface-600 dark:text-surface-400">Name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!writable}
                className="w-full rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm text-surface-900 disabled:bg-surface-100 dark:border-surface-600 dark:bg-surface-800 dark:text-white dark:disabled:bg-surface-800/50"
                required
              />
            </label>

            <label className="flex items-start gap-2 rounded-lg bg-surface-50 p-3 text-sm text-surface-700 dark:bg-surface-800/50 dark:text-surface-300">
              <input
                type="checkbox"
                checked={isGlobal}
                onChange={(e) => setIsGlobal(e.target.checked)}
                disabled={!writable}
                className="mt-0.5 rounded"
              />
              <span>
                Organisationsweite Rolle
                <span className="block text-xs text-surface-500">
                  Gilt dann nicht nur für diese Company.
                </span>
              </span>
            </label>

            <div>
              <div className="mb-2 flex items-center gap-2">
                <span className="flex-1 text-xs font-medium text-surface-600 dark:text-surface-400">
                  Rechte ({selected.length})
                </span>
              </div>
              <div className="space-y-4">
                {groups.map((group) => {
                  const allOn = group.keys.every((k) => selected.includes(k));
                  return (
                    <div key={group.title}>
                      <div className="mb-1.5 flex items-center gap-2">
                        <span className="flex-1 text-[11px] font-semibold uppercase tracking-wide text-surface-500">
                          {group.title}
                        </span>
                        {writable && (
                          <button
                            type="button"
                            onClick={() => toggleGroup(group.keys, !allOn)}
                            className="text-[11px] text-primary-600 hover:underline dark:text-primary-400"
                          >
                            {allOn ? 'Alle abwählen' : 'Alle auswählen'}
                          </button>
                        )}
                      </div>
                      <div className="space-y-1">
                        {group.keys.map((key) => (
                          <label
                            key={key}
                            className={clsx(
                              'flex items-start gap-2 rounded px-1 py-0.5 text-sm',
                              writable ? 'cursor-pointer hover:bg-surface-50 dark:hover:bg-surface-800/50' : 'opacity-80',
                            )}
                          >
                            <input
                              type="checkbox"
                              checked={selected.includes(key)}
                              onChange={() => toggle(key)}
                              disabled={!writable}
                              className="mt-0.5 rounded"
                            />
                            <span className="text-surface-700 dark:text-surface-300">
                              {permissionLabel(key)}
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <p className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
              <Info size={15} className="mt-0.5 shrink-0" />
              Änderungen wirken sofort für alle Nutzer mit dieser Rolle. Wer sich selbst
              das Recht „Rollen ändern" entzieht, kommt hier nicht mehr hinein.
            </p>
          </form>
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-surface-200 px-6 py-4 dark:border-surface-700">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-surface-600 hover:bg-surface-100 dark:text-surface-400 dark:hover:bg-surface-800"
          >
            {writable ? 'Abbrechen' : 'Schließen'}
          </button>
          {writable && (
            <button
              type="submit"
              form="admin-role-form"
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
