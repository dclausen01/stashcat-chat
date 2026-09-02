/**
 * Admin-Bereich: Huelle mit Tab-Navigation.
 *
 * Loest Company-Kontext und Rechte einmal auf (`useAdminAccess`) und reicht
 * beides an die Tabs weiter. Ein Tab erscheint nur, wenn das zugehoerige
 * Recht vorliegt — autorisiert wird trotzdem serverseitig in
 * `server/lib/admin.ts`; die Pruefungen hier blenden lediglich UI aus.
 */

import { useMemo, useState } from 'react';
import { Users, Loader2, X, ArrowLeft, ShieldCheck, UsersRound, Hash } from 'lucide-react';
import { clsx } from 'clsx';
import { useAdminAccess } from '../hooks/useAdminAccess';
import type { PermissionKey } from '../api/admin';
import AdminUsersTab from './AdminUsersTab';
import AdminGroupsTab from './AdminGroupsTab';
import AdminChannelsTab from './AdminChannelsTab';

type TabKey = 'users' | 'groups' | 'channels';

interface TabDef {
  key: TabKey;
  label: string;
  icon: typeof Users;
  /** Eines dieser Rechte genuegt, damit der Tab erscheint. */
  needs: PermissionKey[];
}

const TABS: TabDef[] = [
  { key: 'users', label: 'Nutzer', icon: Users, needs: ['admin_list_users'] },
  {
    key: 'groups',
    label: 'Gruppen',
    icon: UsersRound,
    needs: ['admin_view_company_groups', 'admin_edit_company_groups'],
  },
  {
    key: 'channels',
    label: 'Channels',
    icon: Hash,
    needs: ['admin_list_channels', 'admin_edit_channels'],
  },
];

interface AdminViewProps {
  onClose?: () => void;
}

export default function AdminView({ onClose }: AdminViewProps) {
  const { companyId, isAdmin, loading, has } = useAdminAccess();
  const [requestedTab, setRequestedTab] = useState<TabKey | null>(null);

  const visibleTabs = useMemo(
    () => TABS.filter((tab) => has(...tab.needs)),
    [has],
  );

  // Der gewaehlte Tab gilt nur, solange er sichtbar ist — sonst der erste.
  const activeTab: TabKey | undefined =
    (requestedTab && visibleTabs.some((t) => t.key === requestedTab) ? requestedTab : undefined)
    ?? visibleTabs[0]?.key;

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center bg-white dark:bg-surface-900">
        <Loader2 size={24} className="animate-spin text-surface-400" />
      </div>
    );
  }

  if (!isAdmin || visibleTabs.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-white p-8 text-center dark:bg-surface-900">
        <ShieldCheck size={32} className="text-surface-300 dark:text-surface-600" />
        <p className="text-sm text-surface-600 dark:text-surface-400">
          Für die Verwaltung fehlen dir die nötigen Rechte.
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
      {/* Kopfzeile */}
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
        <h1 className="flex-1 text-lg font-semibold text-surface-900 dark:text-white">Verwaltung</h1>
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

      {/* Tabs — nur anzeigen, wenn es etwas zu wechseln gibt */}
      {visibleTabs.length > 1 && (
        <div className="flex shrink-0 border-b border-surface-200 dark:border-surface-700">
          {visibleTabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setRequestedTab(key)}
              className={clsx(
                'flex flex-1 items-center justify-center gap-1.5 px-3 py-2.5 text-sm font-medium transition sm:flex-none sm:px-5',
                activeTab === key
                  ? 'border-b-2 border-primary-600 text-primary-600 dark:border-primary-400 dark:text-primary-400'
                  : 'text-surface-500 hover:bg-surface-100 hover:text-surface-700 dark:hover:bg-surface-800 dark:hover:text-surface-200',
              )}
            >
              <Icon size={15} />
              {label}
            </button>
          ))}
        </div>
      )}

      {activeTab === 'users' && <AdminUsersTab companyId={companyId} has={has} />}
      {activeTab === 'groups' && <AdminGroupsTab companyId={companyId} has={has} />}
      {activeTab === 'channels' && <AdminChannelsTab companyId={companyId} has={has} />}
    </div>
  );
}
