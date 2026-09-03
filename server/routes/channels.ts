import { Router } from 'express';
import { StashcatClient } from 'stashcat-api';
import { debugLog, errorMessage, serverLog } from '../lib/logging';
import { DEFAULT_KEY_TTL, encryptAndSignChatKey } from '../lib/signing';
import { InviteError, inviteUsersToChannel } from '../lib/channel-invite';

const router = Router();

router.get('/companies', async (req, res) => {
  try {
    const client = req.client!;
    res.json(await client.getCompanies());
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.get('/channels/:companyId/visible', async (req, res) => {
  try {
    const client = req.client!;
    const channels = await client.getVisibleChannels(req.params.companyId);
    res.json(channels);
  } catch (e) { res.status(500).json({ error: errorMessage(e) }); }
});

router.post('/channels/:channelId/join', async (req, res) => {
  try {
    const client = req.client!;
    await client.joinChannel(req.params.channelId);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: errorMessage(e) }); }
});

router.post('/channels/:channelId/quit', async (req, res) => {
  try {
    const client = req.client!;
    await client.quitChannel(req.params.channelId);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: errorMessage(e) }); }
});

router.post('/channels/invites/:inviteId/accept', async (req, res) => {
  try {
    const client = req.client!;
    const inviteId = req.params.inviteId;
    const { notificationId } = req.body as { notificationId?: string };
    serverLog(`[channel-invite] ACCEPT invite_id=${inviteId}`);
    const data = client.api.createAuthenticatedRequestData({ invite_id: inviteId });
    await client.api.post('/channels/acceptInvite', data);
    if (notificationId) {
      try { await client.deleteNotification(notificationId); } catch { /* best-effort */ }
    }
    serverLog(`[channel-invite] ACCEPT invite_id=${inviteId} — success`);
    res.json({ ok: true });
  } catch (e) {
    serverLog(`[channel-invite] ACCEPT invite_id=${req.params.inviteId} — FAILED: ${errorMessage(e)}`);
    res.status(500).json({ error: errorMessage(e) });
  }
});

router.post('/channels/invites/:inviteId/decline', async (req, res) => {
  try {
    const client = req.client!;
    const inviteId = req.params.inviteId;
    const { notificationId } = req.body as { notificationId?: string };
    serverLog(`[channel-invite] DECLINE invite_id=${inviteId}`);
    const data = client.api.createAuthenticatedRequestData({ invite_id: inviteId });
    await client.api.post('/channels/declineInvite', data);
    if (notificationId) {
      try { await client.deleteNotification(notificationId); } catch { /* best-effort */ }
    }
    serverLog(`[channel-invite] DECLINE invite_id=${inviteId} — success`);
    res.json({ ok: true });
  } catch (e) {
    serverLog(`[channel-invite] DECLINE invite_id=${req.params.inviteId} — FAILED: ${errorMessage(e)}`);
    res.status(500).json({ error: errorMessage(e) });
  }
});

router.post('/channels/:channelId/favorite', async (req, res) => {
  try {
    const client = req.client!;
    const { favorite } = req.body as { favorite: boolean };
    await client.setChannelFavorite(req.params.channelId, Boolean(favorite));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: errorMessage(e) }); }
});

router.get('/channels/:companyId', async (req, res) => {
  try {
    const client = req.client!;
    const channels = await client.getChannels(req.params.companyId);
    const mapped = channels.map((ch) => {
      const membership = (ch as any).membership;
      return {
        ...ch,
        muted: membership?.muted ?? null,
      };
    });
    res.json(mapped);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.get('/channels/:channelId/members', async (req, res) => {
  try {
    const client = req.client!;
    const channelId = req.params.channelId;
    const all: unknown[] = [];
    const PAGE = 100;
    let offset = 0;
    while (true) {
      const batch = await client.getChannelMembers(channelId, { limit: PAGE, offset });
      const nonPending = batch.filter((m) => {
        const pending = (m as any).membership_pending === true || (m as any).pending === true;
        return !pending;
      });
      all.push(...nonPending);
      if (batch.length < PAGE) break;
      offset += PAGE;
    }
    console.log(`[channels/members] channelId=${channelId} → ${all.length} members (excluding pending)`);
    if (all.length > 0) console.log('[channels/members] first member:', JSON.stringify(all[0]));
    res.json(all);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.get('/channels/:channelId/pending-members', async (req, res) => {
  try {
    const client = req.client!;
    const channelId = req.params.channelId;
    const all: unknown[] = [];
    const PAGE = 100;
    let offset = 0;
    while (true) {
      const batch = await client.getChannelMembers(channelId, { limit: PAGE, offset, filter: 'membership_pending' });
      all.push(...batch);
      if (batch.length < PAGE) break;
      offset += PAGE;
    }
    console.log(`[channels/pending-members] channelId=${channelId} → ${all.length} pending members`);
    res.json(all);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.post('/channels/:channelId/notifications', async (req, res) => {
  try {
    const client = req.client!;
    const channelId = req.params.channelId;
    const { enabled, duration } = req.body as { enabled: boolean; duration?: number };
    if (enabled) {
      await client.enableChannelNotifications(channelId);
      console.log(`[channels/notifications] enabled for ${channelId}`);
    } else {
      const muteDuration = duration && duration > 0 ? duration : 2147483647;
      await client.disableChannelNotifications(channelId, muteDuration);
      console.log(`[channels/notifications] disabled for ${channelId} (duration=${muteDuration})`);
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.post('/channels/:channelId/invite', async (req, res) => {
  try {
    const client = req.client!;
    const { userIds } = req.body as { userIds: string[] };
    const result = await inviteUsersToChannel(client, req.params.channelId, userIds);
    res.json({ ok: true, ...result });
  } catch (err) {
    // Eine InviteError traegt eine Erklaerung, die direkt angezeigt werden kann.
    const status = err instanceof InviteError ? 400 : 500;
    res.status(status).json({ error: errorMessage(err) });
  }
});

router.delete('/channels/:channelId/members/:userId', async (req, res) => {
  try {
    const client = req.client!;
    await client.removeUserFromChannel(req.params.channelId, req.params.userId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.post('/channels/:channelId/moderator/:userId', async (req, res) => {
  try {
    const client = req.client!;
    await client.addChannelModerator(req.params.channelId, req.params.userId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.delete('/channels/:channelId/moderator/:userId', async (req, res) => {
  try {
    const client = req.client!;
    await client.removeChannelModerator(req.params.channelId, req.params.userId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.patch('/channels/:channelId', async (req, res) => {
  try {
    const client = req.client!;
    const { description, company_id, name } = req.body as { description?: string; company_id: string; name?: string };
    const result = await client.editChannel({
      channel_id: req.params.channelId,
      company_id,
      description,
      ...(name !== undefined ? { channel_name: name } : {}),
    });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.post('/channels/:channelId/image', async (req, res) => {
  try {
    const client = req.client!;
    const { company_id, image } = req.body as { company_id: string; image: string };
    const api = (client as any).api;
    if (!api || typeof api.createAuthenticatedRequestData !== 'function') {
      throw new Error('API client not available');
    }
    const requestData = api.createAuthenticatedRequestData({
      channel_id: req.params.channelId,
      company_id,
      imgBase64: image,
    });
    const result = await api.post('/channels/setImage', requestData);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err, 'Failed to set channel image') });
  }
});

router.get('/channels/:channelId/info', async (req, res) => {
  try {
    const client = req.client!;
    const ch = await client.getChannelInfo(req.params.channelId, true);
    res.json(ch);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.delete('/channels/:channelId', async (req, res) => {
  try {
    const client = req.client!;
    const { channelId } = req.params;
    await client.deleteChannel(channelId);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err, 'Failed to delete channel') });
  }
});

router.get('/companies/:companyId/members', async (req, res) => {
  try {
    const client = req.client!;
    const search = req.query.search as string | undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    const offset = req.query.offset ? Number(req.query.offset) : undefined;

    const result = await client.listManagedUsers(req.params.companyId, { search, limit, offset });
    res.json({ users: result.users, total: result.total });
  } catch (err) {
    console.error('[company-members] Error:', err);
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.get('/companies/:companyId/groups', async (req, res) => {
  try {
    const client = req.client!;
    const groups = await client.listGroups(req.params.companyId);
    res.json(groups);
  } catch (err) {
    console.error('[company-groups] Error:', err);
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.get('/companies/:companyId/groups/:groupId/members', async (req, res) => {
  try {
    const client = req.client!;
    const PAGE = 200;
    const allUsers: unknown[] = [];
    let offset = 0;
    let total = 0;
    while (true) {
      const result = await client.listManagedUsers(req.params.companyId, {
        groupIds: [req.params.groupId],
        limit: PAGE,
        offset,
      });
      allUsers.push(...(result.users as unknown[]));
      total = result.total ?? allUsers.length;
      if ((result.users as unknown[]).length < PAGE) break;
      offset += PAGE;
    }
    res.json({ users: allUsers, total });
  } catch (err) {
    console.error('[group-members] Error:', err);
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.post('/channels', async (req, res) => {
  try {
    const client = req.client!;
    const {
      name, company_id, description, policies,
      channel_type,
      hidden, invite_only, read_only,
      show_activities, show_membership_activities,
      password, password_repeat,
    } = req.body as {
      name: string;
      company_id: string;
      description?: string;
      policies?: string;
      channel_type?: string;
      hidden?: boolean;
      invite_only?: boolean;
      read_only?: boolean;
      show_activities?: boolean;
      show_membership_activities?: boolean;
      password?: string;
      password_repeat?: string;
    };

    const isEncrypted = channel_type === 'encrypted';
    const isPassword  = channel_type === 'password';

    const cryptoGen = await import('crypto');
    const uniqueIdentifier = cryptoGen.randomBytes(16).toString('hex');

    const channelOpts: Parameters<typeof client.createChannel>[0] & Record<string, unknown> = {
      unique_identifier: uniqueIdentifier,
      channel_name: name,
      company: company_id,
      description: [description, policies ? `\n\nRichtlinien: ${policies}` : ''].filter(Boolean).join(''),
      type: isEncrypted ? 'closed' : 'public',
      visible: !hidden,
      writable: read_only ? 'manager' : 'all',
      inviteable: invite_only ? 'manager' : 'all',
      show_activities: show_activities ?? true,
      show_membership_activities: show_membership_activities ?? true,
      message_ttl: 0,
      ...(isPassword && password ? { password, password_repeat: password_repeat ?? password } : {}),
    };

    if (isEncrypted) {
      const aesKey = cryptoGen.randomBytes(32);

      if (!client.isE2EUnlocked()) {
        return res.status(400).json({ error: 'E2E not unlocked — encrypted channels require E2E. Please re-login with your security password.' });
      }

      const me = await client.getMe();
      if (!me.public_key) {
        return res.status(500).json({ error: 'Own public key not available' });
      }

      debugLog(`[channels/create] aesKey length=${aesKey.length} E2E_unlocked=${client.isE2EUnlocked()}`);
      debugLog(`[channels/create] public_key prefix="${me.public_key.slice(0, 40).replace(/\n/g, '\\n')}"`);

      const encryptedKey = StashcatClient.encryptWithPublicKey(me.public_key, aesKey);
      const keyBase64 = encryptedKey.toString('base64');
      channelOpts.encryption_key = keyBase64;

      // Der Originalclient signiert den Channel-Schluessel mit dem privaten
      // Signierschluessel ueber `<key>$<unique_identifier>` — ohne Ablauf und
      // ohne Mitgliederliste (`generateKeyObject(..., ttl = null)`).
      const signed = await encryptAndSignChatKey(client, keyBase64, { chatId: uniqueIdentifier });
      if (signed.signature) channelOpts.encryption_key_signature = signed.signature;

      debugLog(`[channels/create] encryptedKey length=${encryptedKey.length} keyBase64 length=${keyBase64.length}`);
      debugLog(`[channels/create] signature=${signed.signature ? `${signed.signature.length} hex chars` : 'none (kein Signierschluessel)'}`);
    }

    const channel = await client.createChannel(channelOpts);
    const channelId = String((channel as unknown as Record<string,unknown>).id ?? '');
    debugLog(`[channels/create] created channel id=${channelId} name=${(channel as unknown as Record<string,unknown>).name ?? name} encrypted=${(channel as unknown as Record<string,unknown>).encrypted}`);
    debugLog(`[channels/create] response key length=${String((channel as unknown as Record<string,unknown>).key ?? '').length} key_sender=${(channel as unknown as Record<string,unknown>).key_sender}`);

    if (isEncrypted && channelId) {
      try {
        const aesKeyFromServer = await client.getChannelAesKey(channelId);
        debugLog(`[channels/create] SELF-TEST getChannelAesKey: SUCCESS aesKey length=${aesKeyFromServer?.length}`);
      } catch (selfTestErr) {
        debugLog(`[channels/create] SELF-TEST getChannelAesKey: FAILED — ${errorMessage(selfTestErr, '')}`);
      }
    }

    res.json(channel);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err, 'Failed to create channel') });
  }
});

/**
 * Verteilt den AES-Schluessel eines verschluesselten Channels an Mitglieder,
 * denen er fehlt.
 *
 * Ohne `userIds` fragt die Route den Server, wem der Schluessel fehlt
 * (`/security/get_missing_keys`), und bedient genau diese Nutzer.
 *
 * Der Schluessel wird pro Empfaenger mit dessen Public Key verschluesselt und
 * mit dem eigenen **Signierschluessel** signiert — Feldnamen und signierte
 * Zeichenkette wie im offiziellen Client (siehe `docs/signing-keys.md`).
 */
router.post('/channels/:channelId/keys', async (req, res) => {
  try {
    const client = req.client!;
    const channelId = req.params.channelId;
    const { userIds } = req.body as { userIds?: Array<string | number> };

    if (!client.isE2EUnlocked()) {
      return res.status(400).json({ error: 'E2E not unlocked' });
    }

    const channel = await client.getChannelInfo(channelId, true);
    const uniqueIdentifier = (channel as unknown as Record<string, unknown>).unique_identifier as string | undefined;
    const aesKey = await client.getChannelAesKey(channelId);

    let targets = (userIds ?? []).map(String).filter(Boolean);
    if (targets.length === 0) {
      // Niemand explizit genannt: den Server fragen, wem der Schluessel fehlt.
      const missing = await client.api.post<{ content: { channels?: Array<{ id: string; foreign_user_id?: string }> } }>(
        '/security/get_missing_keys',
        client.api.createAuthenticatedRequestData({}),
      );
      targets = (missing.content.channels ?? [])
        .filter((c) => String(c.id) === String(channelId) && c.foreign_user_id)
        .map((c) => String(c.foreign_user_id));
    }
    if (targets.length === 0) {
      return res.json({ ok: true, processed: 0, errors: 0, message: 'Keine offenen Schluessel' });
    }

    // Public Keys der Empfaenger holen — zum Verschluesseln zaehlt der
    // Verschluesselungsschluessel im PEM-Format.
    const keyData = client.api.createAuthenticatedRequestData({
      user_ids: JSON.stringify(targets),
      type: 'encryption',
    });
    const keyResp = await client.api.post<{ public_keys?: Array<{ user_id: string; type: string; format: string; public_key: string }> }>(
      '/security/get_public_keys',
      keyData,
    );
    const publicKeys = new Map(
      (keyResp.public_keys ?? [])
        .filter((k) => k.type === 'encryption' && k.format === 'pem')
        .map((k) => [String(k.user_id), k.public_key] as const),
    );

    let processed = 0;
    let errors = 0;
    for (const userId of targets) {
      try {
        const publicKey = publicKeys.get(userId);
        if (!publicKey) { errors++; continue; }

        const keyBase64 = StashcatClient.encryptWithPublicKey(publicKey, aesKey).toString('base64');
        const signed = await encryptAndSignChatKey(client, keyBase64, {
          chatId: uniqueIdentifier,
          ttl: DEFAULT_KEY_TTL,
        });

        await client.api.post('/security/set_missing_key', client.api.createAuthenticatedRequestData({
          user_id: userId,
          type: 'channel',
          type_id: channelId,
          key: signed.encrypted,
          signature: signed.signature ?? '',
          expiry: signed.expiryTimestamp != null ? String(signed.expiryTimestamp) : '',
        }));
        processed++;
      } catch (itemErr) {
        errors++;
        serverLog(`[channels/keys] user ${userId} failed:`, errorMessage(itemErr));
      }
    }

    serverLog(`[channels/keys] channel ${channelId}: ${processed} verteilt, ${errors} Fehler`);
    res.json({ ok: true, processed, errors });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err, 'Failed to set channel keys') });
  }
});

export default router;
