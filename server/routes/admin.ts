/**
 * Admin-Routen: Company-Nutzerverwaltung (`/manage/*`).
 *
 * Diese Endpunkte sind in `stashcat-api` nicht gewrappt und werden direkt
 * ueber `client.api.post()` angesprochen (Pattern wie `routes/calls.ts`).
 * Jede schreibende Route haengt hinter `requirePermission(...)`.
 *
 * Payload-Formen wurden gegen den offiziellen schul.cloud-Webclient
 * verifiziert — siehe `docs/schulcloud-api-reference.md`.
 */

import { Router } from 'express';
import type { StashcatClient } from 'stashcat-api';
import { errorMessage, serverLog } from '../lib/logging';
import { getPermissions, normalizeMemberFilter, normalizeSorting, parseIdList, requirePermission } from '../lib/admin';
import { InviteError, inviteUsersToChannel } from '../lib/channel-invite';

const router = Router();

/** `list_users` liefert die Nutzer unter `payload.users`. */
interface ManageUsersPayload {
  users?: unknown[];
}
interface ManageUserPayload {
  user?: unknown;
}
interface ManageDevicesPayload {
  devices?: unknown[];
}

// --- Rechte & Rollen -------------------------------------------------------

/**
 * Eigene Admin-Rechte fuer eine Company. Bewusst *ohne* `requirePermission`:
 * das Frontend muss abfragen duerfen, ob es ueberhaupt Admin ist. Leeres
 * Array = kein Admin.
 */
router.get('/admin/permissions/:companyId', async (req, res) => {
  try {
    const permissions = await getPermissions(req, req.params.companyId);
    res.json({ permissions, isAdmin: permissions.some((p) => p.startsWith('admin_')) });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err, 'Rechte konnten nicht geladen werden') });
  }
});

/** Alle Rollen der Company inkl. ihrer Rechte (`/permissions/get`). */
router.get(
  '/admin/roles/:companyId',
  requirePermission('admin_view_company_roles', 'admin_edit_company_roles', 'admin_list_users'),
  async (req, res) => {
    try {
      const client = req.client!;
      const data = client.api.createAuthenticatedRequestData({ company_id: req.params.companyId });
      const payload = await client.api.post<{ roles?: unknown[] }>('/permissions/get', data);
      res.json(payload?.roles ?? []);
    } catch (err) {
      res.status(500).json({ error: errorMessage(err, 'Rollen konnten nicht geladen werden') });
    }
  },
);

/** Rollen, die dem Admin beim Anlegen/Bearbeiten zur Auswahl stehen. */
router.get(
  '/admin/available-roles/:companyId',
  requirePermission('admin_list_users', 'admin_add_users'),
  async (req, res) => {
    try {
      const client = req.client!;
      const data = client.api.createAuthenticatedRequestData({ company_id: req.params.companyId });
      const payload = await client.api.post<{ roles?: unknown[] }>('/users/available_roles', data);
      res.json(payload?.roles ?? []);
    } catch (err) {
      res.status(500).json({ error: errorMessage(err, 'Rollen konnten nicht geladen werden') });
    }
  },
);

// --- Nutzerliste -----------------------------------------------------------

/**
 * Nutzer der Company, paginiert.
 *
 * Query: `limit`, `offset`, `search`, `sorting`, `status` (z. B. `active`),
 * `roles` (Rollen-IDs, kommasepariert), `groupIds`, `excludeUserIds`.
 *
 * Die API erwartet `sorting`/`status`/`roles`/`group_ids` als JSON-Arrays —
 * `client.api.post()` serialisiert Arrays automatisch.
 */
router.get('/admin/users/:companyId', requirePermission('admin_list_users'), async (req, res) => {
  try {
    const client = req.client!;
    const { search, status, limit, offset } = req.query;
    const data = client.api.createAuthenticatedRequestData({
      company_id: req.params.companyId,
      limit: Math.min(Number(limit) || 50, 500),
      offset: Number(offset) || 0,
      search: typeof search === 'string' ? search : '',
      sorting: [normalizeSorting(req.query.sorting)],
      status: typeof status === 'string' && status ? [status] : [],
      roles: parseIdList(req.query.roles),
      group_ids: parseIdList(req.query.groupIds),
      exclude_user_ids: parseIdList(req.query.excludeUserIds),
      // Die API unterscheidet "Filter aus" (String "null") von true/false.
      expiry_set: 'null',
      withkey: false,
    });
    const payload = await client.api.post<ManageUsersPayload>('/manage/list_users', data);
    res.json(payload?.users ?? []);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err, 'Nutzerliste konnte nicht geladen werden') });
  }
});

/** Neuen Nutzer anlegen. */
router.post('/admin/users/:companyId', requirePermission('admin_add_users'), async (req, res) => {
  try {
    const client = req.client!;
    const { firstName, lastName, email, administrator, readOnly, roles } = req.body as {
      firstName?: string;
      lastName?: string;
      email?: string;
      administrator?: boolean;
      readOnly?: boolean;
      roles?: unknown;
    };
    if (!firstName?.trim() || !lastName?.trim() || !email?.trim()) {
      return res.status(400).json({ error: 'Vorname, Nachname und E-Mail sind Pflichtfelder' });
    }
    const data = client.api.createAuthenticatedRequestData({
      company_id: req.params.companyId,
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      email: email.trim(),
      administrator: Boolean(administrator),
      read_only: Boolean(readOnly),
      roles: parseIdList(roles),
    });
    const payload = await client.api.post<ManageUserPayload>('/manage/add_user', data);
    serverLog(`[Admin] Nutzer angelegt: ${email.trim()} (company=${req.params.companyId})`);
    res.json(payload?.user ?? { success: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err, 'Nutzer konnte nicht angelegt werden') });
  }
});

// --- Sammelaktionen --------------------------------------------------------
// Muessen VOR den `/:userId`-Routen stehen, sonst schluckt der Parameter sie.

/** Mitgliedschaften mehrerer Nutzer aktivieren. */
router.post(
  '/admin/users/:companyId/bulk/activate',
  requirePermission('admin_add_users', 'admin_delete_users'),
  async (req, res) => {
    try {
      const client = req.client!;
      const userIds = parseIdList((req.body as { userIds?: unknown }).userIds);
      if (!userIds.length) return res.status(400).json({ error: 'Keine Nutzer ausgewaehlt' });
      const data = client.api.createAuthenticatedRequestData({
        company_id: req.params.companyId,
        user_ids: userIds,
      });
      await client.api.post('/manage/activate_user_memberships', data);
      serverLog(`[Admin] ${userIds.length} Mitgliedschaft(en) aktiviert`);
      res.json({ success: true, count: userIds.length });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err, 'Aktivieren fehlgeschlagen') });
    }
  },
);

/** Mitgliedschaften mehrerer Nutzer deaktivieren. */
router.post(
  '/admin/users/:companyId/bulk/deactivate',
  requirePermission('admin_delete_users'),
  async (req, res) => {
    try {
      const client = req.client!;
      const userIds = parseIdList((req.body as { userIds?: unknown }).userIds);
      if (!userIds.length) return res.status(400).json({ error: 'Keine Nutzer ausgewaehlt' });
      const data = client.api.createAuthenticatedRequestData({
        company_id: req.params.companyId,
        user_ids: userIds,
      });
      await client.api.post('/manage/deactivate_user_memberships', data);
      serverLog(`[Admin] ${userIds.length} Mitgliedschaft(en) deaktiviert`);
      res.json({ success: true, count: userIds.length });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err, 'Deaktivieren fehlgeschlagen') });
    }
  },
);

/** Mehrere Nutzer endgueltig loeschen. */
router.post(
  '/admin/users/:companyId/bulk/delete',
  requirePermission('admin_delete_users'),
  async (req, res) => {
    try {
      const client = req.client!;
      const userIds = parseIdList((req.body as { userIds?: unknown }).userIds);
      if (!userIds.length) return res.status(400).json({ error: 'Keine Nutzer ausgewaehlt' });
      const data = client.api.createAuthenticatedRequestData({
        company_id: req.params.companyId,
        user_ids: userIds,
      });
      await client.api.post('/manage/delete_users', data);
      serverLog(`[Admin] ${userIds.length} Nutzer geloescht (company=${req.params.companyId})`);
      res.json({ success: true, count: userIds.length });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err, 'Loeschen fehlgeschlagen') });
    }
  },
);

/** Rollen mehrerer Nutzer setzen (ersetzt die bisherige Zuordnung). */
router.post(
  '/admin/users/:companyId/bulk/roles',
  requirePermission('admin_edit_company_roles', 'admin_rename_users'),
  async (req, res) => {
    try {
      const client = req.client!;
      const body = req.body as { userIds?: unknown; roleIds?: unknown };
      const userIds = parseIdList(body.userIds);
      const roleIds = parseIdList(body.roleIds);
      if (!userIds.length) return res.status(400).json({ error: 'Keine Nutzer ausgewaehlt' });
      const data = client.api.createAuthenticatedRequestData({
        company_id: req.params.companyId,
        user_ids: userIds,
        role_ids: roleIds,
      });
      await client.api.post('/manage/assign_roles', data);
      serverLog(`[Admin] Rollen fuer ${userIds.length} Nutzer gesetzt`);
      res.json({ success: true, count: userIds.length });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err, 'Rollenzuweisung fehlgeschlagen') });
    }
  },
);

// --- Einzelner Nutzer ------------------------------------------------------

router.get(
  '/admin/users/:companyId/:userId',
  requirePermission('admin_list_users'),
  async (req, res) => {
    try {
      const client = req.client!;
      const data = client.api.createAuthenticatedRequestData({
        company_id: req.params.companyId,
        user_id: req.params.userId,
      });
      const payload = await client.api.post<ManageUserPayload>('/manage/get_user', data);
      res.json(payload?.user ?? null);
    } catch (err) {
      res.status(500).json({ error: errorMessage(err, 'Nutzer konnte nicht geladen werden') });
    }
  },
);

/** Namen und/oder Rollen eines Nutzers aendern. */
router.patch(
  '/admin/users/:companyId/:userId',
  requirePermission('admin_rename_users'),
  async (req, res) => {
    try {
      const client = req.client!;
      const { firstName, lastName, roles } = req.body as {
        firstName?: string;
        lastName?: string;
        roles?: unknown;
      };
      if (!firstName?.trim() || !lastName?.trim()) {
        return res.status(400).json({ error: 'Vorname und Nachname sind Pflichtfelder' });
      }
      const data = client.api.createAuthenticatedRequestData({
        company_id: req.params.companyId,
        user_id: req.params.userId,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        roles: parseIdList(roles),
      });
      const payload = await client.api.post<ManageUserPayload>('/manage/edit_user', data);
      serverLog(`[Admin] Nutzer ${req.params.userId} bearbeitet`);
      res.json(payload?.user ?? { success: true });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err, 'Nutzer konnte nicht bearbeitet werden') });
    }
  },
);

router.delete(
  '/admin/users/:companyId/:userId',
  requirePermission('admin_delete_users'),
  async (req, res) => {
    try {
      const client = req.client!;
      const data = client.api.createAuthenticatedRequestData({
        company_id: req.params.companyId,
        user_id: req.params.userId,
      });
      await client.api.post('/manage/delete_user', data);
      serverLog(`[Admin] Nutzer ${req.params.userId} geloescht`);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err, 'Nutzer konnte nicht geloescht werden') });
    }
  },
);

/** Zum Company-Admin befoerdern bzw. degradieren. */
router.post(
  '/admin/users/:companyId/:userId/admin',
  requirePermission('admin_rename_users', 'admin_add_users'),
  async (req, res) => {
    try {
      const client = req.client!;
      const promote = Boolean((req.body as { promote?: boolean }).promote);
      const data = client.api.createAuthenticatedRequestData({
        company_id: req.params.companyId,
        user_id: req.params.userId,
      });
      await client.api.post(promote ? '/manage/promote_user' : '/manage/demote_user', data);
      serverLog(`[Admin] Nutzer ${req.params.userId} ${promote ? 'befoerdert' : 'degradiert'}`);
      res.json({ success: true, administrator: promote });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err, 'Aenderung fehlgeschlagen') });
    }
  },
);

/** Schreibrechte entziehen bzw. zurueckgeben. */
router.post(
  '/admin/users/:companyId/:userId/read-only',
  requirePermission('admin_rename_users', 'admin_add_users'),
  async (req, res) => {
    try {
      const client = req.client!;
      const readOnly = Boolean((req.body as { readOnly?: boolean }).readOnly);
      const data = client.api.createAuthenticatedRequestData({
        company_id: req.params.companyId,
        user_id: req.params.userId,
        read_only: readOnly,
      });
      await client.api.post('/manage/set_read_only', data);
      serverLog(`[Admin] Nutzer ${req.params.userId} read_only=${readOnly}`);
      res.json({ success: true, readOnly });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err, 'Aenderung fehlgeschlagen') });
    }
  },
);

/** Einladungs-/Aktivierungsmail erneut versenden. */
router.post(
  '/admin/users/:companyId/:userId/invite',
  requirePermission('admin_add_users'),
  async (req, res) => {
    try {
      const client = req.client!;
      const email = (req.body as { email?: string }).email;
      if (!email?.trim()) return res.status(400).json({ error: 'E-Mail fehlt' });
      const data = client.api.createAuthenticatedRequestData({
        user_id: req.params.userId,
        email: email.trim(),
      });
      await client.api.post('/manage/send_email_invite', data);
      serverLog(`[Admin] Einladung erneut versendet an ${email.trim()}`);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err, 'Einladung konnte nicht versendet werden') });
    }
  },
);

// --- Geraete ---------------------------------------------------------------

router.get(
  '/admin/users/:companyId/:userId/devices',
  requirePermission('admin_list_user_devices'),
  async (req, res) => {
    try {
      const client = req.client!;
      const data = client.api.createAuthenticatedRequestData({
        company_id: req.params.companyId,
        user_id: req.params.userId,
      });
      const payload = await client.api.post<ManageDevicesPayload>('/manage/list_devices_by_users', data);
      res.json(payload?.devices ?? []);
    } catch (err) {
      res.status(500).json({ error: errorMessage(err, 'Geraete konnten nicht geladen werden') });
    }
  },
);

/** Einzelnes Geraet abmelden. Antwort ist die verbliebene Geraeteliste. */
router.delete(
  '/admin/users/:companyId/:userId/devices/:deviceId',
  requirePermission('admin_delete_user_devices'),
  async (req, res) => {
    try {
      const client = req.client!;
      const data = client.api.createAuthenticatedRequestData({
        company_id: req.params.companyId,
        user_id: req.params.userId,
        // Die API erwartet hier tatsaechlich camelCase — verifiziert gegen den Webclient.
        deviceID: req.params.deviceId,
      });
      const payload = await client.api.post<ManageDevicesPayload>('/manage/remove_device', data);
      serverLog(`[Admin] Geraet ${req.params.deviceId} von Nutzer ${req.params.userId} entfernt`);
      res.json(payload?.devices ?? []);
    } catch (err) {
      res.status(500).json({ error: errorMessage(err, 'Geraet konnte nicht entfernt werden') });
    }
  },
);

/** Alle Geraete eines Nutzers abmelden. */
router.delete(
  '/admin/users/:companyId/:userId/devices',
  requirePermission('admin_delete_user_devices'),
  async (req, res) => {
    try {
      const client = req.client!;
      const data = client.api.createAuthenticatedRequestData({
        company_id: req.params.companyId,
        user_id: req.params.userId,
      });
      await client.api.post('/manage/remove_all_devices_by_user', data);
      serverLog(`[Admin] Alle Geraete von Nutzer ${req.params.userId} entfernt`);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err, 'Geraete konnten nicht entfernt werden') });
    }
  },
);

// --- Gruppen ---------------------------------------------------------------
// Die Antwortformen von /manage/list_groups und /manage/list_users_by_group
// wurden aus dem offiziellen Webclient abgeleitet (payload.groups /
// payload.users) und werden unveraendert durchgereicht.

interface ManageGroupsPayload {
  groups?: unknown[];
}

/** Gruppen der Company, paginiert. Query: `search`, `sorting`, `limit`, `offset`. */
router.get(
  '/admin/groups/:companyId',
  requirePermission('admin_view_company_groups', 'admin_edit_company_groups', 'admin_list_users'),
  async (req, res) => {
    try {
      const client = req.client!;
      const { search, limit, offset } = req.query;
      const data = client.api.createAuthenticatedRequestData({
        company_id: req.params.companyId,
        limit: Math.min(Number(limit) || 50, 500),
        offset: Number(offset) || 0,
        search: typeof search === 'string' ? search : '',
        sorting: [normalizeSorting(req.query.sorting, 'name_asc')],
      });
      const payload = await client.api.post<ManageGroupsPayload>('/manage/list_groups', data);
      res.json(payload?.groups ?? []);
    } catch (err) {
      res.status(500).json({ error: errorMessage(err, 'Gruppen konnten nicht geladen werden') });
    }
  },
);

router.post(
  '/admin/groups/:companyId',
  requirePermission('admin_edit_company_groups'),
  async (req, res) => {
    try {
      const client = req.client!;
      const { name, description, createChannel, limitCommunication } = req.body as {
        name?: string;
        description?: string;
        createChannel?: boolean;
        limitCommunication?: boolean;
      };
      if (!name?.trim()) return res.status(400).json({ error: 'Name ist ein Pflichtfeld' });
      const data = client.api.createAuthenticatedRequestData({
        company_id: req.params.companyId,
        name: name.trim(),
        description: description?.trim() ?? '',
        create_channel: Boolean(createChannel),
        limit_communication: Boolean(limitCommunication),
      });
      const payload = await client.api.post<{ group?: unknown }>('/manage/create_group', data);
      serverLog(`[Admin] Gruppe angelegt: ${name.trim()}`);
      res.json(payload?.group ?? { success: true });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err, 'Gruppe konnte nicht angelegt werden') });
    }
  },
);

router.patch(
  '/admin/groups/:companyId/:groupId',
  requirePermission('admin_edit_company_groups'),
  async (req, res) => {
    try {
      const client = req.client!;
      const { name, description, createChannel, limitCommunication } = req.body as {
        name?: string;
        description?: string;
        createChannel?: boolean;
        limitCommunication?: boolean;
      };
      if (!name?.trim()) return res.status(400).json({ error: 'Name ist ein Pflichtfeld' });
      const data = client.api.createAuthenticatedRequestData({
        company_id: req.params.companyId,
        group_id: req.params.groupId,
        name: name.trim(),
        description: description?.trim() ?? '',
        create_channel: Boolean(createChannel),
        limit_communication: Boolean(limitCommunication),
      });
      const payload = await client.api.post<{ group?: unknown }>('/manage/edit_group', data);
      serverLog(`[Admin] Gruppe ${req.params.groupId} bearbeitet`);
      res.json(payload?.group ?? { success: true });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err, 'Gruppe konnte nicht bearbeitet werden') });
    }
  },
);

router.delete(
  '/admin/groups/:companyId/:groupId',
  requirePermission('admin_edit_company_groups'),
  async (req, res) => {
    try {
      const client = req.client!;
      const data = client.api.createAuthenticatedRequestData({
        company_id: req.params.companyId,
        group_id: req.params.groupId,
      });
      await client.api.post('/manage/delete_group', data);
      serverLog(`[Admin] Gruppe ${req.params.groupId} geloescht`);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err, 'Gruppe konnte nicht geloescht werden') });
    }
  },
);

/** Mitglieder einer Gruppe. Query: `search`, `sorting`, `limit`, `offset`. */
router.get(
  '/admin/groups/:companyId/:groupId/members',
  requirePermission('admin_view_company_groups', 'admin_edit_company_groups', 'admin_list_users'),
  async (req, res) => {
    try {
      const client = req.client!;
      const { search, limit, offset } = req.query;
      const data = client.api.createAuthenticatedRequestData({
        company_id: req.params.companyId,
        group_id: req.params.groupId,
        limit: Math.min(Number(limit) || 50, 500),
        offset: Number(offset) || 0,
        search: typeof search === 'string' ? search : '',
        sorting: [normalizeSorting(req.query.sorting)],
      });
      const payload = await client.api.post<ManageUsersPayload>('/manage/list_users_by_group', data);
      res.json(payload?.users ?? []);
    } catch (err) {
      res.status(500).json({ error: errorMessage(err, 'Mitglieder konnten nicht geladen werden') });
    }
  },
);

router.post(
  '/admin/groups/:companyId/:groupId/members',
  requirePermission('admin_edit_company_groups'),
  async (req, res) => {
    try {
      const client = req.client!;
      const userIds = parseIdList((req.body as { userIds?: unknown }).userIds);
      if (!userIds.length) return res.status(400).json({ error: 'Keine Nutzer ausgewaehlt' });
      const data = client.api.createAuthenticatedRequestData({
        company_id: req.params.companyId,
        group_id: req.params.groupId,
        users: userIds,
      });
      await client.api.post('/manage/add_users_to_group', data);
      serverLog(`[Admin] ${userIds.length} Nutzer zu Gruppe ${req.params.groupId} hinzugefuegt`);
      res.json({ success: true, count: userIds.length });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err, 'Hinzufuegen fehlgeschlagen') });
    }
  },
);

router.delete(
  '/admin/groups/:companyId/:groupId/members',
  requirePermission('admin_edit_company_groups'),
  async (req, res) => {
    try {
      const client = req.client!;
      const userIds = parseIdList((req.body as { userIds?: unknown }).userIds);
      if (!userIds.length) return res.status(400).json({ error: 'Keine Nutzer ausgewaehlt' });
      const data = client.api.createAuthenticatedRequestData({
        company_id: req.params.companyId,
        group_id: req.params.groupId,
        users: userIds,
      });
      await client.api.post('/manage/remove_users_from_group', data);
      serverLog(`[Admin] ${userIds.length} Nutzer aus Gruppe ${req.params.groupId} entfernt`);
      res.json({ success: true, count: userIds.length });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err, 'Entfernen fehlgeschlagen') });
    }
  },
);

// --- Channels --------------------------------------------------------------
// Anders als die Channel-Routen in `routes/channels.ts` (die den eigenen
// Mitgliedschaften des Nutzers folgen) arbeiten diese hier companyweit ueber
// den /manage/*-Namespace: ein Admin sieht auch Channels, in denen er nicht ist.

interface ManageChannelsPayload {
  channels?: unknown[];
}

/**
 * Channels der Company. Query: `search`, `sorting`, `limit`, `offset`,
 * `visible` ('1' / '0' — leer heisst "egal"), `type`.
 */
router.get(
  '/admin/channels/:companyId',
  requirePermission('admin_list_channels', 'admin_edit_channels'),
  async (req, res) => {
    try {
      const client = req.client!;
      const { search, limit, offset, visible, type } = req.query;
      const data = client.api.createAuthenticatedRequestData({
        company_id: req.params.companyId,
        limit: Math.min(Number(limit) || 50, 500),
        offset: Number(offset) || 0,
        search: typeof search === 'string' ? search : '',
        sorting: [normalizeSorting(req.query.sorting, 'name_asc')],
        // Nur mitschicken, wenn wirklich gefiltert werden soll — sonst
        // schraenkt ein `false` die Liste ungewollt ein.
        ...(visible === '1' || visible === '0' ? { visible: visible === '1' } : {}),
        ...(typeof type === 'string' && type ? { type } : {}),
      });
      const payload = await client.api.post<ManageChannelsPayload>('/manage/list_channels', data);
      res.json(payload?.channels ?? []);
    } catch (err) {
      res.status(500).json({ error: errorMessage(err, 'Channels konnten nicht geladen werden') });
    }
  },
);

/** Gesamtzahl der Channels — die Liste selbst liefert keine. */
router.get(
  '/admin/channels/:companyId/count',
  requirePermission('admin_list_channels', 'admin_edit_channels'),
  async (req, res) => {
    try {
      const client = req.client!;
      const data = client.api.createAuthenticatedRequestData({ company_id: req.params.companyId });
      const payload = await client.api.post<Record<string, unknown>>('/manage/get_channel_count', data);
      res.json(payload ?? {});
    } catch (err) {
      res.status(500).json({ error: errorMessage(err, 'Anzahl konnte nicht geladen werden') });
    }
  },
);

router.post(
  '/admin/channels/:companyId',
  requirePermission('admin_create_company_channels', 'admin_edit_channels'),
  async (req, res) => {
    try {
      const client = req.client!;
      const b = req.body as Record<string, unknown>;
      const channelName = typeof b.name === 'string' ? b.name.trim() : '';
      if (!channelName) return res.status(400).json({ error: 'Name ist ein Pflichtfeld' });
      const password = typeof b.password === 'string' ? b.password : '';
      const data = client.api.createAuthenticatedRequestData({
        company_id: req.params.companyId,
        channel_name: channelName,
        description: typeof b.description === 'string' ? b.description.trim() : '',
        password,
        password_repeat: password,
        type: typeof b.type === 'string' && b.type ? b.type : 'company',
        visible: Boolean(b.visible),
        writable: typeof b.writable === 'string' ? b.writable : 'all',
        inviteable: Boolean(b.inviteable),
        show_membership_activities: Boolean(b.showMembershipActivities),
        can_leave: b.canLeave === undefined ? true : Boolean(b.canLeave),
      });
      const payload = await client.api.post<{ channel?: unknown }>('/manage/create_channel', data);
      serverLog(`[Admin] Channel angelegt: ${channelName}`);
      res.json(payload?.channel ?? { success: true });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err, 'Channel konnte nicht angelegt werden') });
    }
  },
);

router.patch(
  '/admin/channels/:companyId/:channelId',
  requirePermission('admin_edit_channels'),
  async (req, res) => {
    try {
      const client = req.client!;
      const b = req.body as Record<string, unknown>;
      const channelName = typeof b.name === 'string' ? b.name.trim() : '';
      if (!channelName) return res.status(400).json({ error: 'Name ist ein Pflichtfeld' });
      // Passwort nur mitschicken, wenn eines gesetzt werden soll — ein leeres
      // Feld wuerde sonst ein bestehendes Passwort entfernen.
      const password = typeof b.password === 'string' && b.password ? b.password : undefined;

      // `/manage/edit_channel` verlangt `type` und `message_ttl` **immer** —
      // der offizielle Client schickt beide bei jedem Aufruf mit. Fehlen sie,
      // antwortet die API mit `missing_values`.
      //
      // `type` wird bewusst nicht geraten: ein falscher Wert wuerde einen
      // verschluesselten Channel in einen offenen verwandeln. Kommt er nicht
      // aus dem Formular, holen wir den aktuellen Typ vom Server; geht auch
      // das nicht, brechen wir ab statt zu raten.
      let channelType = typeof b.type === 'string' && b.type ? b.type : '';
      let messageTtl = b.messageTtl !== undefined && b.messageTtl !== null ? Number(b.messageTtl) : null;
      if (!channelType || messageTtl === null) {
        try {
          const info = (await client.getChannelInfo(String(req.params.channelId), true)) as unknown as Record<string, unknown>;
          if (!channelType && typeof info.type === 'string') channelType = info.type;
          if (messageTtl === null && info.message_ttl != null) messageTtl = Number(info.message_ttl);
        } catch (infoErr) {
          serverLog(`[Admin] Channel-Typ nicht ermittelbar fuer ${req.params.channelId}:`, errorMessage(infoErr));
        }
      }
      if (!channelType) {
        return res.status(400).json({
          error: 'Der Channel-Typ liess sich nicht ermitteln. Speichern wurde abgebrochen, '
            + 'weil ein falscher Typ die Verschluesselung des Channels aufheben koennte.',
        });
      }

      const data = client.api.createAuthenticatedRequestData({
        company_id: req.params.companyId,
        channel_id: req.params.channelId,
        channel_name: channelName,
        description: typeof b.description === 'string' ? b.description.trim() : '',
        visible: Boolean(b.visible),
        writable: typeof b.writable === 'string' ? b.writable : 'all',
        inviteable: Boolean(b.inviteable),
        type: channelType,
        show_activities: Boolean(b.showActivities),
        show_membership_activities: Boolean(b.showMembershipActivities),
        message_ttl: messageTtl ?? 0,
        ...(password ? { password, password_repeat: password } : {}),
      });
      try {
        const payload = await client.api.post<{ channel?: unknown }>('/manage/edit_channel', data);
        serverLog(`[Admin] Channel ${req.params.channelId} bearbeitet`);
        res.json(payload?.channel ?? { success: true });
      } catch (apiErr) {
        // `missing_values` nennt nicht, welcher Parameter fehlt. Damit ein
        // Fehlerbericht ohne Serverlog auskommt, haengen wir die gesendeten
        // Feldnamen an — Werte bleiben draussen.
        const sentKeys = Object.keys(data as Record<string, unknown>).sort().join(', ');
        serverLog(`[Admin] edit_channel fehlgeschlagen fuer ${req.params.channelId}. Gesendet: ${sentKeys}`);
        throw new Error(`${errorMessage(apiErr, 'Bearbeiten fehlgeschlagen')} — gesendet wurden: ${sentKeys}`);
      }
    } catch (err) {
      res.status(500).json({ error: errorMessage(err, 'Channel konnte nicht bearbeitet werden') });
    }
  },
);

router.delete(
  '/admin/channels/:companyId/:channelId',
  requirePermission('admin_delete_channels'),
  async (req, res) => {
    try {
      const client = req.client!;
      const data = client.api.createAuthenticatedRequestData({
        company_id: req.params.companyId,
        channel_id: req.params.channelId,
      });
      await client.api.post('/manage/delete_channel', data);
      serverLog(`[Admin] Channel ${req.params.channelId} geloescht`);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err, 'Channel konnte nicht geloescht werden') });
    }
  },
);

/** Sichtbarkeit mehrerer Channels auf einmal setzen. */
router.post(
  '/admin/channels/:companyId/visibility',
  requirePermission('admin_edit_channels'),
  async (req, res) => {
    try {
      const client = req.client!;
      const body = req.body as { channelIds?: unknown; visible?: boolean };
      const channelIds = parseIdList(body.channelIds);
      if (!channelIds.length) return res.status(400).json({ error: 'Keine Channels ausgewaehlt' });
      const data = client.api.createAuthenticatedRequestData({
        company_id: req.params.companyId,
        channel_ids: channelIds,
        visible: Boolean(body.visible),
      });
      await client.api.post('/manage/set_channels_visibility', data);
      serverLog(`[Admin] Sichtbarkeit fuer ${channelIds.length} Channel(s) gesetzt`);
      res.json({ success: true, count: channelIds.length });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err, 'Sichtbarkeit konnte nicht gesetzt werden') });
    }
  },
);

router.get(
  '/admin/channels/:companyId/:channelId/members',
  requirePermission('admin_list_channels', 'admin_edit_channels'),
  async (req, res) => {
    try {
      const client = req.client!;
      const { search, limit, offset, filter } = req.query;
      const data = client.api.createAuthenticatedRequestData({
        company_id: req.params.companyId,
        channel_id: req.params.channelId,
        limit: Math.min(Number(limit) || 50, 500),
        offset: Number(offset) || 0,
        search: typeof search === 'string' ? search : '',
        sorting: [normalizeSorting(req.query.sorting)],
        // `filter` ist Pflicht — ohne ihn antwortet die API mit
        // `missing_values`. Siehe normalizeMemberFilter().
        filter: normalizeMemberFilter(filter),
      });
      // Achtung: Dieser Endpunkt liefert `members` — die uebrigen list_*
      // Endpunkte liefern `users`.
      const payload = await client.api.post<{ members?: unknown[] }>(
        '/manage/list_channel_members',
        data,
      );
      res.json(payload?.members ?? []);
    } catch (err) {
      res.status(500).json({ error: errorMessage(err, 'Mitglieder konnten nicht geladen werden') });
    }
  },
);

/** Moderatorenstatus setzen oder entziehen (Body: `userIds`, `moderator`). */
router.post(
  '/admin/channels/:companyId/:channelId/moderators',
  requirePermission('admin_edit_channels'),
  async (req, res) => {
    try {
      const client = req.client!;
      const body = req.body as { userIds?: unknown; moderator?: boolean };
      const userIds = parseIdList(body.userIds);
      if (!userIds.length) return res.status(400).json({ error: 'Keine Nutzer ausgewaehlt' });
      const data = client.api.createAuthenticatedRequestData({
        company_id: req.params.companyId,
        channel_id: req.params.channelId,
        user_ids: userIds,
      });
      const path = body.moderator
        ? '/manage/set_channel_moderator_status'
        : '/manage/remove_channel_moderator_status';
      await client.api.post(path, data);
      serverLog(`[Admin] Moderatorstatus ${body.moderator ? 'gesetzt' : 'entzogen'} fuer ${userIds.length} Nutzer`);
      res.json({ success: true, count: userIds.length });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err, 'Moderatorstatus konnte nicht geaendert werden') });
    }
  },
);

/** Liest die Mitgliederliste und prueft, ob `userId` darin steht. */
async function isMemberNow(
  client: StashcatClient,
  companyId: string,
  channelId: string,
  userId: string,
): Promise<boolean> {
  const data = client.api.createAuthenticatedRequestData({
    company_id: companyId,
    channel_id: channelId,
    limit: 500,
    offset: 0,
    search: '',
    sorting: ['last_name_asc'],
    filter: 'members',
  });
  const payload = await client.api.post<{ members?: Array<{ id?: unknown }> }>(
    '/manage/list_channel_members',
    data,
  );
  return (payload?.members ?? []).some((m) => String(m?.id) === userId);
}

/**
 * Fuehrt einen Teilschritt aus und benennt ihn im Fehlerfall.
 *
 * Mehrere API-Aufrufe hintereinander liefern sonst nur eine nackte Meldung wie
 * `missing_values`, ohne zu verraten, welcher Aufruf sie ausgeloest hat.
 */
async function step<T>(label: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    const msg = errorMessage(err, 'Fehlgeschlagen');
    serverLog(`[Admin] Schritt „${label}" fehlgeschlagen:`, msg);
    throw new Error(`Schritt „${label}": ${msg}`);
  }
}

/**
 * Eigener Zugang zu einem Channel: Bin ich Mitglied, und habe ich den
 * Chat-Schluessel?
 *
 * Beides ist noetig, um jemanden einladen zu koennen — bei verschluesselten
 * Channels braucht die Einladung den Chat-Schluessel, und den bekommt nur, wer
 * drin ist. Die Oberflaeche blendet die Einladefelder danach ein oder aus.
 */
router.get(
  '/admin/channels/:companyId/:channelId/access',
  requirePermission('admin_list_channels', 'admin_edit_channels'),
  async (req, res) => {
    try {
      const client = req.client!;
      const channelId = String(req.params.channelId);

      const me = await client.getMe();
      const myId = String((me as unknown as Record<string, unknown>).id ?? '');

      const memberData = client.api.createAuthenticatedRequestData({
        company_id: req.params.companyId,
        channel_id: channelId,
        limit: 500,
        offset: 0,
        search: '',
        sorting: ['last_name_asc'],
        filter: 'members',
      });
      const memberPayload = await step('Mitgliederliste lesen', () =>
        client.api.post<{ members?: Array<{ id?: unknown }> }>('/manage/list_channel_members', memberData));
      const member = (memberPayload?.members ?? []).some((m) => String(m?.id) === myId);

      let encrypted = false;
      try {
        const info = await client.getChannelInfo(channelId, true);
        encrypted = Boolean((info as unknown as Record<string, unknown>).encrypted);
      } catch {
        // Bei fremden Channels kann /channels/info verweigert werden — dann
        // entscheidet allein der Schluesseltest unten.
      }

      let hasKey = false;
      try {
        await client.getChannelAesKey(channelId);
        hasKey = true;
      } catch {
        hasKey = false;
      }

      res.json({ member, encrypted, hasKey, canInvite: member && (!encrypted || hasKey) });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err, 'Zugang konnte nicht geprueft werden') });
    }
  },
);

/**
 * Sich selbst in einen Channel einschreiben.
 *
 * Es gibt keinen `/manage/*`-Endpunkt fuer Channel-Mitgliedschaft. Der einzige
 * Hebel, der sie ueberhaupt beruehrt, ist der Moderatorstatus — er nimmt
 * beliebige `user_ids`, nicht nur bestehende Mitglieder.
 *
 * **Bei verschluesselten Channels reicht das nicht zum Einladen.** Der
 * Chat-Schluessel liegt nur bei den Mitgliedern; ein neu eingeschriebener Admin
 * bekommt ihn erst, wenn ein bestehendes Mitglied ihn freigibt (Key-Sync). Das
 * ist keine Luecke, sondern der Zweck der Ende-zu-Ende-Verschluesselung. Die
 * Antwort meldet deshalb ehrlich zurueck, ob der Schluessel da ist.
 */

router.post(
  '/admin/channels/:companyId/:channelId/self-enroll',
  requirePermission('admin_edit_channels'),
  async (req, res) => {
    try {
      const client = req.client!;
      const channelId = String(req.params.channelId);
      const me = await step('Eigenen Nutzer laden', () => client.getMe());
      const myId = String((me as unknown as Record<string, unknown>).id ?? '');
      if (!myId) return res.status(500).json({ error: 'Eigene Nutzer-ID nicht ermittelbar' });

      const data = client.api.createAuthenticatedRequestData({
        company_id: req.params.companyId,
        channel_id: channelId,
        user_ids: [myId],
      });
      const payload = await step('Moderatorstatus setzen', () =>
        client.api.post<{ success?: boolean }>('/manage/set_channel_moderator_status', data));
      const accepted = payload?.success === true;

      // Nicht auf `success` vertrauen: nachsehen, ob wirklich eine
      // Mitgliedschaft entstanden ist. `set_channel_moderator_status` ist ein
      // Moderator-Endpunkt — ob er auch einschreibt, entscheidet der Server.
      const checkData = client.api.createAuthenticatedRequestData({
        company_id: req.params.companyId,
        channel_id: channelId,
        limit: 500,
        offset: 0,
        search: '',
        sorting: ['last_name_asc'],
        filter: 'members',
      });
      const memberPayload = await step('Mitgliederliste lesen', () =>
        client.api.post<{ members?: Array<{ id?: unknown }> }>('/manage/list_channel_members', checkData));
      const member = (memberPayload?.members ?? []).some((m) => String(m?.id) === myId);

      // `/channels/join` ist der eigentliche Beitritt — nicht der
      // Moderatorstatus. Er wird deshalb *immer* versucht, auch wenn oben noch
      // keine Mitgliedschaft zu sehen war. Bei offenen Channels gelingt er; bei
      // geschlossenen lehnt der Server ihn mit einer Begruendung ab, die wir
      // durchreichen.
      let joined = false;
      let joinError: string | undefined;
      try {
        await client.joinChannel(channelId);
        joined = true;
      } catch (err) {
        joinError = errorMessage(err, 'Beitritt fehlgeschlagen');
        serverLog(`[Admin] Beitritt zu ${channelId} fehlgeschlagen:`, joinError);
      }

      // Nach dem Beitritt nochmal nachsehen — vorher war die Antwort nur eine
      // Momentaufnahme von vor dem Versuch.
      const finalMember = member || joined
        ? await isMemberNow(client, String(req.params.companyId), channelId, myId)
        : false;

      let hasKey = false;
      if (finalMember) {
        try {
          await client.getChannelAesKey(channelId);
          hasKey = true;
        } catch {
          hasKey = false;
        }
      }

      serverLog(
        `[Admin] Selbsteinschreiben Channel ${channelId}: akzeptiert=${accepted} `
        + `mitglied_vorher=${member} beigetreten=${joined} mitglied_nachher=${finalMember} schluessel=${hasKey}`,
      );
      res.json({ success: accepted, member: finalMember, joined, hasKey, joinError });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err, 'Einschreiben fehlgeschlagen') });
    }
  },
);

/** Sich selbst wieder austragen — Moderatorstatus weg, Channel verlassen. */
router.delete(
  '/admin/channels/:companyId/:channelId/self-enroll',
  requirePermission('admin_edit_channels'),
  async (req, res) => {
    try {
      const client = req.client!;
      const channelId = String(req.params.channelId);
      const me = await client.getMe();
      const myId = String((me as unknown as Record<string, unknown>).id ?? '');

      const data = client.api.createAuthenticatedRequestData({
        company_id: req.params.companyId,
        channel_id: channelId,
        user_ids: [myId],
      });
      await client.api.post('/manage/remove_channel_moderator_status', data);
      // Der Moderatorstatus allein beendet die Mitgliedschaft nicht.
      try {
        await client.quitChannel(channelId);
      } catch (quitErr) {
        serverLog(`[Admin] Austragen aus ${channelId}: quitChannel fehlgeschlagen:`, errorMessage(quitErr));
      }
      serverLog(`[Admin] Selbst aus Channel ${channelId} ausgetragen`);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err, 'Austragen fehlgeschlagen') });
    }
  },
);

router.get(
  '/admin/channels/:companyId/:channelId/statistics',
  requirePermission('admin_list_channels', 'admin_edit_channels'),
  async (req, res) => {
    try {
      const client = req.client!;
      const data = client.api.createAuthenticatedRequestData({
        company_id: req.params.companyId,
        channel_id: req.params.channelId,
      });
      // Die Kennzahlen stecken in payload.statistics, nicht direkt im Payload.
      const payload = await client.api.post<{ statistics?: Record<string, unknown> }>(
        '/manage/get_channel_statistics',
        data,
      );
      res.json(payload?.statistics ?? {});
    } catch (err) {
      res.status(500).json({ error: errorMessage(err, 'Statistik konnte nicht geladen werden') });
    }
  },
);

/**
 * Nutzer in einen Channel einladen.
 *
 * Es gibt hierfuer *keinen* /manage/*-Endpunkt — auch die offizielle
 * Admin-Oberflaeche kann nur Moderatorenrechte setzen. Wir nutzen deshalb den
 * regulaeren Channel-Endpunkt. Ob das auch fuer Channels gilt, in denen der
 * Admin selbst kein Mitglied ist, entscheidet der Stashcat-Server; ein
 * Ablehnen wird als Fehler durchgereicht.
 */
router.post(
  '/admin/channels/:companyId/:channelId/members',
  requirePermission('admin_edit_channels'),
  async (req, res) => {
    try {
      const client = req.client!;
      const userIds = parseIdList((req.body as { userIds?: unknown }).userIds);
      if (!userIds.length) return res.status(400).json({ error: 'Keine Nutzer ausgewaehlt' });
      const result = await inviteUsersToChannel(client, String(req.params.channelId), userIds);
      serverLog(`[Admin] ${userIds.length} Nutzer in Channel ${req.params.channelId} eingeladen`);
      res.json({ success: true, count: result.invited });
    } catch (err) {
      const status = err instanceof InviteError ? 400 : 500;
      res.status(status).json({ error: errorMessage(err, 'Einladen fehlgeschlagen') });
    }
  },
);

/** Nutzer aus einem Channel entfernen. Gleiche Einschraenkung wie oben. */
router.delete(
  '/admin/channels/:companyId/:channelId/members/:userId',
  requirePermission('admin_edit_channels'),
  async (req, res) => {
    try {
      const client = req.client!;
      await client.removeUserFromChannel(String(req.params.channelId), String(req.params.userId));
      serverLog(`[Admin] Nutzer ${req.params.userId} aus Channel ${req.params.channelId} entfernt`);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err, 'Entfernen fehlgeschlagen') });
    }
  },
);

/**
 * Alle Mitglieder einer Gruppe in einen Channel einladen.
 *
 * Einen nativen Endpunkt dafuer gibt es nicht — weder im /manage/*-Namespace
 * noch bei den Channel-Endpunkten. Wir loesen die Gruppe deshalb serverseitig
 * in ihre Mitglieder auf und laden diese gesammelt ein. Das spart dem Browser
 * den Umweg und haelt die Nutzerliste aus dem Frontend heraus.
 *
 * Bereits vorhandene Mitglieder werden uebersprungen, damit die Einladung
 * nicht an ihnen scheitert.
 */
router.post(
  '/admin/channels/:companyId/:channelId/members/group',
  requirePermission('admin_edit_channels'),
  async (req, res) => {
    try {
      const client = req.client!;
      const groupId = (req.body as { groupId?: unknown }).groupId;
      if (!groupId) return res.status(400).json({ error: 'Keine Gruppe angegeben' });

      const groupData = client.api.createAuthenticatedRequestData({
        company_id: req.params.companyId,
        group_id: String(groupId),
        limit: 500,
        offset: 0,
        search: '',
        sorting: ['last_name_asc'],
        filter: 'members',
      });
      const groupPayload = await client.api.post<ManageUsersPayload>(
        '/manage/list_users_by_group',
        groupData,
      );
      const groupUsers = (groupPayload?.users ?? []) as Array<{ id?: unknown }>;
      const groupUserIds = groupUsers.map((u) => String(u?.id)).filter((id) => id && id !== 'undefined');
      if (!groupUserIds.length) {
        return res.status(400).json({ error: 'Die Gruppe hat keine Mitglieder' });
      }

      // Vorhandene Mitglieder herausfiltern.
      const memberData = client.api.createAuthenticatedRequestData({
        company_id: req.params.companyId,
        channel_id: req.params.channelId,
        limit: 500,
        offset: 0,
        search: '',
        sorting: ['last_name_asc'],
        filter: 'members',
      });
      const memberPayload = await client.api.post<{ members?: unknown[] }>(
        '/manage/list_channel_members',
        memberData,
      );
      const existing = new Set(
        ((memberPayload?.members ?? []) as Array<{ id?: unknown }>).map((m) => String(m?.id)),
      );
      const toInvite = groupUserIds.filter((id) => !existing.has(id));

      if (!toInvite.length) {
        return res.json({ invited: 0, skipped: groupUserIds.length, alreadyComplete: true });
      }

      await inviteUsersToChannel(client, String(req.params.channelId), toInvite);
      serverLog(
        `[Admin] Gruppe ${groupId}: ${toInvite.length} von ${groupUserIds.length} in Channel ${req.params.channelId} eingeladen`,
      );
      res.json({
        invited: toInvite.length,
        skipped: groupUserIds.length - toInvite.length,
        alreadyComplete: false,
      });
    } catch (err) {
      const status = err instanceof InviteError ? 400 : 500;
      res.status(status).json({ error: errorMessage(err, 'Gruppe konnte nicht eingeladen werden') });
    }
  },
);

// --- Rollen und Rechte ------------------------------------------------------
// `/permissions/*` liefert und erwartet Rechte als flaches Array von
// snake_case-Strings. Achtung beim Parameternamen: `isGlobal` ist camelCase —
// als einziger in diesem Namespace.

router.post(
  '/admin/roles/:companyId',
  requirePermission('admin_edit_company_roles'),
  async (req, res) => {
    try {
      const client = req.client!;
      const { name, permissions, isGlobal } = req.body as {
        name?: string;
        permissions?: unknown;
        isGlobal?: boolean;
      };
      if (!name?.trim()) return res.status(400).json({ error: 'Name ist ein Pflichtfeld' });
      const data = client.api.createAuthenticatedRequestData({
        company_id: req.params.companyId,
        name: name.trim(),
        permissions: parseIdList(permissions),
        isGlobal: Boolean(isGlobal),
      });
      const payload = await client.api.post<{ role?: unknown }>('/permissions/create', data);
      serverLog(`[Admin] Rolle angelegt: ${name.trim()}`);
      res.json(payload?.role ?? { success: true });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err, 'Rolle konnte nicht angelegt werden') });
    }
  },
);

router.patch(
  '/admin/roles/:companyId/:roleId',
  requirePermission('admin_edit_company_roles'),
  async (req, res) => {
    try {
      const client = req.client!;
      const { name, permissions, isGlobal } = req.body as {
        name?: string;
        permissions?: unknown;
        isGlobal?: boolean;
      };
      if (!name?.trim()) return res.status(400).json({ error: 'Name ist ein Pflichtfeld' });
      const data = client.api.createAuthenticatedRequestData({
        company_id: req.params.companyId,
        role_id: req.params.roleId,
        name: name.trim(),
        permissions: parseIdList(permissions),
        isGlobal: Boolean(isGlobal),
      });
      const payload = await client.api.post<{ role?: unknown }>('/permissions/edit', data);
      serverLog(`[Admin] Rolle ${req.params.roleId} bearbeitet`);
      res.json(payload?.role ?? { success: true });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err, 'Rolle konnte nicht bearbeitet werden') });
    }
  },
);

router.delete(
  '/admin/roles/:companyId/:roleId',
  requirePermission('admin_edit_company_roles'),
  async (req, res) => {
    try {
      const client = req.client!;
      const data = client.api.createAuthenticatedRequestData({
        company_id: req.params.companyId,
        role_id: req.params.roleId,
      });
      await client.api.post('/permissions/delete', data);
      serverLog(`[Admin] Rolle ${req.params.roleId} geloescht`);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: errorMessage(err, 'Rolle konnte nicht geloescht werden') });
    }
  },
);

export default router;
