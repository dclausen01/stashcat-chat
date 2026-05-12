import { Router } from 'express';
import multer from 'multer';
import os from 'os';
import path from 'path';
import fs from 'fs/promises';
import { errorMessage } from '../lib/logging';

const router = Router();
const upload = multer({ dest: os.tmpdir() });

router.get('/broadcasts', async (req, res) => {
  try {
    const client = req.client!;
    res.json(await client.listBroadcasts());
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.post('/broadcasts', async (req, res) => {
  try {
    const client = req.client!;
    const { name, memberIds } = req.body as { name: string; memberIds: string[] };
    res.json(await client.createBroadcast(name, memberIds));
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.delete('/broadcasts/:id', async (req, res) => {
  try {
    const client = req.client!;
    await client.deleteBroadcast(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.patch('/broadcasts/:id', async (req, res) => {
  try {
    const client = req.client!;
    const { name } = req.body as { name: string };
    await client.renameBroadcast(req.params.id, name);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.get('/broadcasts/:id/messages', async (req, res) => {
  try {
    const client = req.client!;
    const limit = Number(req.query.limit) || 50;
    const offset = Number(req.query.offset) || 0;
    const messages = await client.getBroadcastContent({
      list_id: req.params.id,
      limit,
      offset,
    });
    res.json(messages);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.post('/broadcasts/:id/messages', async (req, res) => {
  try {
    const client = req.client!;
    const { text } = req.body as { text: string };
    const msg = await client.sendBroadcastMessage({ list_id: req.params.id, text });
    res.json(msg);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.get('/broadcasts/:id/members', async (req, res) => {
  try {
    const client = req.client!;
    const PAGE = 200;
    const all: unknown[] = [];
    let offset = 0;
    while (true) {
      const page = await client.listBroadcastMembers(req.params.id, { limit: PAGE, offset });
      all.push(...page);
      if (page.length < PAGE) break;
      offset += PAGE;
    }
    res.json(all);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.post('/broadcasts/:id/members', async (req, res) => {
  try {
    const client = req.client!;
    const { memberIds } = req.body as { memberIds: string[] };
    await client.addBroadcastMembers(req.params.id, memberIds);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.post('/broadcasts/:listId/upload', upload.single('file'), async (req, res) => {
  let currentPath = req.file?.path;
  try {
    const client = req.client!;
    if (!req.file) throw new Error('No file received');

    const me = await client.getMe();
    const userId = String((me as unknown as { id: string | number }).id);

    const originalName = req.file.originalname;
    const ext = path.extname(originalName);
    const namedPath = currentPath! + ext;
    await fs.rename(currentPath!, namedPath);
    currentPath = namedPath;

    const fileInfo = await client.uploadFile(namedPath, {
      type: 'personal',
      type_id: userId,
      filename: originalName,
    } as any);

    const fileId = String((fileInfo as unknown as Record<string, unknown>).id);
    const msg = await client.sendBroadcastMessage({
      list_id: String(req.params.listId),
      text: typeof req.body.text === 'string' ? req.body.text : '',
      files: JSON.stringify([Number(fileId)]),
      metainfo: { v: 1, style: 'md' },
    });

    res.json({ ok: true, message: msg, file: fileInfo });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err, 'Upload failed') });
  } finally {
    if (currentPath) await fs.unlink(currentPath).catch(() => {});
  }
});

router.delete('/broadcasts/:id/members', async (req, res) => {
  try {
    const client = req.client!;
    const { memberIds } = req.body as { memberIds: string[] };
    await client.removeBroadcastMembers(req.params.id, memberIds);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

export default router;
