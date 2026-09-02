/**
 * Deutsche Bezeichnungen und Gruppierung der Stashcat-Rechte und -Rollen.
 *
 * Die 64 Rechte-Schlüssel stammen vollständig aus dem Rechte-Modell des
 * offiziellen Webclients. Schlüssel, die die API darüber hinaus liefert,
 * werden nicht verschluckt, sondern unter „Weitere Rechte" mit ihrem Rohnamen
 * angezeigt — sonst gingen sie beim Speichern verloren.
 */

export interface PermissionGroup {
  title: string;
  keys: string[];
}

export const PERMISSION_LABELS: Record<string, string> = {
  // Kommunikation
  create_channels: 'Channels anlegen',
  create_public_channels: 'Öffentliche Channels anlegen',
  create_conversations: 'Unterhaltungen beginnen',
  create_broadcast_messages: 'Broadcast-Nachrichten verschicken',
  create_voip_calls: 'Audio- und Videochat',
  invite_contact_group_to_channel: 'Kontaktgruppen in Channels einladen',
  channel_export: 'Channel-Verlauf exportieren',
  list_users: 'Nutzerliste anzeigen',
  create_webhooks: 'Webhooks anlegen',

  // Termine und Umfragen
  create_personal_events: 'Eigene Kalendereinträge anlegen',
  create_channel_events: 'Channels zu Terminen einladen',
  create_company_events: 'Unternehmensweite Termine anlegen',
  create_polls: 'Umfragen erstellen',
  display_polls: 'Umfragen sehen',
  invite_channels_to_polls: 'Channels zu Umfragen einladen',
  invite_contacts_to_polls: 'Kontakte zu Umfragen einladen',

  // Nutzerverwaltung
  admin_list_users: 'Nutzerliste verwalten',
  admin_add_users: 'Nutzer anlegen',
  admin_rename_users: 'Nutzer bearbeiten',
  admin_delete_users: 'Nutzer löschen',
  create_users_by_link: 'Nutzer per Link anlegen',
  admin_create_users_with_invite: 'Nutzer per Einladung anlegen',
  create_users_with_invite_with_link: 'Einladungslinks für Nutzer erzeugen',
  admin_manage_invite_links: 'Einladungslinks verwalten',
  admin_list_user_devices: 'Geräte der Nutzer sehen',
  admin_delete_user_devices: 'Geräte der Nutzer abmelden',

  // Channels und Gruppen verwalten
  admin_list_channels: 'Alle Channels sehen',
  admin_create_company_channels: 'Unternehmens-Channels anlegen',
  admin_edit_channels: 'Channels bearbeiten',
  admin_delete_channels: 'Channels löschen',
  admin_view_company_groups: 'Gruppen sehen',
  admin_edit_company_groups: 'Gruppen bearbeiten',

  // Unternehmen
  admin_view_company_settings: 'Einstellungen sehen',
  admin_edit_company_settings: 'Einstellungen ändern',
  admin_edit_company_settings_message_ttl: 'Aufbewahrungsdauer von Nachrichten ändern',
  admin_view_company_roles: 'Rollen sehen',
  admin_edit_company_roles: 'Rollen ändern',
  admin_create_global_roles: 'Organisationsweite Rollen anlegen',
  admin_view_company_status: 'Status-Vorgaben sehen',
  admin_edit_company_status: 'Status-Vorgaben ändern',
  admin_view_company_statistics: 'Statistiken sehen',
  admin_view_email_templates: 'E-Mail-Vorlagen sehen',
  admin_edit_email_templates: 'E-Mail-Vorlagen ändern',
  admin_view_ldap_settings: 'LDAP-Einstellungen sehen',
  admin_edit_ldap_settings: 'LDAP-Einstellungen ändern',
  admin_view_connect_settings: 'Connect-Einstellungen sehen',
  admin_edit_connect_settings: 'Connect-Einstellungen ändern',
  admin_edit_company_features: 'Funktionsumfang ändern',
  admin_edit_company_license: 'Lizenz ändern',
  admin_edit_company_market: 'Marktplatz-Einstellungen ändern',
  admin_view_sharelink_details: 'Details zu Share-Links sehen',

  // Marktplatz
  admin_marketplace_access: 'Marktplatz öffnen',
  admin_marketplace_manage_official_tools: 'Offizielle Werkzeuge verwalten',

  // Organisation und Server
  admin_view_organisation_settings: 'Organisationseinstellungen sehen',
  admin_edit_organisation_settings: 'Organisationseinstellungen ändern',
  admin_edit_organisation_quota: 'Speicherkontingent ändern',
  admin_edit_organisation_userlimit: 'Nutzerobergrenze ändern',
  admin_list_organisations: 'Organisationen auflisten',
  admin_add_organisations: 'Organisationen anlegen',
  admin_delete_organisations: 'Organisationen löschen',
  admin_manage_federation_servers: 'Föderationsserver verwalten',
  admin_view_global_statistics: 'Globale Statistiken sehen',
  admin_view_backups: 'Backups sehen',
  admin_edit_backups: 'Backups verwalten',
  admin_sign_contracts: 'Verträge unterzeichnen',

  // Anmeldebeschränkungen
  restriction_login_mobile: 'Anmeldung per Mobil-App gesperrt',
  restriction_login_web: 'Anmeldung im Browser gesperrt',
  restriction_login_desktop: 'Anmeldung per Desktop-App gesperrt',
  restriction_userlist_requires_input: 'Nutzersuche erfordert Eingabe',
};

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    title: 'Kommunikation',
    keys: [
      'create_channels', 'create_public_channels', 'create_conversations',
      'create_broadcast_messages', 'create_voip_calls',
      'invite_contact_group_to_channel', 'channel_export',
      'list_users', 'create_webhooks',
    ],
  },
  {
    title: 'Termine und Umfragen',
    keys: [
      'create_personal_events', 'create_channel_events', 'create_company_events',
      'create_polls', 'display_polls',
      'invite_channels_to_polls', 'invite_contacts_to_polls',
    ],
  },
  {
    title: 'Nutzerverwaltung',
    keys: [
      'admin_list_users', 'admin_add_users', 'admin_rename_users', 'admin_delete_users',
      'create_users_by_link', 'admin_create_users_with_invite',
      'create_users_with_invite_with_link', 'admin_manage_invite_links',
      'admin_list_user_devices', 'admin_delete_user_devices',
    ],
  },
  {
    title: 'Channels und Gruppen verwalten',
    keys: [
      'admin_list_channels', 'admin_create_company_channels',
      'admin_edit_channels', 'admin_delete_channels',
      'admin_view_company_groups', 'admin_edit_company_groups',
    ],
  },
  {
    title: 'Unternehmen',
    keys: [
      'admin_view_company_settings', 'admin_edit_company_settings',
      'admin_edit_company_settings_message_ttl',
      'admin_view_company_roles', 'admin_edit_company_roles', 'admin_create_global_roles',
      'admin_view_company_status', 'admin_edit_company_status',
      'admin_view_company_statistics',
      'admin_view_email_templates', 'admin_edit_email_templates',
      'admin_view_ldap_settings', 'admin_edit_ldap_settings',
      'admin_view_connect_settings', 'admin_edit_connect_settings',
      'admin_edit_company_features', 'admin_edit_company_license',
      'admin_edit_company_market', 'admin_view_sharelink_details',
    ],
  },
  {
    title: 'Marktplatz',
    keys: ['admin_marketplace_access', 'admin_marketplace_manage_official_tools'],
  },
  {
    title: 'Organisation und Server',
    keys: [
      'admin_view_organisation_settings', 'admin_edit_organisation_settings',
      'admin_edit_organisation_quota', 'admin_edit_organisation_userlimit',
      'admin_list_organisations', 'admin_add_organisations', 'admin_delete_organisations',
      'admin_manage_federation_servers', 'admin_view_global_statistics',
      'admin_view_backups', 'admin_edit_backups', 'admin_sign_contracts',
    ],
  },
  {
    title: 'Anmeldebeschränkungen',
    keys: [
      'restriction_login_mobile', 'restriction_login_web',
      'restriction_login_desktop', 'restriction_userlist_requires_input',
    ],
  },
];

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

// --- Rollennamen ---

/**
 * Vordefinierte Systemrollen tragen im Namen doppelte geschweifte Klammern.
 * Sie sind organisationsweit vorgegeben und nicht änderbar.
 */
const SYSTEM_ROLE_LABELS: Record<string, string> = {
  admins: 'Administrator',
  basicadmins: 'Eingeschränkter Administrator',
  serveradmins: 'Server-Administrator',
  user: 'Nutzer',
  guests: 'Gast',
  inviter: 'Einladender',
};

/** true, wenn der Name die `{{…}}`-Schreibweise einer Systemrolle hat. */
export function isSystemRoleName(name: string): boolean {
  return /^\{\{.*\}\}$/.test(name.trim());
}

/**
 * Anzeigename einer Rolle. Aus `{{admins}}` wird „Administrator"; unbekannte
 * Systemrollen verlieren wenigstens die Klammern.
 */
export function roleDisplayName(name: string | undefined | null): string {
  const raw = (name ?? '').trim();
  const match = /^\{\{(.*)\}\}$/.exec(raw);
  if (!match) return raw;
  const key = match[1].toLowerCase();
  return SYSTEM_ROLE_LABELS[key] ?? match[1];
}
