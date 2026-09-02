/**
 * Tab „Gruppen" im Admin-Bereich.
 *
 * Liste der Company-Gruppen mit Suche, Sortierung und Blaetterfunktion.
 * Anlegen, Bearbeiten, Loeschen und die Mitgliederpflege laufen ueber
 * `AdminGroupModal`.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Plus, Search, Loader2, Trash2, RefreshCw, AlertCircle,
  ChevronLeft, ChevronRight, UsersRound, Hash, Lock,
} from 'lucide-react';
import { clsx } from 'clsx';
import * as api from '../api';
import type { AdminGroup, PermissionKey } from '../api/admin';
import { isFlagSet, groupMemberCount } from '../api/admin';
import { useConfirm } from '../context/ConfirmContext';
import AdminGroupModal from './AdminGroupModal';

const PAGE_SIZE = 50;

/**
 * `/manage/list_groups` kennt nur diese vier Sortierungen — nach Mitgliederzahl
 * kann der Server nicht sortieren, er ignoriert solche Werte stillschweigend.
 */
const SORT_OPTIONS: [string, string][] = [
  ['name_asc', 'Name A–Z'],
  ['name_desc', 'Name Z–A'],
  ['id_desc', 'Neueste zuerst'],
  ['id_asc', 'Älteste zuerst'],
];

/**
 * Die API liefert eine fehlende Beschreibung teils als "0" oder 0 statt als
 * leeren Wert. Ohne diese Prüfung stünde unter jedem Gruppennamen eine „0".
 */
function groupDescription(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  return text === '0' ? '' : text;
}

interface AdminGroupsTabProps {
  companyId: string;
  has: (...needed: PermissionKey[]) => boolean;
}

export default function AdminGroupsTab({ companyId, has }: AdminGroupsTabProps) {
  const confirm = useConfirm();

  const [groups, setGroups] = useState<AdminGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sorting, setSorting] = useState('name_asc');
  const [page, setPage] = useState(0);

  const [editing, setEditing] = useState<AdminGroup | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  const canEdit = has('admin_edit_company_groups');

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(0); }, 350);
    return () => clearTimeout(t);
  }, [search]);

  const loadGroups = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError('');
    try {
      setGroups(await api.listAdminGroups(companyId, {
        search: debouncedSearch,
        sorting,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gruppen konnten nicht geladen werden');
      setGroups([]);
    } finally {
      setLoading(false);
    }
  }, [companyId, debouncedSearch, sorting, page]);

  useEffect(() => { void loadGroups(); }, [loadGroups]);

  async function handleDelete(group: AdminGroup) {
    const ok = await confirm(
      `Gruppe „${group.name}" löschen? Die Mitglieder bleiben bestehen, verlieren aber die Gruppenzugehörigkeit.`,
      'Löschen',
    );
    if (!ok) return;
    setBusy(true);
    setError('');
    try {
      await api.deleteAdminGroup(companyId, String(group.id));
      await loadGroups();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Löschen fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Filterleiste */}
      <div className="flex flex-wrap items-center gap-2 border-b border-surface-200 px-4 py-3 sm:px-6 dark:border-surface-700">
        <div className="relative min-w-[200px] flex-1">
          <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Gruppe suchen…"
            className="w-full rounded-lg border border-surface-300 bg-white py-1.5 pl-9 pr-3 text-sm text-surface-900 dark:border-surface-600 dark:bg-surface-800 dark:text-white"
          />
        </div>
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
        <button
          onClick={() => void loadGroups()}
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
            <Plus size={15} /> <span className="hidden sm:inline">Neue Gruppe</span>
          </button>
        )}
      </div>

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
        ) : groups.length === 0 ? (
          <p className="py-16 text-center text-sm text-surface-500">
            {debouncedSearch ? 'Keine Treffer.' : 'Keine Gruppen vorhanden.'}
          </p>
        ) : (
          <ul>
            {groups.map((group) => (
              <li
                key={group.id}
                className="flex items-center gap-3 border-b border-surface-100 px-4 py-3 transition hover:bg-surface-50 sm:px-6 dark:border-surface-800 dark:hover:bg-surface-800/50"
              >
                <button
                  onClick={() => setEditing(group)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-100 text-surface-500 dark:bg-surface-800 dark:text-surface-400">
                    <UsersRound size={17} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-surface-900 dark:text-white">
                      {group.name}
                    </p>
                    {groupDescription(group.description) && (
                      <p className="truncate text-xs text-surface-500">
                        {groupDescription(group.description)}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {isFlagSet(group.create_channel) && (
                      <span
                        title="Legt automatisch einen Channel an"
                        className="flex items-center gap-1 rounded-full bg-surface-100 px-2 py-0.5 text-[11px] text-surface-600 dark:bg-surface-800 dark:text-surface-400"
                      >
                        <Hash size={11} /> Channel
                      </span>
                    )}
                    {isFlagSet(group.limit_communication) && (
                      <span
                        title="Kommunikation der Mitglieder ist eingeschränkt"
                        className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                      >
                        <Lock size={11} /> Begrenzt
                      </span>
                    )}
                    {isFlagSet(group.ldap_group) && (
                      <span
                        title="Aus dem Active Directory synchronisiert — Mitglieder lassen sich hier nicht ändern"
                        className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-700 dark:bg-sky-900/30 dark:text-sky-400"
                      >
                        AD
                      </span>
                    )}
                    {groupMemberCount(group) !== null && (
                      <span className="rounded-full bg-surface-100 px-2 py-0.5 text-[11px] font-medium text-surface-600 dark:bg-surface-800 dark:text-surface-400">
                        {groupMemberCount(group)}
                      </span>
                    )}
                  </div>
                </button>
                {canEdit && (
                  <button
                    disabled={busy}
                    onClick={() => void handleDelete(group)}
                    aria-label={`Gruppe ${group.name} löschen`}
                    className="shrink-0 rounded-lg p-1.5 text-surface-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-900/20"
                  >
                    <Trash2 size={15} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Pagination — die API liefert keine Gesamtzahl. */}
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
          disabled={groups.length < PAGE_SIZE || loading}
          onClick={() => setPage((p) => p + 1)}
          className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm text-surface-600 hover:bg-surface-100 disabled:opacity-40 dark:text-surface-400 dark:hover:bg-surface-800"
        >
          Weiter <ChevronRight size={15} />
        </button>
      </div>

      {(creating || editing) && (
        <AdminGroupModal
          companyId={companyId}
          group={editing}
          canEdit={canEdit}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => void loadGroups()}
        />
      )}
    </div>
  );
}
