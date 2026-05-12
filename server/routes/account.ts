import { Router } from 'express';
import { errorMessage } from '../lib/logging';

const router = Router();

router.get('/me', async (req, res) => {
  try {
    const client = req.client!;
    res.json(await client.getMe());
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.get('/account/settings', async (req, res) => {
  try {
    const client = req.client!;
    res.json(await client.getAccountSettings());
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.post('/account/status', async (req, res) => {
  try {
    const client = req.client!;
    const { status } = req.body;
    await client.changeStatus(status);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.post('/account/profile-image', async (req, res) => {
  try {
    const client = req.client!;
    const { imgBase64 } = req.body;
    await client.storeProfileImage(imgBase64);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.post('/account/profile-image/reset', async (req, res) => {
  try {
    const client = req.client!;
    await client.resetProfileImage();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

export default router;
