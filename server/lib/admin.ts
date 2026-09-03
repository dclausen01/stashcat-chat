/**
 * Admin (Company-Management) helpers.
 *
 * Die `/manage/*`-Endpunkte der Stashcat-API sind nicht von `stashcat-api`
 * gewrappt — sie werden hier direkt ueber `client.api.post()` angesprochen,
 * analog zu `routes/calls.ts`.
 *
 * Jeder schreibende Admin-Call wird serverseitig gegen die tatsaechlichen
 * Rechte des Nutzers geprueft (`requirePermission`). Das Frontend blendet
 * Aktionen zusaetzlich aus, aber die Autorisierung passiert hier.
 */

import type express from 'express';
import type { StashcatClient } from 'stashcat-api';
import { extractToken } from './get-client';
import { decryptSession } from '../token-crypto';
import { errorMessage, serverLog } from './logging';

/**
 * Berechtigungs-Schluessel, wie die API sie in `payload.permissions`
 * liefert: ein flaches Array von snake_case-Strings. Nur die fuer
 * Nutzerverwaltung relevanten sind hier benannt; unbekannte Strings
 * werden unveraendert durchgereicht.
 */
export type AdminPermission =
  | 'admin_list_users'
  | 'admin_add_users'
  | 'admin_rename_users'
  | 'admin_delete_users'
  | 'admin_list_user_devices'
  | 'admin_delete_user_devices'
  | 'admin_manage_invite_links'
  | 'admin_view_company_roles'
  | 'admin_edit_company_roles'
  | 'admin_view_company_groups'
  | 'admin_edit_company_groups'
  | 'admin_list_channels'
  | 'admin_edit_channels'
  | 'admin_delete_channels'
  | 'admin_create_company_channels'
  | 'list_users';

interface PermissionEntry {
  permissions: string[];
  expiresAt: number;
}

const PERMISSION_TTL = 5 * 60 * 1000; // 5 Minuten
const permissionCache = new Map<string, PermissionEntry>();

setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of permissionCache) {
    if (now > entry.expiresAt) permissionCache.delete(key);
  }
}, 60_000).unref?.();

/** Cache-Key ist an die Session gebunden — Rechte sind nutzerspezifisch. */
function cacheKey(req: express.Request, companyId: string): string {
  try {
    return `${decryptSession(extractToken(req)).clientKey}:${companyId}`;
  } catch {
    return `anon:${companyId}`;
  }
}

/**
 * Laedt die Rechte des eingeloggten Nutzers fuer eine Company.
 *
 * `/manage/get_users_permissions` liefert `payload.permissions` als Array
 * von snake_case-Strings. Fehlt das Feld (z. B. weil der Nutzer gar keine
 * Admin-Rolle hat), wird ein leeres Array zurueckgegeben — nie ein Fehler,
 * damit das Frontend schlicht "kein Admin" rendern kann.
 */
export async function loadPermissions(
  client: StashcatClient,
  companyId: string,
): Promise<string[]> {
  const data = client.api.createAuthenticatedRequestData({ company_id: companyId });
  const payload = await client.api.post<{ permissions?: unknown }>(
    '/manage/get_users_permissions',
    data,
  );
  const raw = payload?.permissions;
  if (!Array.isArray(raw)) return [];
  return raw.filter((p): p is string => typeof p === 'string');
}

/** Wie `loadPermissions`, aber mit TTL-Cache pro Session+Company. */
export async function getPermissions(
  req: express.Request,
  companyId: string,
): Promise<string[]> {
  const key = cacheKey(req, companyId);
  const cached = permissionCache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.permissions;

  const permissions = await loadPermissions(req.client!, companyId);
  permissionCache.set(key, { permissions, expiresAt: Date.now() + PERMISSION_TTL });
  return permissions;
}

/** Verwirft den Rechte-Cache einer Session (alle Companies). */
export function invalidatePermissions(clientKey: string): void {
  for (const key of permissionCache.keys()) {
    if (key.startsWith(`${clientKey}:`)) permissionCache.delete(key);
  }
}

/**
 * Middleware-Factory: bricht mit 403 ab, wenn dem Nutzer eines der
 * geforderten Rechte fehlt. `companyId` wird aus den Route-Parametern
 * gelesen — jede Admin-Route fuehrt sie im Pfad.
 *
 * Mehrere Rechte werden als ODER behandelt (eines genuegt).
 */
export function requirePermission(...needed: AdminPermission[]) {
  return async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ): Promise<void> => {
    // Express 5 typisiert Route-Parameter als `string | string[]`; hier ist
    // immer genau ein Segment gemeint.
    const raw = req.params.companyId;
    const companyId = Array.isArray(raw) ? raw[0] : raw;
    if (!companyId) {
      res.status(400).json({ error: 'companyId fehlt' });
      return;
    }
    try {
      const permissions = await getPermissions(req, companyId);
      if (needed.some((p) => permissions.includes(p))) {
        next();
        return;
      }
      serverLog(
        `[Admin] 403 ${req.method} ${req.path} — benoetigt ${needed.join('|')}, hat ${permissions.length} Rechte`,
      );
      res.status(403).json({ error: 'Keine Berechtigung fuer diese Aktion' });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err, 'Rechtepruefung fehlgeschlagen') });
    }
  };
}

/**
 * Sortier-Schluessel, die die `/manage/list_*`-Endpunkte akzeptieren.
 * Verifiziert gegen die Stringtabelle des offiziellen Webclients; eine
 * Whitelist, damit keine unbekannten Werte an die API durchgereicht werden.
 */
const ALLOWED_SORTINGS = new Set([
  // Nutzer
  'first_name_asc', 'first_name_desc',
  'last_name_asc', 'last_name_desc',
  'time_joined_asc', 'time_joined_desc',
  'last_action_asc', 'last_action_desc',
  // Gruppen und Channels
  'name_asc', 'name_desc',
  'user_count_asc', 'user_count_desc',
  'created_asc', 'created_desc',
  'type_asc', 'type_desc',
  'last_activity_asc', 'last_activity_desc',
  // allgemein
  'id_asc', 'id_desc',
]);

/**
 * Validiert einen Sortier-Parameter aus der Query gegen die Whitelist.
 * Die API erwartet das Feld als JSON-Array, das uebernimmt der Aufrufer.
 */
export function normalizeSorting(value: unknown, fallback = 'last_name_asc'): string {
  return typeof value === 'string' && ALLOWED_SORTINGS.has(value) ? value : fallback;
}

/**
 * Gueltige `filter`-Werte fuer `/manage/list_channel_members`.
 *
 * Der Parameter ist **Pflicht** — der offizielle Client uebergibt ihn an jeder
 * Aufrufstelle (`go.Members` bzw. eine Auswahl daraus). Ohne ihn antwortet die
 * API mit `missing_values`, was wie ein fehlendes Pflichtfeld irgendwo anders
 * aussieht.
 */
const ALLOWED_MEMBER_FILTERS = new Set([
  'members',
  'members_only',
  'membership_requested',
  'membership_pending',
  'managers',
]);

/** Validiert den Mitglieder-Filter; Vorgabe ist die volle Mitgliederliste. */
export function normalizeMemberFilter(value: unknown, fallback = 'members'): string {
  return typeof value === 'string' && ALLOWED_MEMBER_FILTERS.has(value) ? value : fallback;
}

/**
 * Parst eine kommaseparierte oder JSON-Liste von IDs aus Query/Body in ein
 * String-Array. Leere Eintraege werden verworfen.
 */
export function parseIdList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== 'string' || !value.trim()) return [];
  const trimmed = value.trim();
  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {
      // faellt auf Komma-Split zurueck
    }
  }
  return trimmed.split(',').map((s) => s.trim()).filter(Boolean);
}
