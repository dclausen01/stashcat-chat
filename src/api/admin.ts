/**
 * Admin-API (Company-Nutzerverwaltung).
 *
 * Spiegelt `server/routes/admin.ts`. Die Nutzer-Objekte werden vom Backend
 * unveraendert aus der Stashcat-API durchgereicht, sind also snake_case und
 * tragen Zeitstempel als Unix-Sekunden.
 */

import { get, post, patch, del } from './core';

/** Ein Rechte-Schluessel, wie ihn die API liefert (snake_case). */
export type PermissionKey = string;

export interface AdminRole {
  id: string;
  name: string;
  company_id?: string;
  editable?: boolean | number;
  global?: boolean | string;
  permissions?: PermissionKey[];
  time?: number;
}

/**
 * Nutzer aus `/manage/list_users`. Zeitfelder sind Unix-Sekunden oder `null`.
 * `active` gesetzt + `deactivated === null` bedeutet "aktives Mitglied".
 */
export interface AdminUser {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email?: string | null;
  image?: string | null;
  /** Zeitpunkt der Aktivierung — `null` = nie aktiviert (Einladung offen). */
  active?: number | null;
  /** Gesetzt, wenn die Mitgliedschaft deaktiviert wurde. */
  deactivated?: number | null;
  deleted?: boolean;
  admin?: boolean;
  read_only?: boolean;
  online?: boolean;
  roles?: AdminRole[];
  last_login?: number | null;
  time_joined?: number | null;
  email_validated?: number | null;
  membership_expiry?: number | null;
  ldap_login?: string | number | null;
}

export interface AdminDevice {
  id: string;
  user_id?: string;
  device_id?: string;
  app_name?: string | null;
  encryption?: string | null;
  connected?: boolean | number;
  ip_address?: string | null;
  last_login?: number | string | null;
  last_request?: number | string | null;
}

export interface AdminPermissionsResult {
  permissions: PermissionKey[];
  isAdmin: boolean;
}

/** Filter- und Sortieroptionen fuer die Nutzerliste. */
export interface AdminUserQuery {
  search?: string;
  /** z. B. `'active'` — leer heisst "alle". */
  status?: string;
  sorting?: string;
  roles?: string[];
  groupIds?: string[];
  limit?: number;
  offset?: number;
}

// --- Rechte & Rollen ---

/**
 * Eigene Admin-Rechte fuer die Company. Wirft nicht, wenn der Nutzer kein
 * Admin ist — dann ist `permissions` leer und `isAdmin` false.
 */
export async function getAdminPermissions(companyId: string): Promise<AdminPermissionsResult> {
  return get<AdminPermissionsResult>(`/admin/permissions/${companyId}`);
}

export async function getAdminRoles(companyId: string): Promise<AdminRole[]> {
  return get<AdminRole[]>(`/admin/roles/${companyId}`);
}

export async function getAvailableRoles(companyId: string): Promise<AdminRole[]> {
  return get<AdminRole[]>(`/admin/available-roles/${companyId}`);
}

// --- Nutzerliste ---

export async function listAdminUsers(
  companyId: string,
  query: AdminUserQuery = {},
): Promise<AdminUser[]> {
  const params = new URLSearchParams();
  if (query.search) params.set('search', query.search);
  if (query.status) params.set('status', query.status);
  if (query.sorting) params.set('sorting', query.sorting);
  if (query.roles?.length) params.set('roles', query.roles.join(','));
  if (query.groupIds?.length) params.set('groupIds', query.groupIds.join(','));
  params.set('limit', String(query.limit ?? 50));
  params.set('offset', String(query.offset ?? 0));
  return get<AdminUser[]>(`/admin/users/${companyId}?${params.toString()}`);
}

export async function getAdminUser(companyId: string, userId: string): Promise<AdminUser | null> {
  return get<AdminUser | null>(`/admin/users/${companyId}/${userId}`);
}

export interface CreateUserInput {
  firstName: string;
  lastName: string;
  email: string;
  administrator?: boolean;
  readOnly?: boolean;
  roles?: string[];
}

export async function createAdminUser(
  companyId: string,
  input: CreateUserInput,
): Promise<AdminUser> {
  return post<AdminUser>(`/admin/users/${companyId}`, { ...input });
}

export interface UpdateUserInput {
  firstName: string;
  lastName: string;
  roles?: string[];
}

export async function updateAdminUser(
  companyId: string,
  userId: string,
  input: UpdateUserInput,
): Promise<AdminUser> {
  return patch<AdminUser>(`/admin/users/${companyId}/${userId}`, { ...input });
}

export async function deleteAdminUser(companyId: string, userId: string): Promise<void> {
  await del(`/admin/users/${companyId}/${userId}`);
}

// --- Sammelaktionen ---

export async function activateUsers(companyId: string, userIds: string[]): Promise<void> {
  await post(`/admin/users/${companyId}/bulk/activate`, { userIds });
}

export async function deactivateUsers(companyId: string, userIds: string[]): Promise<void> {
  await post(`/admin/users/${companyId}/bulk/deactivate`, { userIds });
}

export async function deleteUsers(companyId: string, userIds: string[]): Promise<void> {
  await post(`/admin/users/${companyId}/bulk/delete`, { userIds });
}

/** Ersetzt die Rollenzuordnung der angegebenen Nutzer komplett. */
export async function assignRoles(
  companyId: string,
  userIds: string[],
  roleIds: string[],
): Promise<void> {
  await post(`/admin/users/${companyId}/bulk/roles`, { userIds, roleIds });
}

// --- Einzelaktionen ---

export async function setUserAdmin(
  companyId: string,
  userId: string,
  promote: boolean,
): Promise<void> {
  await post(`/admin/users/${companyId}/${userId}/admin`, { promote });
}

export async function setUserReadOnly(
  companyId: string,
  userId: string,
  readOnly: boolean,
): Promise<void> {
  await post(`/admin/users/${companyId}/${userId}/read-only`, { readOnly });
}

export async function resendInvite(
  companyId: string,
  userId: string,
  email: string,
): Promise<void> {
  await post(`/admin/users/${companyId}/${userId}/invite`, { email });
}

// --- Geraete ---

export async function getUserDevices(
  companyId: string,
  userId: string,
): Promise<AdminDevice[]> {
  return get<AdminDevice[]>(`/admin/users/${companyId}/${userId}/devices`);
}

export async function removeUserDevice(
  companyId: string,
  userId: string,
  deviceId: string,
): Promise<AdminDevice[]> {
  return del<AdminDevice[]>(`/admin/users/${companyId}/${userId}/devices/${deviceId}`);
}

export async function removeAllUserDevices(companyId: string, userId: string): Promise<void> {
  await del(`/admin/users/${companyId}/${userId}/devices`);
}

// --- Helfer ---

/** `true`, wenn die Mitgliedschaft aktiv ist (aktiviert und nicht deaktiviert). */
export function isUserActive(user: AdminUser): boolean {
  return Boolean(user.active) && !user.deactivated;
}

/** Anzeigename mit Fallback fuer geloeschte/unvollstaendige Accounts. */
export function userDisplayName(user: AdminUser): string {
  const name = `${user.first_name ?? ''} ${user.last_name ?? ''}`.trim();
  return name || user.email || `Nutzer ${user.id}`;
}

// --- Gruppen ---

/**
 * Gruppe aus `/manage/list_groups`. Die Feldnamen sind aus dem offiziellen
 * Webclient abgeleitet; unbekannte Zusatzfelder werden unveraendert
 * durchgereicht, daher die optionale Typisierung.
 */
export interface AdminGroup {
  id: string;
  name: string;
  description?: string | null;
  /** Gruppe legt automatisch einen zugehoerigen Channel an. */
  create_channel?: boolean | number | string;
  /** Kommunikation der Mitglieder ist auf bestimmte Gruppen beschraenkt. */
  limit_communication?: boolean | number | string;
  user_count?: number;
  time?: number;
}

export interface GroupInput {
  name: string;
  description?: string;
  createChannel?: boolean;
  limitCommunication?: boolean;
}

export interface AdminGroupQuery {
  search?: string;
  sorting?: string;
  limit?: number;
  offset?: number;
}

export async function listAdminGroups(
  companyId: string,
  query: AdminGroupQuery = {},
): Promise<AdminGroup[]> {
  const params = new URLSearchParams();
  if (query.search) params.set('search', query.search);
  if (query.sorting) params.set('sorting', query.sorting);
  params.set('limit', String(query.limit ?? 50));
  params.set('offset', String(query.offset ?? 0));
  return get<AdminGroup[]>(`/admin/groups/${companyId}?${params.toString()}`);
}

export async function createAdminGroup(
  companyId: string,
  input: GroupInput,
): Promise<AdminGroup> {
  return post<AdminGroup>(`/admin/groups/${companyId}`, { ...input });
}

export async function updateAdminGroup(
  companyId: string,
  groupId: string,
  input: GroupInput,
): Promise<AdminGroup> {
  return patch<AdminGroup>(`/admin/groups/${companyId}/${groupId}`, { ...input });
}

export async function deleteAdminGroup(companyId: string, groupId: string): Promise<void> {
  await del(`/admin/groups/${companyId}/${groupId}`);
}

export async function getAdminGroupMembers(
  companyId: string,
  groupId: string,
  query: AdminUserQuery = {},
): Promise<AdminUser[]> {
  const params = new URLSearchParams();
  if (query.search) params.set('search', query.search);
  if (query.sorting) params.set('sorting', query.sorting);
  params.set('limit', String(query.limit ?? 50));
  params.set('offset', String(query.offset ?? 0));
  return get<AdminUser[]>(`/admin/groups/${companyId}/${groupId}/members?${params.toString()}`);
}

export async function addUsersToGroup(
  companyId: string,
  groupId: string,
  userIds: string[],
): Promise<void> {
  await post(`/admin/groups/${companyId}/${groupId}/members`, { userIds });
}

export async function removeUsersFromGroup(
  companyId: string,
  groupId: string,
  userIds: string[],
): Promise<void> {
  await del(`/admin/groups/${companyId}/${groupId}/members`, { userIds });
}

/** Normalisiert die uneinheitlichen Wahrheitswerte der API (true/1/"1"). */
export function isFlagSet(value: boolean | number | string | undefined | null): boolean {
  return value === true || value === 1 || value === '1';
}
