/**
 * Tab „Channels" im Admin-Bereich.
 *
 * Companyweite Sicht ueber den /manage/*-Namespace: hier erscheinen auch
 * Channels, in denen der Admin selbst kein Mitglied ist. Auswahl mehrerer
 * Channels erlaubt das Setzen der Sichtbarkeit in einem Rutsch.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Plus, Search, Loader2, Trash2, RefreshCw, AlertCircle, Hash, Lock, Eye, EyeOff,
  ChevronLeft, ChevronRight, PenOff,
} from 'lucide-react';
import { clsx } from 'clsx';
import * as api from '../api';
import type { AdminChannel, PermissionKey } from '../api/admin';
import { isFlagSet } from '../api/admin';
import { useConfirm } from '../context/ConfirmContext';
import AdminChannelModal from './AdminChannelModal';

const PAGE_SIZE = 50;

const SORT_OPTIONS: [string, string][] = [
  ['name_asc', 'Name A–Z'],
  ['name_desc', 'Name Z–A'],
  ['user_count_desc', 'Meiste Mitglieder'],
  ['last_activity_desc', 'Zuletzt aktiv'],
];

interface AdminChannelsTabProps {
  companyId: string;
  has: (...needed: PermissionKey[]) => boolean;
}

export default function AdminChannelsTab({ companyId, has }: AdminChannelsTabProps) {
  const confirm = useConfirm();

  const [channels, setChannels] = useState<AdminChannel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [sorting, setSorting] = useState('name_asc');
  const [visibleFilter, setVisibleFilter] = useState<'' | '1' | '0'>('');
  const [page, setPage] = useState(0);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<AdminChannel | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  const canEdit = has('admin_edit_channels');
  const canCreate = has('admin_create_company_channels', 'admin_edit_channels');
  const canDelete = has('admin_delete_channels');

  useEffect(() => {
    const t = setTimeout(() => { setDebouncedSearch(search); setPage(0); }, 350);
    return () => clearTimeout(t);
  }, [search]);

  const loadChannels = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    setError('');
    try {
      setChannels(await api.listAdminChannels(companyId, {
        search: debouncedSearch,
        sorting,
        visible: visibleFilter,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Channels konnten nicht geladen werden');
      setChannels([]);
    } finally {
      setLoading(false);
    }
  }, [companyId, debouncedSearch, sorting, visibleFilter, page]);

  useEffect(() => { void loadChannels(); }, [loadChannels]);
  useEffect(() => { setSelected(new Set()); }, [channels]);

  const allSelected = channels.length > 0 && selected.size === channels.length;

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(channels.map((c) => String(c.id))));
  }

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function applyVisibility(visible: boolean) {
    const ids = [...selected];
    if (!ids.length) return;
    const label = visible ? 'sichtbar' : 'unsichtbar';
    if (!await confirm(`${ids.length} Channel(s) auf ${label} setzen?`, 'Übernehmen')) return;
    setBusy(true);
    setError('');
    try {
      await api.setChannelsVisibility(companyId, ids, visible);
      setSelected(new Set());
      await loadChannels();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Änderung fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(channel: AdminChannel) {
    const ok = await confirm(
      `Channel „${channel.name}" endgültig löschen? Alle Nachrichten darin gehen verloren.`,
      'Löschen',
    );
    if (!ok) return;
    setBusy(true);
    setError('');
    try {
      await api.deleteAdminChannel(companyId, String(channel.id));
      await loadChannels();
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
            placeholder="Channel suchen…"
            className="w-full rounded-lg border border-surface-300 bg-white py-1.5 pl-9 pr-3 text-sm text-surface-900 dark:border-surface-600 dark:bg-surface-800 dark:text-white"
          />
        </div>
        <select
          value={visibleFilter}
          onChange={(e) => { setVisibleFilter(e.target.value as '' | '1' | '0'); setPage(0); }}
          aria-label="Sichtbarkeit filtern"
          className="rounded-lg border border-surface-300 bg-white px-2 py-1.5 text-sm text-surface-700 dark:border-surface-600 dark:bg-surface-800 dark:text-surface-200"
        >
          <option value="">Alle</option>
          <option value="1">Nur sichtbare</option>
          <option value="0">Nur unsichtbare</option>
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
        <button
          onClick={() => void loadChannels()}
          aria-label="Neu laden"
          title="Neu laden"
          className="rounded-lg p-1.5 text-surface-600 hover:bg-surface-200 dark:hover:bg-surface-800"
        >
          <RefreshCw size={16} className={clsx(loading && 'animate-spin')} />
        </button>
        {canCreate && (
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-primary-700"
          >
            <Plus size={15} /> <span className="hidden sm:inline">Neuer Channel</span>
          </button>
        )}
      </div>

      {/* Sammelaktionen */}
      {selected.size > 0 && canEdit && (
        <div className="flex flex-wrap items-center gap-2 border-b border-primary-200 bg-primary-50 px-4 py-2 sm:px-6 dark:border-primary-900/40 dark:bg-primary-900/20">
          <span className="text-xs font-medium text-primary-700 dark:text-primary-300">
            {selected.size} ausgewählt
          </span>
          <div className="flex-1" />
          <button
            disabled={busy}
            onClick={() => void applyVisibility(true)}
            className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-surface-700 hover:bg-white disabled:opacity-50 dark:text-surface-200 dark:hover:bg-surface-800"
          >
            <Eye size={13} /> Sichtbar
          </button>
          <button
            disabled={busy}
            onClick={() => void applyVisibility(false)}
            className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-surface-700 hover:bg-white disabled:opacity-50 dark:text-surface-200 dark:hover:bg-surface-800"
          >
            <EyeOff size={13} /> Unsichtbar
          </button>
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
        ) : channels.length === 0 ? (
          <p className="py-16 text-center text-sm text-surface-500">
            {debouncedSearch ? 'Keine Treffer.' : 'Keine Channels vorhanden.'}
          </p>
        ) : (
          <>
            {canEdit && (
              <label className="flex items-center gap-3 border-b border-surface-200 px-4 py-2 text-xs font-medium text-surface-500 sm:px-6 dark:border-surface-700">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded" />
                Alle auf dieser Seite
              </label>
            )}
            <ul>
              {channels.map((channel) => {
                const id = String(channel.id);
                const visible = isFlagSet(channel.visible);
                return (
                  <li
                    key={id}
                    className="flex items-center gap-3 border-b border-surface-100 px-4 py-3 transition hover:bg-surface-50 sm:px-6 dark:border-surface-800 dark:hover:bg-surface-800/50"
                  >
                    {canEdit && (
                      <input
                        type="checkbox"
                        checked={selected.has(id)}
                        onChange={() => toggleOne(id)}
                        aria-label={`${channel.name} auswählen`}
                        className="rounded"
                      />
                    )}
                    <button
                      onClick={() => setEditing(channel)}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-100 text-surface-500 dark:bg-surface-800 dark:text-surface-400">
                        <Hash size={17} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-surface-900 dark:text-white">
                          {channel.name}
                        </p>
                        {channel.description && (
                          <p className="truncate text-xs text-surface-500">{channel.description}</p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-1.5">
                        {isFlagSet(channel.password) && (
                          <Lock size={13} className="text-surface-400" aria-label="Passwortgeschützt" />
                        )}
                        {channel.writable === 'restricted' && (
                          <PenOff size={13} className="text-surface-400" aria-label="Eingeschränkt beschreibbar" />
                        )}
                        {typeof channel.user_count === 'number' && (
                          <span className="rounded-full bg-surface-100 px-2 py-0.5 text-[11px] font-medium text-surface-600 dark:bg-surface-800 dark:text-surface-400">
                            {channel.user_count}
                          </span>
                        )}
                        <span
                          className={clsx(
                            'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium',
                            visible
                              ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                              : 'bg-surface-100 text-surface-600 dark:bg-surface-800 dark:text-surface-400',
                          )}
                        >
                          {visible ? 'Sichtbar' : 'Versteckt'}
                        </span>
                      </div>
                    </button>
                    {canDelete && (
                      <button
                        disabled={busy}
                        onClick={() => void handleDelete(channel)}
                        aria-label={`Channel ${channel.name} löschen`}
                        className="shrink-0 rounded-lg p-1.5 text-surface-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-900/20"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </>
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
          disabled={channels.length < PAGE_SIZE || loading}
          onClick={() => setPage((p) => p + 1)}
          className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-sm text-surface-600 hover:bg-surface-100 disabled:opacity-40 dark:text-surface-400 dark:hover:bg-surface-800"
        >
          Weiter <ChevronRight size={15} />
        </button>
      </div>

      {(creating || editing) && (
        <AdminChannelModal
          companyId={companyId}
          channel={editing}
          canEdit={canEdit}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => void loadChannels()}
        />
      )}
    </div>
  );
}
