/**
 * Modal zum Anlegen und Bearbeiten eines Channels aus der Administration.
 *
 * Im Bearbeiten-Modus zusaetzlich die Mitgliederliste mit Moderatoren-Schalter
 * sowie die Channel-Statistik.
 */

import { useCallback, useEffect, useState } from 'react';
import { X, Loader2, AlertCircle, Shield, ShieldOff, Search, UserPlus, UserMinus, UsersRound, Check } from 'lucide-react';
import { clsx } from 'clsx';
import * as api from '../api';
import type { AdminChannel, AdminGroup, AdminUser } from '../api/admin';
import { isFlagSet, userDisplayName } from '../api/admin';
import Avatar from './Avatar';
import { useConfirm } from '../context/ConfirmContext';

interface AdminChannelModalProps {
  companyId: string;
  /** `null` = Anlegen-Modus. */
  channel: AdminChannel | null;
  canEdit: boolean;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * Kennzahlen aus `/manage/get_channel_statistics`. Feldnamen gegen den
 * offiziellen Webclient verifiziert.
 */
interface ChannelStatistics {
  num_messages_sent_total?: number;
  num_messages_read_total?: number;
  num_messages_sent_historical?: Array<{ year: number; month: number; num_messages: number }>;
}

const MONTHS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

function formatCount(value: number | undefined): string {
  return typeof value === 'number' ? value.toLocaleString('de-DE') : '–';
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
  const [stats, setStats] = useState<ChannelStatistics | null>(null);

  // Nutzersuche zum Einschreiben. Es gibt keinen /manage/*-Endpunkt dafuer —
  // wir nutzen den regulaeren Channel-Einladungsweg, siehe Serverroute.
  const [userSearch, setUserSearch] = useState('');
  const [candidates, setCandidates] = useState<AdminUser[]>([]);
  const [searching, setSearching] = useState(false);
  const confirm = useConfirm();

  // Ganze Gruppen (z. B. Klassen) einschreiben. Der Server loest die Gruppe in
  // ihre Mitglieder auf — einen nativen Endpunkt dafuer gibt es nicht.
  const [groupSearch, setGroupSearch] = useState('');
  const [groupCandidates, setGroupCandidates] = useState<AdminGroup[]>([]);
  const [groupSearching, setGroupSearching] = useState(false);
  const [notice, setNotice] = useState('');

  // Eigener Zugang: Einladen setzt Mitgliedschaft voraus, bei verschluesselten
  // Channels zusaetzlich den Chat-Schluessel. Ohne den laesst sich niemand
  // einladen — siehe CLAUDE.md, Abschnitt „Channel-Einladungen".
  const [access, setAccess] = useState<api.ChannelAccess | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  // Eigene Meldung direkt am Einschreib-Knopf. `notice`/`error` stehen ganz
  // oben im Modal — bei aufgeklapptem Mitgliederbereich ausserhalb des
  // sichtbaren Bereichs, die Rueckmeldung ginge dort unter.
  const [enrollNote, setEnrollNote] = useState('');

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

  const loadAccess = useCallback(async () => {
    if (isCreate || !channel) return;
    try {
      setAccess(await api.getChannelAccess(companyId, String(channel.id)));
    } catch {
      setAccess(null);
    }
  }, [companyId, channel, isCreate]);

  useEffect(() => { void loadAccess(); }, [loadAccess]);

  async function selfEnroll() {
    if (!channel) return;
    setError('');
    setNotice('');
    setEnrollNote('');
    setEnrolling(true);
    try {
      const result = await api.selfEnrollInChannel(companyId, String(channel.id));
      // Der Server meldet nachgeprüft zurück, ob wirklich eine Mitgliedschaft
      // entstanden ist — `success` allein sagt nur, dass er den Aufruf
      // angenommen hat.
      if (!result.member) {
        setEnrollNote(
          result.success
            ? 'Der Server hat den Aufruf angenommen, dich aber nicht als Mitglied eingetragen. '
              + 'Über den Admin-Bereich lässt sich dieser Channel damit nicht betreten.'
            : 'Der Server hat das Einschreiben abgelehnt.',
        );
      } else if (result.hasKey) {
        setEnrollNote('Du bist jetzt eingeschrieben und hast den Chat-Schlüssel — Einladen ist möglich.');
      } else {
        setEnrollNote(
          'Du bist eingeschrieben'
          + (result.joined
            ? ' und der Channel steht jetzt in deiner Seitenleiste.'
            : `, der Beitritt zur Channel-Liste hat aber nicht geklappt${result.joinError ? ` (${result.joinError})` : ''}.`)
          + ' Der Chat-Schlüssel fehlt noch — ein bestehendes Mitglied muss ihn freigeben. '
          + 'Danach auf „Erneut prüfen" klicken.',
        );
      }
      await Promise.all([loadAccess(), loadMembers()]);
      onSaved();
    } catch (err) {
      setEnrollNote(err instanceof Error ? err.message : 'Einschreiben fehlgeschlagen');
    } finally {
      setEnrolling(false);
    }
  }

  async function selfUnenroll() {
    if (!channel) return;
    if (!await confirm(`Dich selbst aus „${channel.name}" austragen?`, 'Austragen')) return;
    setError('');
    setNotice('');
    setEnrollNote('');
    setEnrolling(true);
    try {
      await api.selfUnenrollFromChannel(companyId, String(channel.id));
      setEnrollNote('Du wurdest aus dem Channel ausgetragen.');
      await Promise.all([loadAccess(), loadMembers()]);
      onSaved();
    } catch (err) {
      setEnrollNote(err instanceof Error ? err.message : 'Austragen fehlgeschlagen');
    } finally {
      setEnrolling(false);
    }
  }

  // Statistik ist ein Extra — schlaegt sie fehl, bleibt der Rest nutzbar.
  useEffect(() => {
    if (isCreate || !channel) return;
    api.getChannelStatistics(companyId, String(channel.id))
      .then((s) => setStats(s as ChannelStatistics))
      .catch(() => setStats(null));
  }, [companyId, channel, isCreate]);

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

  useEffect(() => {
    if (isCreate || groupSearch.trim().length < 2) {
      setGroupCandidates([]);
      return;
    }
    let cancelled = false;
    const t = setTimeout(async () => {
      setGroupSearching(true);
      try {
        const found = await api.listAdminGroups(companyId, { search: groupSearch.trim(), limit: 20 });
        if (!cancelled) setGroupCandidates(found);
      } catch {
        if (!cancelled) setGroupCandidates([]);
      } finally {
        if (!cancelled) setGroupSearching(false);
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
  }, [groupSearch, companyId, isCreate]);

  async function inviteGroup(group: AdminGroup) {
    if (!channel) return;
    if (!await confirm(
      `Alle Mitglieder von „${group.name}" in „${channel.name}" einschreiben?`,
      'Einschreiben',
    )) return;
    setError('');
    setNotice('');
    setSaving(true);
    try {
      const result = await api.inviteGroupToChannel(companyId, String(channel.id), String(group.id));
      setGroupSearch('');
      setGroupCandidates([]);
      if (result.alreadyComplete) {
        setNotice(`Alle Mitglieder von „${group.name}" sind bereits im Channel.`);
      } else {
        setNotice(
          `${result.invited} Mitglied(er) aus „${group.name}" eingeladen`
          + (result.skipped ? `, ${result.skipped} waren bereits drin. ` : '. ')
          + 'Eingeladene erscheinen erst in der Liste, wenn sie die Einladung angenommen haben.',
        );
      }
      await loadMembers();
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gruppe konnte nicht eingeladen werden');
    } finally {
      setSaving(false);
    }
  }

  async function addMember(user: AdminUser) {
    if (!channel) return;
    setError('');
    setNotice('');
    setSaving(true);
    try {
      await api.addChannelMembers(companyId, String(channel.id), [user.id]);
      setUserSearch('');
      setCandidates([]);
      // Eine Einladung macht noch kein Mitglied — bis zur Annahme taucht der
      // Nutzer in `list_channel_members` nicht auf. Ohne diesen Hinweis sieht
      // ein erfolgreicher Aufruf wie ein wirkungsloser aus.
      setNotice(
        `${userDisplayName(user)} wurde eingeladen. Die Einladung muss noch angenommen werden — `
        + 'bis dahin erscheint der Eintrag nicht in der Mitgliederliste.',
      );
      await loadMembers();
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Einladen fehlgeschlagen');
    } finally {
      setSaving(false);
    }
  }

  async function removeMember(user: AdminUser) {
    if (!channel) return;
    if (!await confirm(`${userDisplayName(user)} aus „${channel.name}" entfernen?`, 'Entfernen')) return;
    setError('');
    setSaving(true);
    try {
      await api.removeChannelMember(companyId, String(channel.id), user.id);
      await loadMembers();
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Entfernen fehlgeschlagen');
    } finally {
      setSaving(false);
    }
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
          {notice && (
            <p className="mb-4 flex items-start gap-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-900/20 dark:text-green-400">
              <Check size={16} className="mt-0.5 shrink-0" /> {notice}
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
              <div className="mb-4 grid grid-cols-2 gap-3">
                <div className="rounded-lg bg-surface-50 px-3 py-2 dark:bg-surface-800/50">
                  <p className="text-lg font-semibold text-surface-900 dark:text-white">
                    {formatCount(stats.num_messages_sent_total)}
                  </p>
                  <p className="text-[11px] text-surface-500">Nachrichten gesendet</p>
                </div>
                <div className="rounded-lg bg-surface-50 px-3 py-2 dark:bg-surface-800/50">
                  <p className="text-lg font-semibold text-surface-900 dark:text-white">
                    {formatCount(stats.num_messages_read_total)}
                  </p>
                  <p className="text-[11px] text-surface-500">Nachrichten gelesen</p>
                </div>
              </div>
              {stats.num_messages_sent_historical && stats.num_messages_sent_historical.length > 0 && (
                <>
                  <p className="mb-1.5 text-[11px] font-medium text-surface-500">Verlauf</p>
                  <ul className="space-y-0.5">
                    {stats.num_messages_sent_historical.map((entry) => (
                      <li
                        key={`${entry.year}-${entry.month}`}
                        className="flex items-baseline justify-between gap-2 text-xs"
                      >
                        <span className="text-surface-600 dark:text-surface-400">
                          {MONTHS[entry.month - 1] ?? entry.month} {entry.year}
                        </span>
                        <span className="tabular-nums text-surface-800 dark:text-surface-200">
                          {formatCount(entry.num_messages)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}

          {/* --- Mitglieder --- */}
          {!isCreate && channel && (
            <div className="mt-6 border-t border-surface-200 pt-5 dark:border-surface-700">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-surface-500">
                Mitglieder {members ? `(${members.length})` : ''}
              </h3>
              {canEdit && !access?.canInvite && (
                <div className="mb-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-700/60 dark:bg-amber-900/20 dark:text-amber-200">
                  {!access?.member ? (
                    <>
                      <p>
                        Du bist kein Mitglied dieses Channels. Einladungen setzen eine eigene
                        Mitgliedschaft voraus — bei verschlüsselten Channels zusätzlich den
                        Chat-Schlüssel, den nur Mitglieder besitzen.
                      </p>
                      <button
                        type="button"
                        disabled={enrolling}
                        onClick={() => void selfEnroll()}
                        className="mt-2 rounded-md bg-amber-600 px-2.5 py-1 font-medium text-white transition hover:bg-amber-700 disabled:opacity-50"
                      >
                        {enrolling ? 'Wird eingeschrieben…' : 'Selbst einschreiben'}
                      </button>
                      {enrollNote && <p className="mt-2 font-medium">{enrollNote}</p>}
                    </>
                  ) : (
                    <>
                      <p>
                        Du bist eingeschrieben, hast aber noch keinen Chat-Schlüssel. Ein
                        bestehendes Mitglied muss ihn freigeben — erst danach kannst du
                        andere einladen.
                      </p>
                      <button
                        type="button"
                        disabled={enrolling}
                        onClick={() => void loadAccess()}
                        className="mt-2 rounded-md border border-amber-500 px-2.5 py-1 font-medium transition hover:bg-amber-100 disabled:opacity-50 dark:hover:bg-amber-900/40"
                      >
                        Erneut prüfen
                      </button>
                      {enrollNote && <p className="mt-2 font-medium">{enrollNote}</p>}
                    </>
                  )}
                </div>
              )}

              {canEdit && access?.member && (
                <button
                  type="button"
                  disabled={enrolling}
                  onClick={() => void selfUnenroll()}
                  className="mb-3 text-xs text-surface-500 underline transition hover:text-surface-700 disabled:opacity-50 dark:hover:text-surface-300"
                >
                  Mich selbst aus diesem Channel austragen
                </button>
              )}

              {canEdit && access?.canInvite && enrollNote && (
                <p className="mb-3 text-xs text-surface-600 dark:text-surface-400">{enrollNote}</p>
              )}

              {canEdit && access?.canInvite && (
                <div className="mb-3">
                  <div className="relative">
                    <UsersRound size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
                    <input
                      value={groupSearch}
                      onChange={(e) => setGroupSearch(e.target.value)}
                      placeholder="Ganze Gruppe einschreiben (z. B. Klasse)…"
                      className="w-full rounded-lg border border-surface-300 bg-white py-1.5 pl-9 pr-3 text-sm text-surface-900 dark:border-surface-600 dark:bg-surface-800 dark:text-white"
                    />
                  </div>
                  {groupSearching && <Loader2 size={14} className="mt-2 animate-spin text-surface-400" />}
                  {groupCandidates.length > 0 && (
                    <ul className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-surface-200 dark:border-surface-700">
                      {groupCandidates.map((group) => (
                        <li key={String(group.id)}>
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => void inviteGroup(group)}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-surface-50 disabled:opacity-40 dark:hover:bg-surface-800"
                          >
                            <UsersRound size={14} className="shrink-0 text-surface-400" />
                            <span className="min-w-0 flex-1 truncate">{group.name}</span>
                            <UserPlus size={14} className="shrink-0 text-primary-500" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

              {canEdit && access?.canInvite && (
                <div className="mb-3">
                  <div className="relative">
                    <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-surface-400" />
                    <input
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                      placeholder="Nutzer suchen und einschreiben…"
                      className="w-full rounded-lg border border-surface-300 bg-white py-1.5 pl-9 pr-3 text-sm text-surface-900 dark:border-surface-600 dark:bg-surface-800 dark:text-white"
                    />
                  </div>
                  {searching && <Loader2 size={14} className="mt-2 animate-spin text-surface-400" />}
                  {candidates.length > 0 && (
                    <ul className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-surface-200 dark:border-surface-700">
                      {candidates.map((user) => {
                        const alreadyIn = (members ?? []).some((m) => m.id === user.id);
                        return (
                          <li key={user.id}>
                            <button
                              type="button"
                              disabled={saving || alreadyIn}
                              onClick={() => void addMember(user)}
                              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition hover:bg-surface-50 disabled:opacity-40 dark:hover:bg-surface-800"
                            >
                              <Avatar name={userDisplayName(user)} image={user.image} size="xs" />
                              <span className="min-w-0 flex-1 truncate">{userDisplayName(user)}</span>
                              {alreadyIn
                                ? <span className="shrink-0 text-xs text-surface-400">bereits drin</span>
                                : <UserPlus size={14} className="shrink-0 text-primary-500" />}
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}

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
                        {canEdit && (
                          <button
                            type="button"
                            disabled={saving}
                            title="Aus dem Channel entfernen"
                            aria-label={`${userDisplayName(user)} aus dem Channel entfernen`}
                            onClick={() => void removeMember(user)}
                            className="shrink-0 rounded-lg p-1 text-surface-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:hover:bg-red-900/20"
                          >
                            <UserMinus size={14} />
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
