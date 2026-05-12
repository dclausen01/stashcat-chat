import { Router } from 'express';
import { decryptSession } from '../token-crypto';
import { extractToken } from '../lib/get-client';
import { activeSSE } from '../lib/state';
import { errorMessage, serverLog } from '../lib/logging';

const router = Router();

router.post('/call/get_turn_server', async (req, res) => {
  try {
    const client = req.client!;
    const data = client.api.createAuthenticatedRequestData({});
    const result = await client.api.post<{ turn_server: unknown }>('/call/get_turn_server', data);
    res.json(result.turn_server);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err, 'TURN server request failed') });
  }
});

router.post('/call/create', async (req, res) => {
  try {
    const client = req.client!;
    const { callee_id, target_id, target, type, verification } = req.body as Record<string, string>;
    const data = client.api.createAuthenticatedRequestData({
      callee_id,
      target_id: String(target_id),
      target: target || 'conversation',
      type: type || 'audio',
      verification,
    });
    const result = await client.api.post<{ call: unknown }>('/call/create', data);
    res.json(result.call);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err, 'Call creation failed') });
  }
});

router.post('/call/signal', async (req, res) => {
  try {
    const token = extractToken(req);
    const sessionPayload = decryptSession(token);
    const { clientKey, deviceId } = sessionPayload;
    const conn = activeSSE.get(clientKey);
    if (!conn?.realtime) {
      return res.status(503).json({ error: 'Not connected to realtime' });
    }
    const socket = (conn.realtime as unknown as {
      socket: { emit: (event: string, ...args: unknown[]) => void } | null;
    }).socket;
    if (!socket) {
      return res.status(503).json({ error: 'Socket not available' });
    }
    const signalData = { ...req.body as Record<string, unknown>, deviceId };
    socket.emit('signal', signalData);
    serverLog(`[Call] Signal emitted: signalType=${(req.body as Record<string, unknown>).signalType}, call_id=${(req.body as Record<string, unknown>).call_id}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err, 'Signal send failed') });
  }
});

router.post('/call/end', async (req, res) => {
  try {
    const client = req.client!;
    const { call_id } = req.body as { call_id: number | string };
    const data = client.api.createAuthenticatedRequestData({ call_id: String(call_id) });
    await client.api.post('/call/end', data);
    res.json({ ok: true });
  } catch {
    res.json({ ok: true });
  }
});

export default router;
