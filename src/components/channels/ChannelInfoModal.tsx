import { useState, useEffect } from 'react';
import { Loader2, Info, X, Lock, UsersRound, Clock, GitBranch, RefreshCw } from 'lucide-react';
import { clsx } from 'clsx';
import * as api from '../../api';
import type { ChatTarget, Channel } from '../../types';
import { getCleanName, getParentId, encodeSubchannelName } from '../../utils/subchannels';
import { getErrorMessage } from '../../utils/errorMessage';

function typeLabel(type: string): string {
  switch (type) {
    case 'closed': return 'Geschlossen';
    case 'public': return 'Öffentlich';
    case 'open': return 'Offen';
    default: return type;
  }
}

function InfoRow({ icon: Icon, label, value }: { icon: typeof Info; label: string; value: string | null | undefined }) {
  return (
    <div className="flex items-start gap-3 py-2">
      <Icon size={16} className="mt-0.5 shrink-0 text-surface-500" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-surface-500">{label}</p>
        <p className="mt-0.5 text-sm text-surface-900 dark:text-white break-all">{value ?? '—'}</p>
      </div>
    </div>
  );
}

export function ChannelInfoModal({ chat, channels, onClose }: { chat: ChatTarget; channels?: ChatTarget[]; onClose: () => void }) {
  const [info, setInfo] = useState<Channel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');

  const initialParentId = getParentId(chat.name) ?? '';
  const [selectedParentId, setSelectedParentId] = useState<string>(initialParentId);
  const [savingParent, setSavingParent] = useState(false);
  const [parentMsg, setParentMsg] = useState('');

  useEffect(() => {
    api.getChannelInfo(chat.id).then(ch => {
      setInfo(ch);
      setLoading(false);
    }).catch(err => {
      setError(getErrorMessage(err, 'Fehler beim Laden'));
      setLoading(false);
    });
  }, [chat.id]);

  const parentId = getParentId(chat.name);
  const parentChannel = parentId ? channels?.find((c) => c.id === parentId) : undefined;
  const isSubchannel = !!parentId;
  const hasOwnSubchannels = (channels ?? []).some((c) => getParentId(c.name) === chat.id);
  const eligibleParents = (channels ?? []).filter((c) =>
    c.type === 'channel'
    && c.id !== chat.id
    && !getParentId(c.name),
  );

  const handleSaveParent = async () => {
    if (selectedParentId === initialParentId) return;
    if (!chat.company_id) { setParentMsg('Keine company_id vorhanden'); return; }
    setSavingParent(true);
    setParentMsg('');
    try {
      const cleanName = getCleanName(chat.name);
      const newName = selectedParentId
        ? encodeSubchannelName(cleanName, selectedParentId)
        : cleanName;
      await api.editChannel(chat.id, chat.company_id, chat.description || '', newName);
      window.dispatchEvent(new CustomEvent('channel-renamed', { detail: { channelId: chat.id, newName } }));
      setParentMsg(selectedParentId ? 'Parent gesetzt. Tipp: "Mit Parent synchronisieren" überträgt Mitglieder.' : 'Parent entfernt.');
    } catch (err) {
      setParentMsg(getErrorMessage(err, 'Speichern fehlgeschlagen'));
    } finally {
      setSavingParent(false);
    }
  };

  const handleSync = async () => {
    if (!parentId) return;
    setSyncing(true);
    setSyncMsg('');
    try {
      const members = await api.getChannelMembers(parentId);
      const existingMembers = await api.getChannelMembers(chat.id);
      const existingIds = new Set(existingMembers.map((m) => m.id));
      const toInvite = members.filter((m) => !existingIds.has(m.id));
      if (toInvite.length > 0) {
        await api.inviteToChannel(chat.id, toInvite.map((m) => m.id));
      }
      for (const m of members) {
        if (m.manager && !existingMembers.find((e) => e.id === m.id && e.manager)) {
          try { await api.addModerator(chat.id, m.id); } catch { /* best-effort */ }
        }
      }
      setSyncMsg(toInvite.length > 0
        ? `${toInvite.length} Mitglied(er) synchronisiert.`
        : 'Bereits synchronisiert.');
    } catch (err) {
      setSyncMsg(getErrorMessage(err, 'Sync fehlgeschlagen'));
    } finally {
      setSyncing(false);
    }
  };

  const createdStr = info
    ? info.created_at
      ? new Date(Number(info.created_at) * 1000).toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' })
      : info.last_activity
      ? `Zuletzt aktiv: ${new Date(Number(info.last_activity) * 1000).toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' })}`
      : 'Unbekannt'
    : 'Unbekannt';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md rounded-2xl bg-white shadow-2xl dark:bg-surface-900"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-surface-200 px-6 py-4 dark:border-surface-700">
          <div className="flex items-center gap-2">
            <Info size={18} className="text-primary-500" />
            <h2 className="text-base font-semibold text-surface-900 dark:text-white">Channel-Info</h2>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-surface-500 hover:bg-surface-200 dark:hover:bg-surface-700">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-4">
          {loading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 size={24} className="animate-spin text-surface-500" />
            </div>
          )}
          {error && (
            <p className="text-center text-sm text-red-500 py-4">{error}</p>
          )}
          {!loading && !error && info && (
            <div className="space-y-0">
              <div className="mb-4 border-b border-surface-200 pb-4 dark:border-surface-700">
                <h3 className="text-xl font-bold text-surface-900 dark:text-white">{getCleanName(String(info.name || ''))}</h3>
                <p className="mt-1">
                  <span className={clsx(
                    'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                    info.type === 'closed'
                      ? 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                      : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
                  )}>
                    {typeLabel(String(info.type || ''))}
                  </span>
                </p>
              </div>

              <InfoRow icon={Lock} label="Verschlüsselung" value={info.encrypted ? `AES 256 (${info.encryption || 'AES'})` : 'Keine'} />
              <InfoRow icon={UsersRound} label="Mitglieder" value={String(info.user_count ?? 0)} />
              <InfoRow icon={Clock} label="Erstellt" value={createdStr} />
              {!!info.description && (
                <InfoRow icon={Info} label="Beschreibung" value={String(info.description)} />
              )}
              {(eligibleParents.length > 0 || isSubchannel) && (
                <div className="flex items-start gap-3 py-2">
                  <GitBranch size={16} className="mt-0.5 shrink-0 text-surface-500" />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-surface-500">Übergeordneter Channel</p>
                    {hasOwnSubchannels ? (
                      <p className="mt-1 text-xs text-surface-500">
                        Dieser Channel hat selbst Subkanäle und kann deshalb keinem Parent zugeordnet werden (max. eine Ebene).
                      </p>
                    ) : (
                      <>
                        <select
                          value={selectedParentId}
                          onChange={(e) => { setSelectedParentId(e.target.value); setParentMsg(''); }}
                          className="mt-1 w-full rounded-lg border border-surface-300 bg-white px-2 py-1.5 text-sm text-surface-900 outline-none transition focus:border-primary-500 dark:border-surface-600 dark:bg-surface-800 dark:text-white"
                        >
                          <option value="">— Kein Parent —</option>
                          {parentChannel && !eligibleParents.find((c) => c.id === parentChannel.id) && (
                            <option value={parentChannel.id}>{getCleanName(parentChannel.name)}</option>
                          )}
                          {eligibleParents.map((c) => (
                            <option key={c.id} value={c.id}>{getCleanName(c.name)}</option>
                          ))}
                        </select>
                        {selectedParentId !== initialParentId && (
                          <button
                            onClick={handleSaveParent}
                            disabled={savingParent}
                            className="mt-2 flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-primary-700 disabled:opacity-50"
                          >
                            {savingParent ? <Loader2 size={12} className="animate-spin" /> : null}
                            Parent speichern
                          </button>
                        )}
                        {parentMsg && <p className="mt-1.5 text-xs text-surface-500">{parentMsg}</p>}
                      </>
                    )}
                  </div>
                </div>
              )}
              {parentId && (
                <div className="mt-3 border-t border-surface-200 pt-3 dark:border-surface-700">
                  <button
                    onClick={handleSync}
                    disabled={syncing}
                    className="flex items-center gap-2 rounded-lg border border-surface-300 px-3 py-2 text-sm text-surface-700 transition hover:bg-surface-100 disabled:opacity-50 dark:border-surface-600 dark:text-surface-300 dark:hover:bg-surface-800"
                  >
                    {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                    Mit Parent synchronisieren
                  </button>
                  {syncMsg && <p className="mt-1.5 text-xs text-surface-500">{syncMsg}</p>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
