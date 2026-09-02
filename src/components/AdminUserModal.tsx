/**
 * Modal zum Anlegen und Bearbeiten eines Company-Nutzers.
 *
 * Im Bearbeiten-Modus zusaetzlich: Konto-Aktionen (Admin-Status, Schreibrechte,
 * Einladung erneut senden) und die Geraeteliste des Nutzers. Jede Aktion ist
 * an das passende Recht gebunden — fehlt es, wird der Block ausgeblendet.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  X, Loader2, Shield, ShieldOff, PenOff, Pen, Mail, Smartphone, Trash2, AlertCircle,
} from 'lucide-react';
import { clsx } from 'clsx';
import * as api from '../api';
import type { AdminDevice, AdminRole, AdminUser, PermissionKey } from '../api/admin';
import { useConfirm } from '../context/ConfirmContext';
import { roleDisplayName } from '../lib/permissionLabels';

interface AdminUserModalProps {
  companyId: string;
  /** `null` = Anlegen-Modus. */
  user: AdminUser | null;
  roles: AdminRole[];
  has: (...needed: PermissionKey[]) => boolean;
  onClose: () => void;
  /** Wird nach jeder erfolgreichen Aenderung aufgerufen. */
  onSaved: () => void;
}

function formatTimestamp(ts?: number | string | null): string {
  const n = typeof ts === 'string' ? parseInt(ts, 10) : ts;
  if (!n) return '–';
  return new Date(n * 1000).toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function AdminUserModal({
  companyId, user, roles, has, onClose, onSaved,
}: AdminUserModalProps) {
  const isCreate = user === null;
  const confirm = useConfirm();

  const [firstName, setFirstName] = useState(user?.first_name ?? '');
  const [lastName, setLastName] = useState(user?.last_name ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [administrator, setAdministrator] = useState(Boolean(user?.admin));
  const [readOnly, setReadOnly] = useState(Boolean(user?.read_only));
  const [roleIds, setRoleIds] = useState<string[]>(
    () => (user?.roles ?? []).map((r) => String(r.id)),
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [devices, setDevices] = useState<AdminDevice[] | null>(null);
  const [devicesLoading, setDevicesLoading] = useState(false);

  const canEditRoles = has('admin_edit_company_roles', 'admin_rename_users');
  const canSeeDevices = has('admin_list_user_devices');
  const canRemoveDevices = has('admin_delete_user_devices');
  const canInvite = has('admin_add_users');
  const canToggleFlags = has('admin_rename_users', 'admin_add_users');

  const loadDevices = useCallback(async () => {
    if (isCreate || !user || !canSeeDevices) return;
    setDevicesLoading(true);
    try {
      setDevices(await api.getUserDevices(companyId, user.id));
    } catch {
      setDevices([]);
    } finally {
      setDevicesLoading(false);
    }
  }, [companyId, user, isCreate, canSeeDevices]);

  useEffect(() => { void loadDevices(); }, [loadDevices]);

  function toggleRole(id: string) {
    setRoleIds((prev) => (prev.includes(id) ? prev.filter((r) => r !== id) : [...prev, id]));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!firstName.trim() || !lastName.trim() || (isCreate && !email.trim())) {
      setError('Bitte alle Pflichtfelder ausfüllen.');
      return;
    }
    setSaving(true);
    try {
      if (isCreate) {
        await api.createAdminUser(companyId, {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
          administrator,
          readOnly,
          roles: roleIds,
        });
      } else {
        await api.updateAdminUser(companyId, user.id, {
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          roles: roleIds,
        });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speichern fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  }

  /** Fuehrt eine Konto-Aktion aus und haelt Fehler lokal im Modal. */
  async function runAction(fn: () => Promise<unknown>, optimistic?: () => void) {
    setError('');
    setSaving(true);
    try {
      await fn();
      optimistic?.();
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Aktion fehlgeschlagen');
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
            {isCreate ? 'Neuen Nutzer anlegen' : 'Nutzer bearbeiten'}
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

          <form id="admin-user-form" onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-surface-600 dark:text-surface-400">Vorname</span>
                <input
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="w-full rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm text-surface-900 dark:border-surface-600 dark:bg-surface-800 dark:text-white"
                  required
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-surface-600 dark:text-surface-400">Nachname</span>
                <input
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="w-full rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm text-surface-900 dark:border-surface-600 dark:bg-surface-800 dark:text-white"
                  required
                />
              </label>
            </div>

            <label className="block">
              <span className="mb-1 block text-xs font-medium text-surface-600 dark:text-surface-400">E-Mail</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={!isCreate}
                className="w-full rounded-lg border border-surface-300 bg-white px-3 py-2 text-sm text-surface-900 disabled:bg-surface-100 disabled:text-surface-500 dark:border-surface-600 dark:bg-surface-800 dark:text-white dark:disabled:bg-surface-800/50"
                required={isCreate}
              />
              {!isCreate && (
                <span className="mt-1 block text-xs text-surface-500">
                  Die E-Mail-Adresse kann über die Nutzerverwaltung nicht geändert werden.
                </span>
              )}
            </label>

            {canEditRoles && roles.length > 0 && (
              <div>
                <span className="mb-1.5 block text-xs font-medium text-surface-600 dark:text-surface-400">Rollen</span>
                <div className="flex flex-wrap gap-1.5">
                  {roles.map((role) => {
                    const id = String(role.id);
                    const selected = roleIds.includes(id);
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => toggleRole(id)}
                        className={clsx(
                          'rounded-full px-3 py-1 text-xs font-medium transition',
                          selected
                            ? 'bg-primary-600 text-white'
                            : 'bg-surface-100 text-surface-600 hover:bg-surface-200 dark:bg-surface-800 dark:text-surface-400 dark:hover:bg-surface-700',
                        )}
                      >
                        {roleDisplayName(role.name)}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {isCreate && (
              <div className="space-y-2 rounded-lg bg-surface-50 p-3 dark:bg-surface-800/50">
                <label className="flex items-center gap-2 text-sm text-surface-700 dark:text-surface-300">
                  <input
                    type="checkbox"
                    checked={administrator}
                    onChange={(e) => setAdministrator(e.target.checked)}
                    className="rounded"
                  />
                  Als Administrator anlegen
                </label>
                <label className="flex items-center gap-2 text-sm text-surface-700 dark:text-surface-300">
                  <input
                    type="checkbox"
                    checked={readOnly}
                    onChange={(e) => setReadOnly(e.target.checked)}
                    className="rounded"
                  />
                  Nur lesender Zugriff
                </label>
              </div>
            )}
          </form>

          {/* --- Konto-Aktionen (nur im Bearbeiten-Modus) --- */}
          {!isCreate && user && canToggleFlags && (
            <div className="mt-6 border-t border-surface-200 pt-5 dark:border-surface-700">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-surface-500">Konto</h3>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => runAction(
                    () => api.setUserAdmin(companyId, user.id, !administrator),
                    () => setAdministrator((v) => !v),
                  )}
                  className="flex items-center gap-1.5 rounded-lg border border-surface-300 px-3 py-1.5 text-xs font-medium text-surface-700 hover:bg-surface-100 disabled:opacity-50 dark:border-surface-600 dark:text-surface-300 dark:hover:bg-surface-800"
                >
                  {administrator ? <ShieldOff size={14} /> : <Shield size={14} />}
                  {administrator ? 'Admin-Rechte entziehen' : 'Zum Admin machen'}
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => runAction(
                    () => api.setUserReadOnly(companyId, user.id, !readOnly),
                    () => setReadOnly((v) => !v),
                  )}
                  className="flex items-center gap-1.5 rounded-lg border border-surface-300 px-3 py-1.5 text-xs font-medium text-surface-700 hover:bg-surface-100 disabled:opacity-50 dark:border-surface-600 dark:text-surface-300 dark:hover:bg-surface-800"
                >
                  {readOnly ? <Pen size={14} /> : <PenOff size={14} />}
                  {readOnly ? 'Schreibrechte geben' : 'Schreibrechte entziehen'}
                </button>
                {canInvite && user.email && !user.active && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => runAction(() => api.resendInvite(companyId, user.id, user.email!))}
                    className="flex items-center gap-1.5 rounded-lg border border-surface-300 px-3 py-1.5 text-xs font-medium text-surface-700 hover:bg-surface-100 disabled:opacity-50 dark:border-surface-600 dark:text-surface-300 dark:hover:bg-surface-800"
                  >
                    <Mail size={14} /> Einladung erneut senden
                  </button>
                )}
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                <div>
                  <dt className="text-surface-500">Beigetreten</dt>
                  <dd className="text-surface-800 dark:text-surface-200">{formatTimestamp(user.time_joined)}</dd>
                </div>
                <div>
                  <dt className="text-surface-500">Letzter Login</dt>
                  <dd className="text-surface-800 dark:text-surface-200">{formatTimestamp(user.last_login)}</dd>
                </div>
              </dl>
            </div>
          )}

          {/* --- Geraete --- */}
          {!isCreate && user && canSeeDevices && (
            <div className="mt-6 border-t border-surface-200 pt-5 dark:border-surface-700">
              <div className="mb-3 flex items-center gap-2">
                <h3 className="flex-1 text-xs font-semibold uppercase tracking-wide text-surface-500">
                  Geräte {devices ? `(${devices.length})` : ''}
                </h3>
                {canRemoveDevices && devices && devices.length > 0 && (
                  <button
                    type="button"
                    disabled={saving}
                    onClick={async () => {
                      if (!await confirm(`Alle Geräte von ${firstName} ${lastName} abmelden?`, 'Abmelden')) return;
                      await runAction(() => api.removeAllUserDevices(companyId, user.id));
                      void loadDevices();
                    }}
                    className="text-xs font-medium text-red-600 hover:underline dark:text-red-400"
                  >
                    Alle abmelden
                  </button>
                )}
              </div>
              {devicesLoading ? (
                <Loader2 size={16} className="animate-spin text-surface-400" />
              ) : !devices?.length ? (
                <p className="text-xs text-surface-500">Keine Geräte angemeldet.</p>
              ) : (
                <ul className="space-y-1.5">
                  {devices.map((d) => (
                    <li
                      key={d.id ?? d.device_id}
                      className="flex items-center gap-2 rounded-lg bg-surface-50 px-3 py-2 dark:bg-surface-800/50"
                    >
                      <Smartphone size={14} className="shrink-0 text-surface-400" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-medium text-surface-800 dark:text-surface-200">
                          {d.app_name || 'Unbekanntes Gerät'}
                        </p>
                        <p className="truncate text-[11px] text-surface-500">
                          {d.ip_address || '–'} · {formatTimestamp(d.last_login)}
                        </p>
                      </div>
                      {canRemoveDevices && (
                        <button
                          type="button"
                          disabled={saving}
                          aria-label="Gerät abmelden"
                          onClick={async () => {
                            const deviceKey = d.device_id ?? d.id;
                            if (!deviceKey) return;
                            if (!await confirm('Dieses Gerät abmelden?', 'Abmelden')) return;
                            await runAction(async () => {
                              setDevices(await api.removeUserDevice(companyId, user.id, deviceKey));
                            });
                          }}
                          className="shrink-0 rounded-lg p-1 text-surface-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-900/20"
                        >
                          <Trash2 size={14} />
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
            Abbrechen
          </button>
          <button
            type="submit"
            form="admin-user-form"
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-50"
          >
            {saving && <Loader2 size={14} className="animate-spin" />}
            {isCreate ? 'Anlegen' : 'Speichern'}
          </button>
        </div>
      </div>
    </div>
  );
}
