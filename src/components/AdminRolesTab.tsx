/**
 * Tab „Rollen" im Admin-Bereich.
 *
 * Listet die Rollen der Company mit ihren Rechten. Systemrollen (etwa
 * `{{admins}}`) tragen `editable: false` und lassen sich nur ansehen — die
 * API wuerde eine Aenderung ablehnen, deshalb blenden wir sie hier gar nicht
 * erst als bearbeitbar aus.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Plus, Loader2, Trash2, RefreshCw, AlertCircle, KeyRound, Lock, Globe,
} from 'lucide-react';
import { clsx } from 'clsx';
import * as api from '../api';
import type { AdminRole, PermissionKey } from '../api/admin';
import { isRoleEditable, rolePermissions } from '../api/admin';
import { roleDisplayName } from '../lib/permissionLabels';
import { useConfirm } from '../context/ConfirmContext';
import AdminRoleModal from './AdminRoleModal';

interface AdminRolesTabProps {
  companyId: string;
  has: (...needed: PermissionKey[]) => boolean;
}

export default function AdminRolesTab({ companyId, has }: AdminRolesTabProps) {
  const confirm = useConfirm();

  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<AdminRole | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  const canEdit = has('admin_edit_company_roles');

  const loadRoles = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError('');
    try {
      setRoles(await api.getAdminRoles(companyId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Rollen konnten nicht geladen werden');
      setRoles([]);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { void loadRoles(); }, [loadRoles]);

  async function handleDelete(role: AdminRole) {
    const ok = await confirm(
      `Rolle „${roleDisplayName(role.name)}" löschen? Nutzer mit dieser Rolle verlieren die daran hängenden Rechte.`,
      'Löschen',
    );
    if (!ok) return;
    setBusy(true);
    setError('');
    try {
      await api.deleteAdminRole(companyId, String(role.id));
      await loadRoles();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Löschen fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-surface-200 px-4 py-3 sm:px-6 dark:border-surface-700">
        <p className="flex-1 text-xs text-surface-500">
          Rechte gelten für alle Nutzer, denen die Rolle zugewiesen ist.
        </p>
        <button
          onClick={() => void loadRoles()}
          aria-label="Neu laden"
          title="Neu laden"
          className="rounded-lg p-1.5 text-surface-600 hover:bg-surface-200 dark:hover:bg-surface-800"
        >
          <RefreshCw size={16} className={clsx(loading && 'animate-spin')} />
        </button>
        {canEdit && (
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700"
          >
            <Plus size={15} /> <span className="hidden sm:inline">Neue Rolle</span>
          </button>
        )}
      </div>

      {error && (
        <p className="flex items-start gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600 sm:px-6 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-400">
          <AlertCircle size={16} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={22} className="animate-spin text-surface-400" />
          </div>
        ) : roles.length === 0 ? (
          <p className="py-16 text-center text-sm text-surface-500">Keine Rollen vorhanden.</p>
        ) : (
          <ul>
            {roles.map((role) => {
              const editable = isRoleEditable(role);
              const count = rolePermissions(role).length;
              return (
                <li
                  key={String(role.id)}
                  className="flex items-center gap-3 border-b border-surface-100 px-4 py-3 transition hover:bg-surface-50 sm:px-6 dark:border-surface-800 dark:hover:bg-surface-800/50"
                >
                  <button
                    onClick={() => setEditing(role)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-100 text-surface-500 dark:bg-surface-800 dark:text-surface-400">
                      <KeyRound size={16} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 truncate text-sm font-medium text-surface-900 dark:text-white">
                        {roleDisplayName(role.name)}
                        {!editable && (
                          <Lock size={12} className="shrink-0 text-surface-400" aria-label="Systemrolle, nicht änderbar" />
                        )}
                      </p>
                      <p className="text-xs text-surface-500">
                        {count} {count === 1 ? 'Recht' : 'Rechte'}
                      </p>
                    </div>
                    {Boolean(role.global) && role.global !== '0' && (
                      <span
                        title="Gilt organisationsweit"
                        className="flex shrink-0 items-center gap-1 rounded-full bg-surface-100 px-2 py-0.5 text-[11px] text-surface-600 dark:bg-surface-800 dark:text-surface-400"
                      >
                        <Globe size={11} /> Global
                      </span>
                    )}
                  </button>
                  {canEdit && editable && (
                    <button
                      disabled={busy}
                      onClick={() => void handleDelete(role)}
                      aria-label={`Rolle ${roleDisplayName(role.name)} löschen`}
                      className="shrink-0 rounded-lg p-1.5 text-surface-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-900/20"
                    >
                      <Trash2 size={15} />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {(creating || editing) && (
        <AdminRoleModal
          companyId={companyId}
          role={editing}
          canEdit={canEdit}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => void loadRoles()}
        />
      )}
    </div>
  );
}
