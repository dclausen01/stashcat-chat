/**
 * Admin-Bereich: Nutzerverwaltung der Company.
 *
 * Sichtbar nur fuer Nutzer mit `admin_list_users`. Alle Aktionen werden
 * zusaetzlich serverseitig autorisiert (`server/lib/admin.ts`) — die
 * Rechtepruefungen hier blenden lediglich UI aus.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Users, Plus, Search, Loader2, X, ArrowLeft, ShieldCheck, PenOff,
  UserCheck, UserX, Trash2, RefreshCw, AlertCircle, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { clsx } from 'clsx';
import * as api from '../api';
import type { AdminRole, AdminUser } from '../api/admin';
import { isUserActive, userDisplayName } from '../api/admin';
import { useAdminAccess } from '../hooks/useAdminAccess';
import { useConfirm } from '../context/ConfirmContext';
import Avatar from './Avatar';
import AdminUserModal from './AdminUserModal';

const PAGE_SIZE = 50;

type StatusFilter = '' | 'active';

const SORT_OPTIONS: [string, string][] = [
  ['last_name_asc', 'Nachname A–Z'],
  ['last_name_desc', 'Nachname Z–A'],
  ['first_name_asc', 'Vorname A–Z'],
  ['time_joined_desc', 'Neueste zuerst'],
  ['time_joined_asc', 'Älteste zuerst'],
];

interface AdminViewProps {
  onClose?: () => void;
}

export default function AdminView({ onClose }: AdminViewProps) {
  const { companyId, isAdmin, loading: accessLoading, has } = useAdminAccess();
  const confirm = useConfirm();

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [roles, setRoles] = useState<AdminRole[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('');
  const [sorting, setSorting] = useState('last_name_asc');
  const [page, setPage] = useState(0);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<AdminUser | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  const canList = has('admin_list_users');
  const canAdd = has('admin_add_users');
  const canDelete = has('admin_delete_users');

  // Suche entprellen, damit jede Eingabe nicht sofort einen Request ausloest.
  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(0); }, 350);
    return () => clearTimeout(t);
  }, [search]);

  const loadUsers = useCallback(async () => {
    if (!companyId || !canList) return;
    setLoading(true);
    setError('');
    try {
      setUsers(await api.listAdminUsers(companyId, {
        search: debouncedSearch,
        status: status || undefined,
        sorting,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nutzer konnten nicht geladen werden');
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, [companyId, canList, debouncedSearch, status, sorting, page]);

  useEffect(() => { void loadUsers(); }, [loadUsers]);

  // Rollen einmalig laden — sie aendern sich waehrend einer Sitzung praktisch nie.
  const rolesLoadedRef = useRef(false);
  useEffect(() => {
    if (!companyId || !canList || rolesLoadedRef.current) return;
    rolesLoadedRef.current = true;
    api.getAvailableRoles(companyId)
      .then(setRoles)
      .catch(() => setRoles([]));
  }, [companyId, canList]);

  // Auswahl verwerfen, sobald sich die angezeigte Menge aendert.
  useEffect(() => { setSelected(new Set()); }, [users]);

  const allSelected = users.length > 0 && selected.size === users.length;

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(users.map((u) => u.id)));
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  /** Fuehrt eine Sammelaktion aus und laedt die Liste danach neu. */
  async function runBulk(
    label: string,
    confirmLabel: string,
    fn: (ids: string[]) => Promise<void>,
  ) {
    const ids = [...selected];
    if (!ids.length) return;
    if (!await confirm(`${label} (${ids.length} Nutzer)?`, confirmLabel)) return;
    setBusy(true);
    setError('');
    try {
      await fn(ids);
      setSelected(new Set());
      await loadUsers();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Aktion fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  }

  const roleNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of roles) map.set(String(r.id), r.name);
    return map;
  }, [roles]);

  if (accessLoading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-white dark:bg-surface-900">
        <Loader2 size={24} className="animate-spin text-surface-400" />
      </div>
    );
  }

  if (!isAdmin || !canList) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-white p-8 text-center dark:bg-surface-900">
        <ShieldCheck size={32} className="text-surface-300 dark:text-surface-600" />
        <p className="text-sm text-surface-600 dark:text-surface-400">
          Für die Nutzerverwaltung fehlen dir die nötigen Rechte.
        </p>
        {onClose && (
          <button onClick={onClose} className="text-sm text-primary-600 hover:underline dark:text-primary-400">
            Zurück zum Chat
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-white dark:bg-surface-900">
      {/* Header */}
      <div className="bridge-sticky-top flex items-center gap-3 border-b border-surface-200 px-4 py-4 sm:px-6 dark:border-surface-700">
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Zurück"
            className="-ml-1 rounded-lg p-1.5 text-surface-600 hover:bg-surface-200 dark:hover:bg-surface-800 md:hidden"
          >
            <ArrowLeft size={20} />
          </button>
        )}
        <Users size={22} className="hidden text-primary-500 md:block" />
        <h1 className="flex-1 text-lg font-semibold text-surface-900 dark:text-white">Nutzerverwaltung</h1>
        <button
          onClick={() => void loadUsers()}
          aria-label="Neu laden"
          title="Neu laden"
          className="rounded-lg p-1.5 text-surface-600 hover:bg-surface-200 dark:hover:bg-surface-800"
        >
          <RefreshCw size={16} className={clsx(loading && 'animate-spin')} />
        </button>
        {canAdd && (
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700"
          >
            <Plus size={15} /> <span className="hidden sm:inline">Neuer Nutzer</span>
          </button>
        )}
        {onClose && (
          <button
            onClick={onClose}
            aria-label="Schließen"
            title="Schließen"
            className="hidden shrink-0 rounded-lg p-1.5 text-surface-700 hover:bg-surface-200 dark:text-surface-200 dark:hover:bg-surface-700 md:block"
          >
            <X size={18} />
          </button>
        )}
      </div>

      {/* Filterleiste */}
      <div className="flex flex-wrap items-center gap-2 border-b border-surface-200 px-4 py-3 sm:px-6 dark:border-surface-700">
        <div className="relative min-w-[200px] flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name oder E-Mail suchen…"
            className="w-full rounded-lg border border-surface-300 bg-white py-1.5 pl-9 pr-3 text-sm text-surface-900 dark:border-surface-600 dark:bg-surface-800 dark:text-white"
          />
        </div>
        <select
          value={status}
          onChange={(e) => { setStatus(e.target.value as StatusFilter); setPage(0); }}
          aria-label="Status filtern"
          className="rounded-lg border border-surface-300 bg-white px-2 py-1.5 text-sm text-surface-700 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-200"
        >
          <option value="">Alle Status</option>
          <option value="active">Nur aktive</option>
        </select>
        <select
          value={sorting}
          onChange={(e) => { setSorting(e.target.value); setPage(0); }}
          aria-label="Sortierung"
          className="rounded-lg border border-surface-300 bg-white px-2 py-1.5 text-sm text-surface-700 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-200"
        >
          {SORT_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      {/* Sammelaktionen */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-primary-200 bg-primary-50 px-4 py-2 sm:px-6 dark:border-primary-900/40 dark:bg-primary-900/20">
          <span className="text-xs font-medium text-primary-700 dark:text-primary-300">
            {selected.size} ausgewählt
          </span>
          <div className="flex-1" />
          <button
            disabled={busy}
            onClick={() => runBulk('Mitgliedschaften aktivieren', 'Aktivieren', (ids) => api.activateUsers(companyId, ids))}
            className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-surface-700 hover:bg-white disabled:opacity-50 dark:text-surface-200 dark:hover:bg-surface-800"
          >
            <UserCheck size={13} /> Aktivieren
          </button>
          {canDelete && (
            <>
              <button
                disabled={busy}
                onClick={() => runBulk('Mitgliedschaften deaktivieren', 'Deaktivieren', (ids) => api.deactivateUsers(companyId, ids))}
                className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-white disabled:opacity-50 dark:text-amber-400 dark:hover:bg-surface-800"
              >
                <UserX size={13} /> Deaktivieren
              </button>
              <button
                disabled={busy}
                onClick={() => runBulk('Nutzer endgültig löschen', 'Löschen', (ids) => api.deleteUsers(companyId, ids))}
                className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-white disabled:opacity-50 dark:text-red-400 dark:hover:bg-surface-800"
              >
                <Trash2 size={13} /> Löschen
              </button>
            </>
          )}
        </div>
      )}

      {error && (
        <p className="flex items-start gap-2 border-b border-red-200 bg-red-50 px-4 py-2 text-sm text-red-600 sm:px-6 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-400">
          <AlertCircle size={16} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}

      {/* Liste */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={22} className="animate-spin text-surface-400" />
          </div>
        ) : users.length === 0 ? (
          <p className="py-16 text-center text-sm text-surface-500">
            {debouncedSearch ? 'Keine Treffer.' : 'Keine Nutzer gefunden.'}
          </p>
        ) : (
          <>
            <label className="flex items-center gap-3 border-b border-surface-200 px-4 py-2 text-xs font-medium text-surface-500 sm:px-6 dark:border-surface-700">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded" />
              Alle auf dieser Seite
            </label>
            <ul>
              {users.map((user) => {
                const active = isUserActive(user);
                const roleNames = (user.roles ?? [])
                  .map((r) => roleNameById.get(String(r.id)) ?? r.name)
                  .filter(Boolean);
                return (
                  <li
                    key={user.id}
                    className="flex items-center gap-3 border-b border-surface-100 px-4 py-3 transition hover:bg-surface-50 sm:px-6 dark:border-surface-800 dark:hover:bg-surface-800/50"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(user.id)}
                      onChange={() => toggleOne(user.id)}
                      aria-label={`${userDisplayName(user)} auswählen`}
                      className="rounded"
                    />
                    <button
                      onClick={() => setEditing(user)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <Avatar name={userDisplayName(user)} image={user.image} size="sm" />
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 truncate text-sm font-medium text-surface-900 dark:text-white">
                          {userDisplayName(user)}
                          {user.admin && <ShieldCheck size={13} className="shrink-0 text-primary-500" aria-label="Administrator" />}
                          {user.read_only && <PenOff size={13} className="shrink-0 text-surface-400" aria-label="Nur lesend" />}
                        </p>
                        <p className="truncate text-xs text-surface-500">{user.email || '–'}</p>
                      </div>
                      {roleNames.length > 0 && (
                        <span className="hidden max-w-[180px] truncate text-xs text-surface-500 lg:block">
                          {roleNames.join(', ')}
                        </span>
                      )}
                      <span
                        className={clsx(
                          'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium',
                          active
                            ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                            : user.deactivated
                              ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                              : 'bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-400',
                        )}
                      >
                        {active ? 'Aktiv' : user.deactivated ? 'Deaktiviert' : 'Eingeladen'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      {/* Pagination — die API liefert keine Gesamtzahl, daher "weiter" nur
          solange eine volle Seite zurueckkam. */}
      <div className="flex shrink-0 items-center justify-between border-t border-surface-200 px-4 py-3 sm:px-6 dark:border-surface-700">
        <button
          disabled={page === 0 || loading}
          onClick={() => setPage((p) => Math.max(0, p - 1))}
          className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm text-surface-600 hover:bg-surface-100 disabled:opacity-40 dark:text-surface-400 dark:hover:bg-surface-800"
        >
          <ChevronLeft size={15} /> Zurück
        </button>
        <span className="text-xs text-surface-500">Seite {page + 1}</span>
        <button
          disabled={users.length < PAGE_SIZE || loading}
          onClick={() => setPage((p) => p + 1)}
          className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm text-surface-600 hover:bg-surface-100 disabled:opacity-40 dark:text-surface-400 dark:hover:bg-surface-800"
        >
          Weiter <ChevronRight size={15} />
        </button>
      </div>

      {(creating || editing) && (
        <AdminUserModal
          companyId={companyId}
          user={editing}
          roles={roles}
          has={has}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => void loadUsers()}
        />
      )}
    </div>
  );
}
