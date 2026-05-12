import { Router } from 'express';
import multer from 'multer';
import os from 'os';
import fs from 'fs/promises';
import { ncListFolder, ncDownload, ncUpload, ncDelete, ncMove, ncMkcol, ncQuota, ncProbe, ncCreateShare } from '../nextcloud';
import { getNCCred, getNCCreds } from '../lib/nextcloud-creds';
import { errorMessage } from '../lib/logging';

const router = Router();
const upload = multer({ dest: os.tmpdir() });

router.get('/nextcloud/status', async (req, res) => {
  try {
    const result = await getNCCreds(req);
    if (!result) {
      return res.json({ configured: false, needsAppPassword: true });
    }
    res.json({ configured: true, authMode: result.authMode, username: result.creds.username });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.get('/nextcloud/probe', async (req, res) => {
  try {
    const result = await getNCCreds(req);
    if (!result) {
      return res.json({ configured: false, needsAppPassword: true });
    }
    const probe = await ncProbe(result.creds);
    if (probe.ok) {
      return res.json({ configured: true, authMode: result.authMode, username: result.creds.username });
    }
    if (probe.reason === 'throttled') {
      return res.json({ configured: true, throttled: true, authMode: result.authMode, username: result.creds.username });
    }
    if (probe.reason === 'auth') {
      return res.json({ configured: false, needsAppPassword: true, reason: 'auth' });
    }
    return res.json({ configured: false, reason: probe.reason, status: probe.status });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.get('/nextcloud/folder', async (req, res) => {
  try {
    const creds = await getNCCred(req);
    if (!creds) return res.status(401).json({ error: 'Nextcloud-Zugangsdaten nicht konfiguriert', needsAppPassword: true });
    const folderPath = (req.query.path as string) || '/';
    const entries = await ncListFolder(creds, folderPath);
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.get('/nextcloud/file', async (req, res) => {
  try {
    const creds = await getNCCred(req);
    if (!creds) return res.status(401).json({ error: 'Nextcloud-Zugangsdaten nicht konfiguriert' });
    const filePath = req.query.path as string;
    if (!filePath) return res.status(400).json({ error: 'path required' });

    const ncRes = await ncDownload(creds, filePath);
    const contentType = ncRes.headers.get('content-type') || 'application/octet-stream';
    const disposition = req.query.view === '1' ? 'inline' : 'attachment';
    const fileName = filePath.split('/').pop() || 'download';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(fileName)}"`);
    const buf = Buffer.from(await ncRes.arrayBuffer());
    res.send(buf);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.post('/nextcloud/upload', upload.single('file'), async (req, res) => {
  const tmpPath = req.file?.path;
  try {
    const creds = await getNCCred(req);
    if (!creds) return res.status(401).json({ error: 'Nextcloud-Zugangsdaten nicht konfiguriert' });
    if (!req.file) throw new Error('No file received');

    const folderPath = (req.body as Record<string, string>).path || '/';
    const originalName = req.file.originalname;
    const targetPath = folderPath.replace(/\/$/, '') + '/' + originalName;
    const buf = await fs.readFile(tmpPath!);

    await ncUpload(creds, targetPath, buf, req.file.mimetype || 'application/octet-stream');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  } finally {
    if (tmpPath) await fs.unlink(tmpPath).catch(() => {});
  }
});

router.post('/nextcloud/delete', async (req, res) => {
  try {
    const creds = await getNCCred(req);
    if (!creds) return res.status(401).json({ error: 'Nextcloud-Zugangsdaten nicht konfiguriert' });
    const { paths } = req.body as { paths: string[] };
    for (const p of paths) await ncDelete(creds, p);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.post('/nextcloud/mkcol', async (req, res) => {
  try {
    const creds = await getNCCred(req);
    if (!creds) return res.status(401).json({ error: 'Nextcloud-Zugangsdaten nicht konfiguriert' });
    const { path: folderPath } = req.body as { path: string };
    await ncMkcol(creds, folderPath);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.post('/nextcloud/move', async (req, res) => {
  try {
    const creds = await getNCCred(req);
    if (!creds) return res.status(401).json({ error: 'Nextcloud-Zugangsdaten nicht konfiguriert' });
    const { from, to } = req.body as { from: string; to: string };
    await ncMove(creds, from, to);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.post('/nextcloud/rename', async (req, res) => {
  try {
    const creds = await getNCCred(req);
    if (!creds) return res.status(401).json({ error: 'Nextcloud-Zugangsdaten nicht konfiguriert' });
    const { path: filePath, newName } = req.body as { path: string; newName: string };
    const parent = filePath.substring(0, filePath.lastIndexOf('/')) || '/';
    const newPath = parent.replace(/\/$/, '') + '/' + newName;
    await ncMove(creds, filePath, newPath);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.post('/nextcloud/share', async (req, res) => {
  try {
    const creds = await getNCCred(req);
    if (!creds) return res.status(401).json({ error: 'Nextcloud-Zugangsdaten nicht konfiguriert' });
    const { path: filePath, password, permissions } = req.body as { path: string; password?: string; permissions?: number };
    const result = await ncCreateShare(creds, filePath, password, permissions);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.get('/nextcloud/quota', async (req, res) => {
  try {
    const creds = await getNCCred(req);
    if (!creds) return res.status(401).json({ error: 'Nextcloud-Zugangsdaten nicht konfiguriert' });
    const quota = await ncQuota(creds);
    res.json(quota);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

export default router;
