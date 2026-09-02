/**
 * Deutsche Bezeichnungen und Gruppierung der Stashcat-Rechte.
 *
 * Die Schlüssel stammen aus dem offiziellen Webclient (37 Stück, vollständig).
 * Unbekannte Schlüssel — etwa wenn Stashcat neue ergänzt — werden nicht
 * verschluckt, sondern unter „Weitere Rechte" mit ihrem Rohnamen angezeigt.
 */

export interface PermissionGroup {
  title: string;
  keys: string[];
}

export const PERMISSION_LABELS: Record<string, string> = {
  // Allgemeine Nutzung
  create_channels: 'Channels anlegen',
  create_public_channels: 'Öffentliche Channels anlegen',
  create_conversations: 'Unterhaltungen beginnen',
  create_polls: 'Umfragen erstellen',
  display_polls: 'Umfragen sehen',
  invite_channels_to_polls: 'Channels zu Umfragen einladen',
  invite_contacts_to_polls: 'Kontakte zu Umfragen einladen',

  // Nutzerverwaltung
  admin_list_users: 'Nutzerliste sehen',
  admin_add_users: 'Nutzer anlegen',
  admin_rename_users: 'Nutzer bearbeiten',
  create_users_by_link: 'Nutzer per Link anlegen',
  admin_create_users_with_invite: 'Nutzer per Einladung anlegen',
  create_users_with_invite_with_link: 'Einladungslinks für Nutzer erzeugen',
  admin_manage_invite_links: 'Einladungslinks verwalten',
  admin_list_user_devices: 'Geräte der Nutzer sehen',
  admin_delete_user_devices: 'Geräte der Nutzer abmelden',

  // Channels
  admin_list_channels: 'Alle Channels sehen',
  admin_delete_channels: 'Channels löschen',

  // Company
  admin_view_company_settings: 'Einstellungen sehen',
  admin_edit_company_settings: 'Einstellungen ändern',
  admin_view_company_roles: 'Rollen sehen',
  admin_edit_company_roles: 'Rollen ändern',
  admin_view_company_status: 'Status-Vorgaben sehen',
  admin_edit_company_status: 'Status-Vorgaben ändern',
  admin_view_company_statistics: 'Statistiken sehen',
  admin_view_email_templates: 'E-Mail-Vorlagen sehen',
  admin_edit_email_templates: 'E-Mail-Vorlagen ändern',
  admin_view_ldap_settings: 'LDAP-Einstellungen sehen',
  admin_edit_ldap_settings: 'LDAP-Einstellungen ändern',
  admin_view_connect_settings: 'Connect-Einstellungen sehen',
  admin_edit_connect_settings: 'Connect-Einstellungen ändern',

  // Organisation / Server
  admin_view_organisation_settings: 'Organisationseinstellungen sehen',
  admin_edit_organisation_settings: 'Organisationseinstellungen ändern',
  admin_list_organisations: 'Organisationen auflisten',
  admin_view_global_statistics: 'Globale Statistiken sehen',
  admin_view_backups: 'Backups sehen',
  admin_edit_backups: 'Backups verwalten',
};

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    title: 'Allgemeine Nutzung',
    keys: [
      'create_channels', 'create_public_channels', 'create_conversations',
      'create_polls', 'display_polls', 'invite_channels_to_polls', 'invite_contacts_to_polls',
    ],
  },
  {
    title: 'Nutzerverwaltung',
    keys: [
      'admin_list_users', 'admin_add_users', 'admin_rename_users',
      'create_users_by_link', 'admin_create_users_with_invite',
      'create_users_with_invite_with_link', 'admin_manage_invite_links',
      'admin_list_user_devices', 'admin_delete_user_devices',
    ],
  },
  {
    title: 'Channels',
    keys: ['admin_list_channels', 'admin_delete_channels'],
  },
  {
    title: 'Company-Verwaltung',
    keys: [
      'admin_view_company_settings', 'admin_edit_company_settings',
      'admin_view_company_roles', 'admin_edit_company_roles',
      'admin_view_company_status', 'admin_edit_company_status',
      'admin_view_company_statistics',
      'admin_view_email_templates', 'admin_edit_email_templates',
      'admin_view_ldap_settings', 'admin_edit_ldap_settings',
      'admin_view_connect_settings', 'admin_edit_connect_settings',
    ],
  },
  {
    title: 'Organisation und Server',
    keys: [
      'admin_view_organisation_settings', 'admin_edit_organisation_settings',
      'admin_list_organisations', 'admin_view_global_statistics',
      'admin_view_backups', 'admin_edit_backups',
    ],
  },
];

/** Alle Schlüssel, die einer Gruppe zugeordnet sind. */
const GROUPED = new Set(PERMISSION_GROUPS.flatMap((g) => g.keys));

/**
 * Baut die Gruppen für die Anzeige und hängt Schlüssel, die wir nicht kennen,
 * als eigene Gruppe an — damit gehen neue Rechte der API nicht verloren.
 */
export function buildPermissionGroups(present: string[]): PermissionGroup[] {
  const unknown = present.filter((k) => !GROUPED.has(k));
  return unknown.length
    ? [...PERMISSION_GROUPS, { title: 'Weitere Rechte', keys: unknown }]
    : PERMISSION_GROUPS;
}

/** Deutsche Bezeichnung, mit Rohnamen als Rückfallebene. */
export function permissionLabel(key: string): string {
  return PERMISSION_LABELS[key] ?? key;
}
