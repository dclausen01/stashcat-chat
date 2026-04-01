import { useState, useEffect, useCallback } from 'react';
import { X, UserMinus, UserPlus, Search, ShieldCheck, ShieldOff, ShieldPlus, Loader2, UsersRound } from 'lucide-react';
import { clsx } from 'clsx';
import * as api from '../api';
import Avatar from './Avatar';
import { useAuth } from '../context/AuthContext';
import type { ChatTarget } from '../types';

interface RawMember {
  id?: string;
  user_id?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  image?: string;
  role?: string;
  manager?: boolean;
}

interface RawUser {
  id?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  image?: string;
}



function memberName(m: RawMember): string {
  if (m.first_name || m.last_name) return `${m.first_name ?? ''} ${m.last_name ?? ''}`.trim();
  return m.email ?? m.user_id ?? m.id ?? '?';
}

interface ChannelMembersPanelProps {
  chat: ChatTarget;
  isManager: boolean;
  onClose: () => void;
}

export default function ChannelMembersPanel({ chat, isManager: isManagerProp, onClose }: ChannelMembersPanelProps) {
  const { user } = useAuth();
  const myId = user?.id ?? '';
  const [members, setMembers] = useState<RawMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [isManagerDetected, setIsManagerDetected] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [togglingMod, setTogglingMod] = useState<string | null>(null);

  const [memberFilter, setMemberFilter] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<RawUser[]>([]);
  const [searchTotal, setSearchTotal] = useState(0);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [inviting, setInviting] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);
  const [searchTimer, setSearchTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  // Groups (AD/LDAP)
  const [groups, setGroups] = useState<Array<{ id: string; name: string; count: number }>>([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [invitingGroup, setInvitingGroup] = useState<string | null>(null);
  const [showGroups, setShowGroups] = useState(false);
  const [groupFilter, setGroupFilter] = useState('');

  const loadMembers = useCallback(async () => {
    setLoadingMembers(true);
    try {
      const raw = await api.getChannelMembers(chat.id);
      const memberList = raw as RawMember[];
      setMembers(memberList);
      const me = memberList.find(
        (m) => String(m.user_id ?? m.id) === myId
      );
      const isManager = me?.manager === true || (me?.role !== undefined && me?.role !== 'member');
      setIsManagerDetected(isManager);
    } catch (err) {
      console.error('Failed to load members:', err);
    } finally {
      setLoadingMembers(false);
    }
  }, [chat.id, myId]);

  useEffect(() => { loadMembers(); }, [loadMembers]);

  const searchUsers = useCallback(async (query: string) => {
    if (!chat.company_id) return;
    setLoadingUsers(true);
    try {
      const result = await api.searchCompanyMembers(chat.company_id, {
        search: query,
        limit: 50,
      });
      setSearchResults(result.users as unknown as RawUser[]);
      setSearchTotal(result.total);
    } catch (err) {
      console.error('Failed to search users:', err);
    } finally {
      setLoadingUsers(false);
    }
  }, [chat.company_id]);

  // Debounced search
  useEffect(() => {
    if (!showInvite) return;
    if (searchTimer) clearTimeout(searchTimer);
    const timer = setTimeout(() => {
      searchUsers(searchQuery);
    }, searchQuery ? 300 : 0);
    setSearchTimer(timer);
    return () => clearTimeout(timer);
  }, [searchQuery, showInvite]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleShowInvite = () => {
    setShowInvite(true);
    // Load groups if not yet loaded
    if (groups.length === 0 && chat.company_id) {
      setLoadingGroups(true);
      api.getCompanyGroups(chat.company_id)
        .then((g) => setGroups(g.map((gr) => ({ id: String(gr.id), name: gr.name, count: gr.count }))))
        .catch(() => {})
        .finally(() => setLoadingGroups(false));
    }
  };

  const handleRemove = async (m: RawMember) => {
    const userId = m.user_id ?? m.id;
    if (!userId || !confirm(`${memberName(m)} aus dem Channel entfernen?`)) return;
    setRemoving(userId);
    try {
      await api.removeFromChannel(chat.id, userId);
      setMembers((prev) => prev.filter((x) => (x.user_id ?? x.id) !== userId));
    } catch (err) {
      alert(`Fehler: ${err instanceof Error ? err.message : err}`);
    } finally {
      setRemoving(null);
    }
  };

  const handleToggleModerator = async (m: RawMember) => {
    const userId = m.user_id ?? m.id;
    if (!userId) return;
    const isMod = m.manager === true || m.role === 'moderator';
    const action = isMod ? 'Moderator-Rechte entziehen' : 'Zum Moderator befördern';
    if (!confirm(`${memberName(m)}: ${action}?`)) return;
    setTogglingMod(userId);
    try {
      if (isMod) {
        await api.removeModerator(chat.id, userId);
      } else {
        await api.addModerator(chat.id, userId);
      }
      await loadMembers();
    } catch (err) {
      alert(`Fehler: ${err instanceof Error ? err.message : err}`);
    } finally {
      setTogglingMod(null);
    }
  };

  const handleInvite = async (u: RawUser) => {
    const userId = String(u.id);
    setInviting(userId);
    try {
      await api.inviteToChannel(chat.id, [userId]);
      await loadMembers();
    } catch (err) {
      alert(`Fehler: ${err instanceof Error ? err.message : err}`);
    } finally {
      setInviting(null);
    }
  };

  const handleInviteGroup = async (group: { id: string; name: string; count: number }) => {
    if (!chat.company_id) return;
    if (!confirm(`Alle ${group.count} Mitglieder der Gruppe "${group.name}" einladen?`)) return;
    setInvitingGroup(group.id);
    try {
      // Get group members
      const result = await api.getGroupMembers(chat.company_id, group.id);
      const userIds = result.users.map((u) => String(u.id)).filter((uid) => !memberIds.has(uid));
      if (userIds.length === 0) {
        alert('Alle Gruppenmitglieder sind bereits im Channel.');
        return;
      }
      // Invite in batches of 50
      for (let i = 0; i < userIds.length; i += 50) {
        await api.inviteToChannel(chat.id, userIds.slice(i, i + 50));
      }
      await loadMembers();
    } catch (err) {
      alert(`Fehler: ${err instanceof Error ? err.message : err}`);
    } finally {
      setInvitingGroup(null);
    }
  };

  const canManage = isManagerDetected || isManagerProp;

  const memberIds = new Set(members.map((m) => String(m.user_id ?? m.id)));
  const filteredUsers = searchResults.filter((u) => !memberIds.has(String(u.id)));

  const filteredGroups = groups.filter((g) => {
    if (!searchQuery) return true;
    return g.name.toLowerCase().includes(searchQuery.toLowerCase());
  });

  return (
    <div className="flex h-full w-80 shrink-0 flex-col border-l border-surface-200 bg-surface-50 dark:border-surface-700 dark:bg-surface-900">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-surface-200 px-4 py-3 dark:border-surface-700">
        <h3 className="flex-1 text-sm font-semibold text-surface-900 dark:text-white">
          Mitglieder
          {!loadingMembers && <span className="ml-1 text-surface-600">({members.length})</span>}
        </h3>
        {canManage && !showInvite && (
          <button
            onClick={handleShowInvite}
            className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-primary-600 hover:bg-primary-50 dark:text-primary-400 dark:hover:bg-primary-900/20"
            title="Mitglied einladen"
          >
            <UserPlus size={14} /> Einladen
          </button>
        )}
        <button onClick={onClose} className="rounded-lg p-1.5 text-surface-600 hover:bg-surface-200 dark:hover:bg-surface-700">
          <X size={16} />
        </button>
      </div>

      {/* Invite search */}
      {showInvite && (
        <div className="shrink-0 border-b border-surface-200 p-3 dark:border-surface-700">
          <div className="mb-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-surface-600 uppercase tracking-wide">Einladen</span>
              <button
                type="button"
                onClick={() => setShowGroups(false)}
                className={clsx('rounded px-2 py-0.5 text-xs font-medium transition', !showGroups ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300' : 'text-surface-600 hover:text-surface-600')}
              >
                Nutzer
              </button>
              <button
                type="button"
                onClick={() => setShowGroups(true)}
                className={clsx('rounded px-2 py-0.5 text-xs font-medium transition', showGroups ? 'bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-300' : 'text-surface-600 hover:text-surface-600')}
              >
                Gruppen
              </button>
            </div>
            <button onClick={() => setShowInvite(false)} className="text-surface-600 hover:text-surface-600">
              <X size={14} />
            </button>
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-surface-100 px-3 py-2 dark:bg-surface-800">
            <Search size={14} className="shrink-0 text-surface-600" />
            <input
              type="text"
              value={showGroups ? groupFilter : searchQuery}
              onChange={(e) => showGroups ? setGroupFilter(e.target.value) : setSearchQuery(e.target.value)}
              placeholder={showGroups ? 'Gruppe suchen…' : 'Name oder E-Mail…'}
              autoFocus
              className="w-full bg-transparent text-sm text-surface-900 outline-none placeholder:text-surface-600 dark:text-white"
            />
          </div>

          {/* User list */}
          {!showGroups && (
            <div className="mt-2 max-h-48 overflow-y-auto">
              {loadingUsers ? (
                <div className="flex justify-center py-4"><Loader2 size={18} className="animate-spin text-primary-400" /></div>
              ) : filteredUsers.length === 0 ? (
                <p className="py-3 text-center text-xs text-surface-600">
                  {searchQuery
                    ? 'Keine Treffer'
                    : searchTotal === 0
                      ? 'Suche nach Name oder E-Mail...'
                      : 'Alle Treffer sind bereits im Channel'}
                </p>
              ) : (
                filteredUsers.map((u) => {
                  const name = `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() || u.email || String(u.id);
                  const uid = String(u.id);
                  return (
                    <button
                      key={uid}
                      onClick={() => handleInvite(u)}
                      disabled={inviting === uid}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-200 dark:hover:bg-surface-700 disabled:opacity-50"
                    >
                      <Avatar name={name} image={u.image} size="sm" />
                      <div className="min-w-0 flex-1 text-left">
                        <div className="truncate text-sm font-medium text-surface-900 dark:text-surface-100">{name}</div>
                        {u.email && <div className="truncate text-xs text-surface-600">{u.email}</div>}
                      </div>
                      {inviting === uid
                        ? <Loader2 size={14} className="shrink-0 animate-spin text-primary-400" />
                        : <UserPlus size={14} className="shrink-0 text-primary-500" />}
                    </button>
                  );
                })
              )}
            </div>
          )}

          {/* Group list */}
          {showGroups && (
            <div className="mt-2 max-h-48 overflow-y-auto">
              {loadingGroups ? (
                <div className="flex justify-center py-4"><Loader2 size={18} className="animate-spin text-primary-400" /></div>
              ) : filteredGroups.length === 0 ? (
                <p className="py-3 text-center text-xs text-surface-600">
                  {groupFilter ? 'Keine Gruppen gefunden' : 'Keine Gruppen verfügbar'}
                </p>
              ) : (
                filteredGroups.map((g) => (
                  <button
                    key={g.id}
                    onClick={() => handleInviteGroup(g)}
                    disabled={invitingGroup === g.id}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-200 dark:hover:bg-surface-700 disabled:opacity-50"
                  >
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
                      <UsersRound size={14} className="text-amber-600 dark:text-amber-400" />
                    </div>
                    <div className="min-w-0 flex-1 text-left">
                      <div className="truncate text-sm font-medium text-surface-900 dark:text-surface-100">{g.name}</div>
                      <div className="text-xs text-surface-600">{g.count} Mitglieder</div>
                    </div>
                    {invitingGroup === g.id
                      ? <Loader2 size={14} className="shrink-0 animate-spin text-primary-400" />
                      : <UserPlus size={14} className="shrink-0 text-primary-500" />}
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* Member filter */}
      {!showInvite && members.length > 10 && (
        <div className="shrink-0 px-3 pb-1 pt-2">
          <div className="flex items-center gap-2 rounded-lg bg-surface-100 px-3 py-1.5 dark:bg-surface-800">
            <Search size={13} className="shrink-0 text-surface-600" />
            <input
              type="text"
              value={memberFilter}
              onChange={(e) => setMemberFilter(e.target.value)}
              placeholder="Mitglieder filtern..."
              className="w-full bg-transparent text-sm text-surface-900 outline-none placeholder:text-surface-600 dark:text-white"
            />
            {memberFilter && (
              <button onClick={() => setMemberFilter('')} className="text-surface-600 hover:text-surface-600">
                <X size={12} />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Member list */}
      <div className="flex-1 overflow-y-auto p-2">
        {loadingMembers ? (
          <div className="flex justify-center py-8"><Loader2 size={24} className="animate-spin text-primary-400" /></div>
        ) : members.length === 0 ? (
          <p className="py-8 text-center text-sm text-surface-600">Keine Mitglieder gefunden</p>
        ) : (
          members.filter((m) => {
            if (!memberFilter) return true;
            const q = memberFilter.toLowerCase();
            return memberName(m).toLowerCase().includes(q) || m.email?.toLowerCase().includes(q);
          }).map((m) => {
            const name = memberName(m);
            const uid = m.user_id ?? m.id ?? '';
            const isModerator = m.manager === true || m.role === 'moderator';
            const isSelf = uid === myId;
            return (
              <div
                key={uid || name}
                className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-200 dark:hover:bg-surface-800"
              >
                <Avatar name={name} image={m.image} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-surface-900 dark:text-surface-100">{name}</span>
                    {isModerator && (
                      <ShieldCheck size={13} className="shrink-0 text-primary-500" />
                    )}
                  </div>
                  {m.email && <div className="truncate text-xs text-surface-600">{m.email}</div>}
                </div>

                {/* Action buttons — only for managers, not on self */}
                {canManage && !isSelf && (
                  <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                    {/* Toggle moderator */}
                    <button
                      onClick={() => handleToggleModerator(m)}
                      disabled={togglingMod === uid}
                      title={isModerator ? 'Moderator-Rechte entziehen' : 'Zum Moderator befördern'}
                      className={clsx(
                        'rounded-md p-1 transition',
                        isModerator
                          ? 'text-amber-500 hover:bg-amber-100 hover:text-amber-700 dark:hover:bg-amber-900/30'
                          : 'text-surface-300 hover:bg-primary-100 hover:text-primary-600 dark:text-surface-400 dark:hover:bg-primary-900/30 dark:hover:text-primary-400',
                        togglingMod === uid && 'opacity-50',
                      )}
                    >
                      {togglingMod === uid
                        ? <Loader2 size={14} className="animate-spin" />
                        : isModerator
                          ? <ShieldOff size={14} />
                          : <ShieldPlus size={14} />}
                    </button>

                    {/* Remove member (not on moderators) */}
                    {!isModerator && (
                      <button
                        onClick={() => handleRemove(m)}
                        disabled={removing === uid}
                        title="Entfernen"
                        className={clsx(
                          'rounded-md p-1 transition',
                          'text-surface-300 hover:bg-red-100 hover:text-red-600 dark:text-surface-400 dark:hover:bg-red-900/30 dark:hover:text-red-400',
                          removing === uid && 'opacity-50',
                        )}
                      >
                        {removing === uid
                          ? <Loader2 size={14} className="animate-spin" />
                          : <UserMinus size={14} />}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
