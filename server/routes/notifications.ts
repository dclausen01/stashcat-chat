import { Router } from 'express';
import { errorMessage, serverLog } from '../lib/logging';

const router = Router();

router.get('/notifications', async (req, res) => {
  try {
    const client = req.client!;
    const limit = Number(req.query.limit) || 50;
    const offset = Number(req.query.offset) || 0;
    const notifications = await client.getNotifications(limit, offset);
    serverLog(`[notifications] GET limit=${limit} offset=${offset} → ${Array.isArray(notifications) ? notifications.length : 0} notifications`);
    res.json(notifications);
  } catch (err) {
    serverLog(`[notifications] GET error: ${errorMessage(err)}`);
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.get('/notifications/count', async (req, res) => {
  try {
    const client = req.client!;
    const count = await client.getNotificationCount();
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.delete('/notifications/:notificationId', async (req, res) => {
  try {
    const client = req.client!;
    const notificationId = req.params.notificationId;
    serverLog(`[notifications] DELETE id=${notificationId}`);
    await client.deleteNotification(notificationId);
    serverLog(`[notifications] DELETE id=${notificationId} — success`);
    res.json({ ok: true });
  } catch (err) {
    serverLog(`[notifications] DELETE id=${req.params.notificationId} — FAILED: ${errorMessage(err)}`);
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.delete('/notifications', async (req, res) => {
  try {
    const client = req.client!;
    serverLog(`[notifications] DELETE ALL (serial)`);

    const notifications = await client.getNotifications(200, 0);
    const items = Array.isArray(notifications) ? notifications : [];
    serverLog(`[notifications] DELETE ALL — found ${items.length} notifications`);

    let deleted = 0;
    let errors = 0;
    for (const n of items) {
      const id = String((n as unknown as Record<string, unknown>).id ?? '');
      if (!id) continue;
      try {
        await client.deleteNotification(id);
        deleted++;
      } catch (err) {
        errors++;
        serverLog(`[notifications] DELETE ALL — failed for id=${id}: ${errorMessage(err)}`);
      }
    }

    serverLog(`[notifications] DELETE ALL — done: ${deleted} deleted, ${errors} errors`);
    res.json({ ok: true, deleted, errors });
  } catch (err) {
    serverLog(`[notifications] DELETE ALL — FAILED: ${errorMessage(err)}`);
    res.status(500).json({ error: errorMessage(err) });
  }
});

export default router;
