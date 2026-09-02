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
import { errorMessage, serverLog } from '../lib/logging';
import { getPermissions, normalizeSorting, parseIdList, requirePermission } from '../lib/admin';

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

export default router;
