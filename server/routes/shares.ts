/**
 * Share-Links fuer Dateien und Ordner (`/share/*`).
 *
 * Nicht von `stashcat-api` gewrappt — die Endpunkte werden direkt ueber
 * `client.api.post()` angesprochen. Antwortform gegen den offiziellen
 * Webclient verifiziert: `payload.share` mit den Feldern id, file_id,
 * folder_id, status, key, url, created, created_by, protected, views,
 * downloads.
 *
 * Hinweis: Ob Share-Links ueberhaupt erlaubt sind, steuert die
 * Company-Einstellung `share_links`. Ist sie aus, antwortet die API mit
 * einem Fehler — der wird unveraendert durchgereicht.
 */

import { Router } from 'express';
import { errorMessage, serverLog } from '../lib/logging';

const router = Router();

interface SharePayload {
  share?: {
    id?: string | number;
    url?: string;
    [key: string]: unknown;
  } | null;
}

/**
 * Die API adressiert Shares immer ueber *beide* Felder — fuer eine Datei ist
 * `folder_id` null und umgekehrt. Genau so macht es auch der offizielle Client.
 */
function shareTarget(fileId?: unknown, folderId?: unknown): Record<string, unknown> {
  return {
    file_id: fileId ? String(fileId) : null,
    folder_id: folderId ? String(folderId) : null,
  };
}

/** Bestehenden Share abrufen. Liefert `null`, wenn es keinen gibt. */
router.get('/shares', async (req, res) => {
  try {
    const client = req.client!;
    const { fileId, folderId } = req.query;
    if (!fileId && !folderId) {
      return res.status(400).json({ error: 'fileId oder folderId erforderlich' });
    }
    const data = client.api.createAuthenticatedRequestData(shareTarget(fileId, folderId));
    const payload = await client.api.post<SharePayload>('/share/get', data);
    // Ohne id ist es kein echter Share, sondern eine Leerantwort.
    res.json(payload?.share?.id ? payload.share : null);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err, 'Share konnte nicht geladen werden') });
  }
});

/** Share anlegen, optional passwortgeschuetzt. */
router.post('/shares', async (req, res) => {
  try {
    const client = req.client!;
    const { fileId, folderId, password } = req.body as {
      fileId?: string;
      folderId?: string;
      password?: string;
    };
    if (!fileId && !folderId) {
      return res.status(400).json({ error: 'fileId oder folderId erforderlich' });
    }
    const data = client.api.createAuthenticatedRequestData({
      ...shareTarget(fileId, folderId),
      password: password?.trim() ? password : null,
    });
    const payload = await client.api.post<SharePayload>('/share/create', data);
    serverLog(`[Share] angelegt fuer ${fileId ? `file=${fileId}` : `folder=${folderId}`}`);
    res.json(payload?.share ?? null);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err, 'Share konnte nicht angelegt werden') });
  }
});

/** Share endgueltig entfernen. */
router.delete('/shares', async (req, res) => {
  try {
    const client = req.client!;
    const { fileId, folderId } = req.body as { fileId?: string; folderId?: string };
    if (!fileId && !folderId) {
      return res.status(400).json({ error: 'fileId oder folderId erforderlich' });
    }
    const data = client.api.createAuthenticatedRequestData(shareTarget(fileId, folderId));
    await client.api.post('/share/delete', data);
    serverLog(`[Share] geloescht fuer ${fileId ? `file=${fileId}` : `folder=${folderId}`}`);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err, 'Share konnte nicht geloescht werden') });
  }
});

/**
 * Share sperren bzw. wieder freigeben. Body-Feld `active` entscheidet:
 * false → /share/revoke, true → /share/reactivate.
 */
router.post('/shares/status', async (req, res) => {
  try {
    const client = req.client!;
    const { fileId, folderId, active } = req.body as {
      fileId?: string;
      folderId?: string;
      active?: boolean;
    };
    if (!fileId && !folderId) {
      return res.status(400).json({ error: 'fileId oder folderId erforderlich' });
    }
    const data = client.api.createAuthenticatedRequestData(shareTarget(fileId, folderId));
    await client.api.post(active ? '/share/reactivate' : '/share/revoke', data);
    serverLog(`[Share] ${active ? 'reaktiviert' : 'gesperrt'}`);
    res.json({ success: true, active: Boolean(active) });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err, 'Status konnte nicht geaendert werden') });
  }
});

export default router;
