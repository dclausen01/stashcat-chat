import { Router } from 'express';
import { decryptSession } from '../token-crypto';
import { extractToken, touchCachedClient } from '../lib/get-client';
import { getOfficeDocType, buildViewerConfig, validateDownloadToken, createDownloadToken, PUBLIC_URL } from '../onlyoffice';
import { ncDownload } from '../nextcloud';
import { getNCCred } from '../lib/nextcloud-creds';
import { errorMessage } from '../lib/logging';

const router = Router();

router.get('/onlyoffice/view', async (req, res) => {
  try {
    const client = req.client!;
    const token = extractToken(req);
    const payload = decryptSession(token);
    const { fileId, fileName } = req.query as Record<string, string>;

    if (!fileId || !fileName) {
      return res.status(400).json({ error: 'fileId and fileName required' });
    }

    if (!getOfficeDocType(fileName)) {
      return res.status(400).json({ error: 'Dateityp wird nicht unterstützt' });
    }

    const me = await client.getMe() as unknown as Record<string, unknown>;
    const userId = String(me.id);
    const userName = `${me.first_name || ''} ${me.last_name || ''}`.trim() || 'User';

    const dlToken = createDownloadToken({ fileId, clientKey: payload.clientKey });
    const downloadUrl = `${PUBLIC_URL}/api/onlyoffice/dl?secret=${encodeURIComponent(dlToken)}`;

    const result = buildViewerConfig({ fileId, fileName, userId, userName, downloadUrl });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err, 'OnlyOffice-Konfiguration fehlgeschlagen') });
  }
});

router.post('/onlyoffice/view-nc', async (req, res) => {
  try {
    const creds = await getNCCred(req);
    if (!creds) return res.status(401).json({ error: 'Nextcloud-Zugangsdaten nicht konfiguriert' });

    const { path: filePath, fileName } = req.query as Record<string, string>;
    if (!filePath || !fileName) {
      return res.status(400).json({ error: 'path and fileName required' });
    }

    if (!getOfficeDocType(fileName)) {
      return res.status(400).json({ error: 'Dateityp wird nicht unterstützt' });
    }

    const token = extractToken(req);
    const payload = decryptSession(token);
    const dlToken = createDownloadToken({ ncPath: filePath, ncUsername: creds.username, ncAppPassword: creds.password, clientKey: payload.clientKey });
    const downloadUrl = `${PUBLIC_URL}/api/onlyoffice/dl-nc?secret=${encodeURIComponent(dlToken)}`;

    const userName = creds.username;
    const result = buildViewerConfig({ fileName, userId: creds.username, userName, downloadUrl });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err, 'OnlyOffice-Konfiguration fehlgeschlagen') });
  }
});

router.get('/onlyoffice/dl-nc', async (req, res) => {
  try {
    const { secret } = req.query as { secret: string };
    if (!secret) return res.status(400).json({ error: 'Missing secret' });

    const tokenData = validateDownloadToken(secret);
    if (!tokenData) return res.status(403).json({ error: 'Invalid or expired token' });
    if (!tokenData.ncPath || !tokenData.ncUsername || !tokenData.ncAppPassword) {
      return res.status(403).json({ error: 'Not a valid Nextcloud token' });
    }

    const baseUrl = process.env.NEXTCLOUD_URL || 'https://cloud.bbz-rd-eck.de';
    const creds = { baseUrl, username: tokenData.ncUsername, password: tokenData.ncAppPassword };
    const ncResp = await ncDownload(creds, tokenData.ncPath);
    const buf = Buffer.from(await ncResp.arrayBuffer());
    res.setHeader('Content-Type', ncResp.headers.get('content-type') || 'application/octet-stream');
    res.setHeader('Content-Disposition', 'inline');
    res.send(buf);
  } catch (err) {
    console.error('[OnlyOffice/dl-nc] Error:', err);
    res.status(500).json({ error: errorMessage(err, 'Download fehlgeschlagen') });
  }
});

router.get('/onlyoffice/dl', async (req, res) => {
  try {
    const { secret } = req.query as { secret: string };
    if (!secret) return res.status(400).json({ error: 'Missing secret' });

    const tokenData = validateDownloadToken(secret);
    if (!tokenData) return res.status(403).json({ error: 'Invalid or expired token' });
    if (!tokenData.fileId) return res.status(403).json({ error: 'Not a Stashcat token' });

    const client = touchCachedClient(tokenData.clientKey);
    if (!client) return res.status(403).json({ error: 'Session expired' });

    const info = await client.getFileInfo(tokenData.fileId);
    const buf = await client.downloadFile({
      id: tokenData.fileId,
      encrypted: info.encrypted,
      e2e_iv: info.e2e_iv ?? null,
    });

    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(info.name || 'document')}"`);
    res.setHeader('Content-Type', info.mime || 'application/octet-stream');
    res.send(buf);
  } catch (err) {
    console.error('[OnlyOffice/dl] Error:', err);
    res.status(500).json({ error: errorMessage(err, 'Download failed') });
  }
});

export default router;
