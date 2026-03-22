import { useState, useEffect, useCallback } from 'react';
import { X, UserMinus, UserPlus, Search, ShieldCheck, Loader2 } from 'lucide-react';
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
  const myId = String((user as Record<string, unknown>)?.id || '');
  const [members, setMembers] = useState<RawMember[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(true);
  const [isManagerDetected, setIsManagerDetected] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [companyUsers, setCompanyUsers] = useState<RawUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [inviting, setInviting] = useState<string | null>(null);
  const [showInvite, setShowInvite] = useState(false);

  const loadMembers = useCallback(async () => {
    setLoadingMembers(true);
    try {
      const raw = await api.getChannelMembers(chat.id);
      const memberList = raw as RawMember[];
      setMembers(memberList);
      // Detect manager status from loaded members (more reliable than ChatView's detection)
      const me = memberList.find(
        (m) => String(m.user_id ?? m.id) === myId
      );
      const myRole = me?.role;
      console.log('[ChannelMembersPanel] myId=', myId, 'me=', me, 'role=', myRole);
      setIsManagerDetected(!!me && myRole !== 'member' && myRole !== undefined);
    } catch (err) {
      console.error('Failed to load members:', err);
    } finally {
      setLoadingMembers(false);
    }
  }, [chat.id, myId]);

  useEffect(() => { loadMembers(); }, [loadMembers]);

  const loadCompanyUsers = useCallback(async () => {
    if (!chat.company_id) return;
    setLoadingUsers(true);
    try {
      const raw = await api.getCompanyMembers(chat.company_id);
      setCompanyUsers(raw as RawUser[]);
    } catch (err) {
      console.error('Failed to load company users:', err);
    } finally {
      setLoadingUsers(false);
    }
  }, [chat.company_id]);

  const handleShowInvite = () => {
    setShowInvite(true);
    if (companyUsers.length === 0) loadCompanyUsers();
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

  const handleInvite = async (u: RawUser) => {
    const userId = String(u.id);
    setInviting(userId);
    try {
      await api.inviteToChannel(chat.id, [userId]);
      await loadMembers();
      setShowInvite(false);
    } catch (err) {
      alert(`Fehler: ${err instanceof Error ? err.message : err}`);
    } finally {
      setInviting(null);
    }
  };

  // Use detected role from loaded members; fall back to prop from ChatView
  const canManage = isManagerDetected || isManagerProp;

  const memberIds = new Set(members.map((m) => String(m.user_id ?? m.id)));
  const filteredUsers = companyUsers.filter((u) => {
    if (memberIds.has(String(u.id))) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      u.first_name?.toLowerCase().includes(q) ||
      u.last_name?.toLowerCase().includes(q) ||
      u.email?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="flex h-full w-80 shrink-0 flex-col border-l border-surface-200 bg-surface-50 dark:border-surface-700 dark:bg-surface-900">
      {/* Header */}
      <div className="flex shrink-0 items-center gap-2 border-b border-surface-200 px-4 py-3 dark:border-surface-700">
        <h3 className="flex-1 text-sm font-semibold text-surface-900 dark:text-white">
          Mitglieder
          {!loadingMembers && <span className="ml-1 text-surface-400">({members.length})</span>}
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
        <button onClick={onClose} className="rounded-lg p-1.5 text-surface-400 hover:bg-surface-200 dark:hover:bg-surface-700">
          <X size={16} />
        </button>
      </div>

      {/* Invite search */}
      {showInvite && (
        <div className="shrink-0 border-b border-surface-200 p-3 dark:border-surface-700">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-surface-500 uppercase tracking-wide">Nutzer einladen</span>
            <button onClick={() => setShowInvite(false)} className="text-surface-400 hover:text-surface-600">
              <X size={14} />
            </button>
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-surface-100 px-3 py-2 dark:bg-surface-800">
            <Search size={14} className="shrink-0 text-surface-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Name oder E-Mail…"
              autoFocus
              className="w-full bg-transparent text-sm text-surface-900 outline-none placeholder:text-surface-400 dark:text-white"
            />
          </div>
          <div className="mt-2 max-h-48 overflow-y-auto">
            {loadingUsers ? (
              <div className="flex justify-center py-4"><Loader2 size={18} className="animate-spin text-primary-400" /></div>
            ) : filteredUsers.length === 0 ? (
              <p className="py-3 text-center text-xs text-surface-400">
                {searchQuery ? 'Keine Treffer' : 'Alle Firmenmitglieder sind bereits im Channel'}
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
                      {u.email && <div className="truncate text-xs text-surface-400">{u.email}</div>}
                    </div>
                    {inviting === uid
                      ? <Loader2 size={14} className="shrink-0 animate-spin text-primary-400" />
                      : <UserPlus size={14} className="shrink-0 text-primary-500" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Member list */}
      <div className="flex-1 overflow-y-auto p-2">
        {loadingMembers ? (
          <div className="flex justify-center py-8"><Loader2 size={24} className="animate-spin text-primary-400" /></div>
        ) : members.length === 0 ? (
          <p className="py-8 text-center text-sm text-surface-400">Keine Mitglieder gefunden</p>
        ) : (
          members.map((m) => {
            const name = memberName(m);
            const uid = m.user_id ?? m.id ?? '';
            const isModerator = m.role === 'moderator';
            return (
              <div
                key={uid || name}
                className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-100 dark:hover:bg-surface-800"
              >
                <Avatar name={name} image={m.image} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-surface-900 dark:text-surface-100">{name}</span>
                    {isModerator && (
                      <ShieldCheck size={13} className="shrink-0 text-primary-500" title="Moderator" />
                    )}
                  </div>
                  {m.email && <div className="truncate text-xs text-surface-400">{m.email}</div>}
                </div>
                {canManage && !isModerator && (
                  <button
                    onClick={() => handleRemove(m)}
                    disabled={removing === uid}
                    title="Entfernen"
                    className={clsx(
                      'shrink-0 rounded-md p-1 transition',
                      'text-surface-300 hover:bg-red-100 hover:text-red-600 dark:text-surface-600 dark:hover:bg-red-900/30 dark:hover:text-red-400',
                      removing === uid && 'opacity-50',
                    )}
                  >
                    {removing === uid
                      ? <Loader2 size={14} className="animate-spin" />
                      : <UserMinus size={14} />}
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
