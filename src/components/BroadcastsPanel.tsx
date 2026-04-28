import { useState, useEffect, useCallback, useRef } from 'react';
import {
  X, Radio, Plus, Trash2, Users, Loader2, ArrowLeft,
  Pencil, Check, Search, UserMinus, UserPlus, UsersRound,
} from 'lucide-react';
import { clsx } from 'clsx';
import * as api from '../api';
import Avatar from './Avatar';
import MessageInput from './MessageInput';
import { useConfirm } from '../context/ConfirmContext';

interface Broadcast {
  id: number;
  user_id: number;
  name: string;
  member_count: number;
  lastAction: number;
}

interface BroadcastMessage {
  id: string;
  text: string;
  time?: number;
  sender?: { first_name?: string; last_name?: string; image?: string };
}

interface RawUser {
  id?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  image?: string;
}

interface ChannelInfo {
  id: string;
  name: string;
  member_count?: number;
  image?: string;
}

type ActiveTab = 'messages' | 'members';

interface BroadcastsPanelProps {
  onClose: () => void;
}

function userName(u: RawUser): string {
  return `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim() || u.email || String(u.id);
}

const formatTime = (ts?: number) => {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
};

export default function BroadcastsPanel({ onClose }: BroadcastsPanelProps) {
  const confirmAsync = useConfirm();
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeBroadcast, setActiveBroadcast] = useState<Broadcast | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('messages');

  // Messages
  const [messages, setMessages] = useState<BroadcastMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Create
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  // Rename
  const [renaming, setRenaming] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');

  // Members
  const [members, setMembers] = useState<RawUser[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);

  const [memberFilter, setMemberFilter] = useState('');

  // Add members — search contacts & channels
  const [showAddMembers, setShowAddMembers] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [companyUsers, setCompanyUsers] = useState<RawUser[]>([]);
  const [, setChannels] = useState<ChannelInfo[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);


  // Groups (AD/LDAP)
  const [groups, setGroups] = useState<Array<{ id: string; name: string; count: number }>>([]);
  const [showGroupsTab, setShowGroupsTab] = useState(false);
  const [groupFilter, setGroupFilter] = useState('');
  const [invitingGroup, setInvitingGroup] = useState<string | null>(null);
  const [addingProgress, setAddingProgress] = useState<{ done: number; total: number } | null>(null);

  // ── Broadcast list ──────────────────────────────────────────────────────────

  const loadBroadcasts = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.listBroadcasts();
      setBroadcasts(data as unknown as Broadcast[]);
    } catch (err) {
      console.error('Failed to load broadcasts:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadBroadcasts(); }, [loadBroadcasts]);

  // ── Open broadcast ──────────────────────────────────────────────────────────

  const openBroadcast = async (b: Broadcast) => {
    setActiveBroadcast(b);
    setActiveTab('messages');
    setShowAddMembers(false);
    loadMessages(b);
  };

  const loadMessages = async (b: Broadcast) => {
    setLoadingMessages(true);
    try {
      const msgs = await api.getBroadcastMessages(String(b.id));
      setMessages(msgs as unknown as BroadcastMessage[]);
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
    } catch (err) {
      console.error('Failed to load broadcast messages:', err);
    } finally {
      setLoadingMessages(false);
    }
  };

  const loadMembers = useCallback(async (b: Broadcast) => {
    setLoadingMembers(true);
    try {
      const data = await api.getBroadcastMembers(String(b.id));
      setMembers(data as unknown as RawUser[]);
    } catch (err) {
      console.error('Failed to load broadcast members:', err);
    } finally {
      setLoadingMembers(false);
    }
  }, []);

  const switchTab = (tab: ActiveTab) => {
    setActiveTab(tab);
    if (tab === 'members' && activeBroadcast) {
      loadMembers(activeBroadcast);
    }
  };

  // ── Load contacts + channels for add-members ───────────────────────────────

  const loadContacts = useCallback(async () => {
    setLoadingContacts(true);
    try {
      const companies = await api.getCompanies();
      if (companies.length === 0) return;
      const companyId = String(companies[0].id);
      companyIdRef.current = companyId;

      const [usersResult, chans, grps] = await Promise.all([
        api.searchCompanyMembers(companyId, { limit: 50 }),
        api.getChannels(companyId),
        api.getCompanyGroups(companyId),
      ]);
      setCompanyUsers(usersResult.users as unknown as RawUser[]);
      setGroups(grps.map((g) => ({ id: String(g.id), name: g.name, count: g.count })));
      setChannels(chans.map((ch) => ({
        id: String(ch.id),
        name: String(ch.name ?? ''),
        member_count: Number(ch.member_count ?? 0),
        image: ch.image ? String(ch.image) : undefined,
      })));
    } catch (err) {
      console.error('Failed to load contacts:', err);
    } finally {
      setLoadingContacts(false);
    }
  }, []);

  const handleShowAddMembers = () => {
    setShowAddMembers(true);
    setSearchQuery('');
    if (companyUsers.length === 0) loadContacts();
  };

  // ── Member IDs set for quick lookup ────────────────────────────────────────

  const memberIds = new Set(members.map((m) => String(m.id)));

  // ── Add single member ──────────────────────────────────────────────────────

  const handleAddMember = async (userId: string) => {
    if (!activeBroadcast) return;
    setAdding(userId);
    try {
      await api.addBroadcastMembers(String(activeBroadcast.id), [userId]);
      await loadMembers(activeBroadcast);
      // Update broadcast count
      setBroadcasts((prev) => prev.map((b) =>
        b.id === activeBroadcast.id ? { ...b, member_count: b.member_count + 1 } : b
      ));
      setActiveBroadcast((prev) => prev ? { ...prev, member_count: prev.member_count + 1 } : prev);
    } catch (err) {
      alert(`Fehler: ${err instanceof Error ? err.message : err}`);
    } finally {
      setAdding(null);
    }
  };

  // ── Remove member ──────────────────────────────────────────────────────────

  const handleRemoveMember = async (userId: string) => {
    if (!activeBroadcast) return;
    setRemoving(userId);
    try {
      await api.removeBroadcastMembers(String(activeBroadcast.id), [userId]);
      setMembers((prev) => prev.filter((m) => String(m.id) !== userId));
      setBroadcasts((prev) => prev.map((b) =>
        b.id === activeBroadcast.id ? { ...b, member_count: Math.max(0, b.member_count - 1) } : b
      ));
      setActiveBroadcast((prev) => prev ? { ...prev, member_count: Math.max(0, prev.member_count - 1) } : prev);
    } catch (err) {
      alert(`Fehler: ${err instanceof Error ? err.message : err}`);
    } finally {
      setRemoving(null);
    }
  };

  // ── CRUD helpers ───────────────────────────────────────────────────────────

  const handleSend = async (text: string) => {
    if (!activeBroadcast) return;
    await api.sendBroadcastMessage(String(activeBroadcast.id), text);
    const msgs = await api.getBroadcastMessages(String(activeBroadcast.id));
    setMessages(msgs as unknown as BroadcastMessage[]);
    setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
  };

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const created = await api.createBroadcast(newName.trim(), []);
      setNewName('');
      setShowCreate(false);
      await loadBroadcasts();
      const newBroadcast = created as unknown as Broadcast;
      setActiveBroadcast(newBroadcast);
      setActiveTab('members');
      setMembers([]);
      setShowAddMembers(true);
      setSearchQuery('');
      loadContacts();
    } catch (err) {
      alert(`Fehler: ${err instanceof Error ? err.message : err}`);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (b: Broadcast) => {
    if (!await confirmAsync(`Broadcast "${b.name}" wirklich löschen?`)) return;
    try {
      await api.deleteBroadcast(String(b.id));
      if (activeBroadcast?.id === b.id) setActiveBroadcast(null);
      await loadBroadcasts();
    } catch (err) {
      alert(`Fehler: ${err instanceof Error ? err.message : err}`);
    }
  };

  const handleRename = async (b: Broadcast) => {
    if (!renameValue.trim() || renameValue === b.name) { setRenaming(null); return; }
    try {
      await api.renameBroadcast(String(b.id), renameValue.trim());
      setRenaming(null);
      await loadBroadcasts();
    } catch (err) {
      alert(`Fehler: ${err instanceof Error ? err.message : err}`);
    }
  };

  // ── Server-side user search with debounce ──────────────────────────────────

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const companyIdRef = useRef<string>('');

  useEffect(() => {
    if (!showAddMembers || showGroupsTab) return;
    if (!companyIdRef.current) return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      try {
        const result = await api.searchCompanyMembers(companyIdRef.current, { search: searchQuery || undefined, limit: 50 });
        setCompanyUsers(result.users as unknown as RawUser[]);
      } catch (err) {
        console.error('Search failed:', err);
      }
    }, 300);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [searchQuery, showAddMembers, showGroupsTab]);

  // ── Add group members ────────────────────────────────────────────────────

  const handleInviteGroup = async (group: { id: string; name: string; count: number }) => {
    if (!activeBroadcast || !companyIdRef.current) return;
    if (!await confirmAsync(`Alle ${group.count} Mitglieder der Gruppe "${group.name}" hinzufügen?`, 'Hinzufügen')) return;
    setInvitingGroup(group.id);
    try {
      const result = await api.getGroupMembers(companyIdRef.current, group.id);
      const usersToAdd = (result.users as unknown as RawUser[]).filter((u) => !memberIds.has(String(u.id)));
      if (usersToAdd.length === 0) { alert('Alle Gruppenmitglieder sind bereits Empfänger.'); return; }

      const nameLookup = new Map(usersToAdd.map((u) => [String(u.id), userName(u)]));
      const userIds = usersToAdd.map((u) => String(u.id));
      const failedIds: string[] = [];
      let addedCount = 0;

      setAddingProgress({ done: 0, total: userIds.length });
      for (let i = 0; i < userIds.length; i += 50) {
        const batch = userIds.slice(i, i + 50);
        try {
          await api.addBroadcastMembers(String(activeBroadcast.id), batch);
          addedCount += batch.length;
        } catch {
          for (const uid of batch) {
            try {
              await api.addBroadcastMembers(String(activeBroadcast.id), [uid]);
              addedCount++;
            } catch {
              failedIds.push(uid);
            }
          }
        }
        setAddingProgress({ done: Math.min(i + 50, userIds.length), total: userIds.length });
      }

      await loadMembers(activeBroadcast);
      setBroadcasts((prev) => prev.map((b) =>
        b.id === activeBroadcast.id ? { ...b, member_count: b.member_count + addedCount } : b
      ));
      setActiveBroadcast((prev) => prev ? { ...prev, member_count: prev.member_count + addedCount } : prev);

      if (failedIds.length > 0) {
        if (failedIds.length > 20) {
          alert(`${addedCount} Empfänger hinzugefügt.\n${failedIds.length} Konten konnten nicht hinzugefügt werden (keine Berechtigung).`);
        } else {
          const names = failedIds.map((id) => nameLookup.get(id) ?? id).join('\n');
          alert(`${addedCount} Empfänger hinzugefügt.\nFolgende Konten konnten nicht hinzugefügt werden:\n${names}`);
        }
      }
    } catch (err) {
      alert(`Fehler: ${err instanceof Error ? err.message : err}`);
    } finally {
      setInvitingGroup(null);
      setAddingProgress(null);
    }
  };

  // ── Filtered contacts ──────────────────────────────────────────────────────

  const q = searchQuery.toLowerCase();
  const filteredUsers = companyUsers.filter((u) => {
    if (memberIds.has(String(u.id))) return false;
    if (!q) return true;
    return userName(u).toLowerCase().includes(q) || u.email?.toLowerCase().includes(q);
  });
  const gf = groupFilter.toLowerCase();
  const filteredGroups = groups.filter((g) => {
    if (!gf) return true;
    return g.name.toLowerCase().includes(gf);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <div className="flex h-full w-full shrink-0 flex-col border-l border-surface-200 bg-surface-50 dark:border-surface-700 dark:bg-surface-900 md:w-96">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-2 border-b border-surface-200 px-4 py-3 dark:border-surface-700">
        {activeBroadcast ? (
          <>
            <button onClick={() => { setActiveBroadcast(null); setShowAddMembers(false); }}
              className="rounded-lg p-1 text-surface-600 hover:bg-surface-200 dark:hover:bg-surface-700">
              <ArrowLeft size={16} />
            </button>
            <Radio size={16} className="shrink-0 text-primary-500" />
            <h3 className="flex-1 truncate text-sm font-semibold text-surface-900 dark:text-white">
              {activeBroadcast.name}
            </h3>
            <span className="flex items-center gap-1 text-xs text-surface-600">
              <Users size={12} /> {activeBroadcast.member_count}
            </span>
          </>
        ) : (
          <>
            <Radio size={16} className="shrink-0 text-primary-500" />
            <h3 className="flex-1 text-sm font-semibold text-surface-900 dark:text-white">Broadcasts</h3>
            <button onClick={() => setShowCreate(true)}
              className="rounded-lg p-1.5 text-primary-500 hover:bg-primary-50 dark:hover:bg-primary-900/20"
              title="Neue Broadcast-Liste">
              <Plus size={16} />
            </button>
          </>
        )}
        <button
          onClick={onClose}
          aria-label="Schließen"
          title="Schließen"
          className="shrink-0 rounded-lg p-1.5 text-surface-700 hover:bg-surface-200 dark:text-surface-200 dark:hover:bg-surface-700"
        >
          <X size={18} />
        </button>
      </div>

      {/* ── Create form ────────────────────────────────────────────────────── */}
      {showCreate && !activeBroadcast && (
        <div className="flex shrink-0 items-center gap-2 border-b border-surface-200 px-4 py-2 dark:border-surface-700">
          <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
            placeholder="Name der Broadcast-Liste..." autoFocus
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            className="flex-1 rounded-lg bg-surface-100 px-3 py-1.5 text-sm text-surface-900 outline-none placeholder:text-surface-600 dark:bg-surface-800 dark:text-white" />
          <button onClick={handleCreate} disabled={creating || !newName.trim()}
            className="rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50">
            {creating ? <Loader2 size={14} className="animate-spin" /> : 'Erstellen'}
          </button>
          <button onClick={() => { setShowCreate(false); setNewName(''); }} className="text-surface-600 hover:text-surface-600">
            <X size={14} />
          </button>
        </div>
      )}

      {/* ── Active broadcast tabs ──────────────────────────────────────────── */}
      {activeBroadcast && (
        <div className="flex shrink-0 border-b border-surface-200 dark:border-surface-700">
          <button onClick={() => switchTab('messages')}
            className={clsx('flex-1 py-2 text-xs font-medium transition',
              activeTab === 'messages'
                ? 'border-b-2 border-primary-500 text-primary-600 dark:text-primary-400'
                : 'text-surface-600 hover:text-surface-700 dark:text-surface-400')}>
            Nachrichten
          </button>
          <button onClick={() => switchTab('members')}
            className={clsx('flex-1 py-2 text-xs font-medium transition',
              activeTab === 'members'
                ? 'border-b-2 border-primary-500 text-primary-600 dark:text-primary-400'
                : 'text-surface-600 hover:text-surface-700 dark:text-surface-400')}>
            Empfänger ({activeBroadcast.member_count})
          </button>
        </div>
      )}

      {/* ═══ CONTENT ═══════════════════════════════════════════════════════ */}

      {activeBroadcast ? (
        activeTab === 'messages' ? (
          /* ── Messages tab ─────────────────────────────────────────────── */
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {loadingMessages ? (
                <div className="flex justify-center py-8"><Loader2 size={24} className="animate-spin text-primary-400" /></div>
              ) : messages.length === 0 ? (
                <p className="py-8 text-center text-sm text-surface-600">Noch keine Nachrichten</p>
              ) : (
                messages.map((msg) => (
                  <div key={msg.id} className="rounded-lg bg-white p-3 shadow-sm dark:bg-surface-800">
                    <div className="whitespace-pre-wrap text-sm text-surface-900 dark:text-surface-100">{msg.text}</div>
                    <div className="mt-1 text-xs text-surface-600">{formatTime(msg.time)}</div>
                  </div>
                ))
              )}
              <div ref={messagesEndRef} />
            </div>
            <MessageInput
              onSend={handleSend}
              onUpload={async () => {}}
              chatId={String(activeBroadcast.id)}
              chatName={activeBroadcast.name}
            />
          </div>
        ) : (
          /* ── Members tab ──────────────────────────────────────────────── */
          <div className="flex min-h-0 flex-1 flex-col">
            {/* Add members button / search */}
            {showAddMembers ? (
              <div className="shrink-0 border-b border-surface-200 p-3 dark:border-surface-700">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-surface-600">Empfänger hinzufügen</span>
                  <button onClick={() => setShowAddMembers(false)} className="text-surface-600 hover:text-surface-600">
                    <X size={14} />
                  </button>
                </div>
                {addingProgress && (
                  <div className="mb-2 rounded-lg bg-primary-50 px-3 py-2 dark:bg-primary-900/20">
                    <div className="mb-1 flex items-center gap-2">
                      <Loader2 size={13} className="shrink-0 animate-spin text-primary-500" />
                      <span className="text-xs text-primary-700 dark:text-primary-300">
                        Füge Empfänger hinzu… {addingProgress.done} / {addingProgress.total}
                      </span>
                    </div>
                    <div className="h-1 w-full overflow-hidden rounded-full bg-primary-200 dark:bg-primary-800">
                      <div
                        className="h-full rounded-full bg-primary-500 transition-all duration-300"
                        style={{ width: `${Math.round((addingProgress.done / addingProgress.total) * 100)}%` }}
                      />
                    </div>
                  </div>
                )}
                {/* Nutzer / Gruppen tabs */}
                <div className="mt-2 flex rounded-lg bg-surface-100 p-0.5 dark:bg-surface-800">
                  <button
                    onClick={() => setShowGroupsTab(false)}
                    className={clsx('flex-1 rounded-md py-1.5 text-xs font-medium transition',
                      !showGroupsTab ? 'bg-white text-surface-900 shadow-sm dark:bg-surface-700 dark:text-white' : 'text-surface-600 hover:text-surface-700')}
                  >
                    Nutzer
                  </button>
                  <button
                    onClick={() => setShowGroupsTab(true)}
                    className={clsx('flex-1 rounded-md py-1.5 text-xs font-medium transition',
                      showGroupsTab ? 'bg-white text-surface-900 shadow-sm dark:bg-surface-700 dark:text-white' : 'text-surface-600 hover:text-surface-700')}
                  >
                    Gruppen
                  </button>
                </div>

                {showGroupsTab ? (
                  /* ── Groups tab ─── */
                  <div className="mt-2">
                    <div className="flex items-center gap-2 rounded-lg bg-surface-100 px-3 py-2 dark:bg-surface-800">
                      <Search size={14} className="shrink-0 text-surface-600" />
                      <input type="text" value={groupFilter} onChange={(e) => setGroupFilter(e.target.value)}
                        placeholder="Gruppe suchen..."
                        className="w-full bg-transparent text-sm text-surface-900 outline-none placeholder:text-surface-600 dark:text-white" />
                    </div>
                    <div className="mt-2 max-h-64 overflow-y-auto">
                      {loadingContacts ? (
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
                            className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-200 disabled:opacity-50 dark:hover:bg-surface-700"
                          >
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
                              <UsersRound size={13} className="text-amber-600 dark:text-amber-400" />
                            </div>
                            <div className="min-w-0 flex-1 text-left">
                              <div className="truncate text-sm text-surface-800 dark:text-surface-200">{g.name}</div>
                              <div className="text-xs text-surface-600">{g.count} Mitglieder</div>
                            </div>
                            {invitingGroup === g.id
                              ? <Loader2 size={13} className="shrink-0 animate-spin text-primary-400" />
                              : <UserPlus size={13} className="shrink-0 text-primary-500" />}
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                ) : (
                  /* ── Users tab ─── */
                  <div className="mt-2">
                    <div className="flex items-center gap-2 rounded-lg bg-surface-100 px-3 py-2 dark:bg-surface-800">
                      <Search size={14} className="shrink-0 text-surface-600" />
                      <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Name oder E-Mail suchen..."
                        autoFocus
                        className="w-full bg-transparent text-sm text-surface-900 outline-none placeholder:text-surface-600 dark:text-white" />
                    </div>

                    <div className="mt-2 max-h-64 overflow-y-auto">
                      {loadingContacts ? (
                        <div className="flex justify-center py-4"><Loader2 size={18} className="animate-spin text-primary-400" /></div>
                      ) : filteredUsers.length > 0 ? (
                        <>
                          {filteredUsers.slice(0, 50).map((u) => {
                            const uid = String(u.id);
                            return (
                              <button key={uid} onClick={() => handleAddMember(uid)} disabled={adding === uid}
                                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-200 disabled:opacity-50 dark:hover:bg-surface-700">
                                <Avatar name={userName(u)} image={u.image} size="xs" />
                                <div className="min-w-0 flex-1 text-left">
                                  <div className="truncate text-sm text-surface-800 dark:text-surface-200">{userName(u)}</div>
                                  {u.email && <div className="truncate text-xs text-surface-600">{u.email}</div>}
                                </div>
                                {adding === uid ? <Loader2 size={13} className="shrink-0 animate-spin text-primary-400" /> : <UserPlus size={13} className="shrink-0 text-primary-500" />}
                              </button>
                            );
                          })}
                          {filteredUsers.length > 50 && (
                            <div className="px-2 py-1 text-xs text-surface-600">+{filteredUsers.length - 50} weitere — Suche eingrenzen</div>
                          )}
                        </>
                      ) : (
                        <p className="py-3 text-center text-xs text-surface-600">
                          {searchQuery ? 'Keine Treffer' : 'Keine Kontakte gefunden'}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex shrink-0 items-center justify-between border-b border-surface-200 px-4 py-2 dark:border-surface-700">
                <span className="text-xs text-surface-600">{members.length} Empfänger</span>
                <button onClick={handleShowAddMembers}
                  className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-primary-600 hover:bg-primary-50 dark:text-primary-400 dark:hover:bg-primary-900/20">
                  <UserPlus size={14} /> Hinzufügen
                </button>
              </div>
            )}

            {/* Member filter */}
            {!showAddMembers && members.length > 10 && (
              <div className="shrink-0 px-3 pb-1 pt-2">
                <div className="flex items-center gap-2 rounded-lg bg-surface-100 px-3 py-1.5 dark:bg-surface-800">
                  <Search size={13} className="shrink-0 text-surface-600" />
                  <input type="text" value={memberFilter} onChange={(e) => setMemberFilter(e.target.value)}
                    placeholder="Empfänger filtern..."
                    className="w-full bg-transparent text-sm text-surface-900 outline-none placeholder:text-surface-600 dark:text-white" />
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
                <div className="py-8 text-center">
                  <Users size={24} className="mx-auto mb-2 text-surface-300" />
                  <p className="text-sm text-surface-600">Noch keine Empfänger</p>
                  <button onClick={handleShowAddMembers}
                    className="mt-2 text-sm font-medium text-primary-500 hover:text-primary-600">
                    Jetzt hinzufügen
                  </button>
                </div>
              ) : (
                members.filter((m) => {
                  if (!memberFilter) return true;
                  const mf = memberFilter.toLowerCase();
                  return userName(m).toLowerCase().includes(mf) || m.email?.toLowerCase().includes(mf);
                }).map((m) => {
                  const uid = String(m.id);
                  return (
                    <div key={uid}
                      className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-200 dark:hover:bg-surface-800">
                      <Avatar name={userName(m)} image={m.image} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-surface-900 dark:text-surface-100">{userName(m)}</div>
                        {m.email && <div className="truncate text-xs text-surface-600">{m.email}</div>}
                      </div>
                      <button onClick={() => handleRemoveMember(uid)} disabled={removing === uid}
                        className="hidden shrink-0 rounded-md p-1 text-surface-300 transition hover:bg-red-100 hover:text-red-600 group-hover:block dark:text-surface-400 dark:hover:bg-red-900/30 dark:hover:text-red-400">
                        {removing === uid ? <Loader2 size={14} className="animate-spin" /> : <UserMinus size={14} />}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )
      ) : (
        /* ── Broadcast list ──────────────────────────────────────────────── */
        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 size={24} className="animate-spin text-primary-400" /></div>
          ) : broadcasts.length === 0 ? (
            <div className="py-8 text-center">
              <Radio size={32} className="mx-auto mb-2 text-surface-300" />
              <p className="text-sm text-surface-600">Keine Broadcast-Listen vorhanden</p>
              <button onClick={() => setShowCreate(true)}
                className="mt-2 text-sm font-medium text-primary-500 hover:text-primary-600">
                Erste Liste erstellen
              </button>
            </div>
          ) : (
            broadcasts.map((b) => (
              <div key={b.id}
                className="group flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-surface-200 dark:hover:bg-surface-800">
                <button onClick={() => openBroadcast(b)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary-100 dark:bg-primary-900/30">
                    <Radio size={14} className="text-primary-600 dark:text-primary-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    {renaming === b.id ? (
                      <div className="flex items-center gap-1">
                        <input type="text" value={renameValue} onChange={(e) => setRenameValue(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleRename(b); if (e.key === 'Escape') setRenaming(null); }}
                          onClick={(e) => e.stopPropagation()} autoFocus
                          className="w-full rounded bg-surface-100 px-1.5 py-0.5 text-sm outline-none dark:bg-surface-800 dark:text-white" />
                        <button onClick={(e) => { e.stopPropagation(); handleRename(b); }} className="text-primary-500"><Check size={14} /></button>
                      </div>
                    ) : (
                      <div className="truncate text-sm font-medium text-surface-900 dark:text-surface-100">{b.name}</div>
                    )}
                    <div className="flex items-center gap-2 text-xs text-surface-600">
                      <span>{b.member_count} Empfänger</span>
                      {b.lastAction > 0 && <span>· {formatTime(b.lastAction)}</span>}
                    </div>
                  </div>
                </button>
                {/* Hover actions */}
                <div className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
                  <button onClick={() => { setRenaming(b.id); setRenameValue(b.name); }}
                    className="rounded-md p-1 text-surface-300 hover:bg-surface-200 hover:text-surface-600 dark:text-surface-400 dark:hover:bg-surface-700"
                    title="Umbenennen">
                    <Pencil size={13} />
                  </button>
                  <button onClick={() => handleDelete(b)}
                    className="rounded-md p-1 text-surface-300 hover:bg-red-100 hover:text-red-600 dark:text-surface-400 dark:hover:bg-red-900/30 dark:hover:text-red-400"
                    title="Löschen">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
