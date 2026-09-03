import { StashcatClient } from 'stashcat-api';
import { DEFAULT_KEY_TTL, encryptAndSignChatKey } from './signing';
import { serverLog } from './logging';

/**
 * Einladung von Nutzern in einen Channel — nachgebaut nach
 * `ChannelsService.createChannelInvite` des offiziellen Webclients.
 *
 * `stashcat-api` schickt `users` als Liste blanker IDs. Der Server erwartet
 * dort **Objekte**: bei verschluesselten Channels mit dem fuer den jeweiligen
 * Empfaenger verschluesselten Chat-Schluessel, sonst mit `key: null`.
 *
 * Wichtig zum Verstaendnis: Eine Einladung macht aus dem Nutzer **kein
 * Mitglied**. Er landet als *ausstehend* im Channel und muss die Einladung
 * annehmen — im offiziellen Client heisst das `addPendingMembersTemp`.
 */

interface InviteUserEntry {
  id: string;
  key: string | null;
  expiry: number | null;
  userVerified: boolean;
  signature?: string;
}

interface PublicKeyEntry {
  user_id: string;
  type: string;
  format: string;
  public_key: string;
}

export interface InviteResult {
  invited: number;
  /** Wurde der Chat-Schluessel gleich mitgegeben? */
  withKeys: boolean;
}

/** Fehler mit einer Erklaerung, die dem Nutzer direkt angezeigt werden kann. */
export class InviteError extends Error {}

/**
 * Holt die Verschluesselungs-Public-Keys (PEM) der Empfaenger.
 * Der offizielle Client nutzt dafuer `/users/info`; `/security/get_public_keys`
 * liefert dasselbe Material gezielter.
 */
async function fetchPublicKeys(client: StashcatClient, userIds: string[]): Promise<Map<string, string>> {
  const data = client.api.createAuthenticatedRequestData({
    user_ids: JSON.stringify(userIds),
    type: 'encryption',
  });
  const payload = await client.api.post<{ public_keys?: PublicKeyEntry[] }>('/security/get_public_keys', data);
  return new Map(
    (payload.public_keys ?? [])
      .filter((k) => k.type === 'encryption' && k.format === 'pem' && k.public_key)
      .map((k) => [String(k.user_id), k.public_key] as const),
  );
}

export async function inviteUsersToChannel(
  client: StashcatClient,
  channelId: string,
  userIds: string[],
  text = '',
): Promise<InviteResult> {
  if (!userIds.length) throw new InviteError('Keine Nutzer ausgewaehlt');

  const channel = await client.getChannelInfo(channelId, true);
  const raw = channel as unknown as Record<string, unknown>;
  const isEncrypted = Boolean(raw.encrypted);
  const channelType = String(raw.type ?? '');
  const uniqueIdentifier = raw.unique_identifier as string | undefined;

  let entries: InviteUserEntry[];

  // Der Webclient gibt den Schluessel nur bei den klassisch verschluesselten
  // Channels mit — beim neueren Typ "encrypted" (Megolm) laeuft die
  // Schluesselverteilung getrennt.
  const needsKeys = isEncrypted && channelType !== 'encrypted';

  if (needsKeys) {
    let aesKey: Buffer;
    try {
      aesKey = await client.getChannelAesKey(channelId);
    } catch {
      // Ohne eigene Mitgliedschaft gibt es keinen Chat-Schluessel — und ohne
      // den laesst sich niemand einladen. Das ist keine Luecke im Client,
      // sondern die Ende-zu-Ende-Verschluesselung, die genau das verhindert.
      throw new InviteError(
        'Der Channel ist Ende-zu-Ende-verschluesselt und du bist selbst kein Mitglied. ' +
          'Ohne den Chat-Schluessel kann niemand eingeladen werden — das muss ein Mitglied ' +
          'oder Moderator des Channels erledigen.',
      );
    }

    const publicKeys = await fetchPublicKeys(client, userIds);
    const missing = userIds.filter((id) => !publicKeys.has(id));
    if (missing.length) {
      // Genau wie der Originalclient: lieber gar nicht einladen als einen Teil
      // ohne Schluessel — die betroffenen Nutzer koennten sonst nichts lesen.
      throw new InviteError(
        `Fuer ${missing.length} von ${userIds.length} Nutzern liegt kein oeffentlicher Schluessel vor ` +
          '(Konto noch nicht aktiviert?). Es wurde niemand eingeladen.',
      );
    }

    entries = await Promise.all(
      userIds.map(async (id) => {
        const keyBase64 = StashcatClient.encryptWithPublicKey(publicKeys.get(id)!, aesKey).toString('base64');
        const signed = await encryptAndSignChatKey(client, keyBase64, {
          chatId: uniqueIdentifier,
          ttl: DEFAULT_KEY_TTL,
        });
        return {
          id,
          key: signed.encrypted,
          expiry: signed.expiryTimestamp,
          userVerified: true,
          ...(signed.signature ? { signature: signed.signature } : {}),
        };
      }),
    );
  } else {
    entries = userIds.map((id) => ({ id, key: null, expiry: null, userVerified: true }));
  }

  const data = client.api.createAuthenticatedRequestData({
    channel_id: channelId,
    users: JSON.stringify(entries),
    text,
  });
  const payload = await client.api.post<{ success?: boolean }>('/channels/createInvite', data);

  // `api.post` wirft nur, wenn `status.value !== "OK"`. Der Server kann aber
  // mit OK antworten und trotzdem `success: false` melden — genau darauf
  // prueft der offizielle Client. Ohne diese Pruefung meldet die Oberflaeche
  // Erfolg, obwohl nichts passiert ist.
  if (payload?.success !== true) {
    throw new InviteError(
      'Der Server hat die Einladung abgelehnt. Moeglicherweise fehlt die Berechtigung ' +
        'fuer diesen Channel — Einladungen setzen in der Regel eine eigene Mitgliedschaft ' +
        'oder Moderatorenrechte voraus.',
    );
  }

  serverLog(`[Invite] ${userIds.length} Nutzer in Channel ${channelId} eingeladen (Schluessel: ${needsKeys ? 'ja' : 'nein'})`);
  return { invited: userIds.length, withKeys: needsKeys };
}
