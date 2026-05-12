import { Router } from 'express';
import { errorMessage } from '../lib/logging';

const router = Router();

router.get('/calendar/events', async (req, res) => {
  try {
    const client = req.client!;
    const start = Number(req.query.start);
    const end = Number(req.query.end);
    if (!start || !end) return res.status(400).json({ error: 'start and end required' });
    res.json(await client.listEvents({ start, end }));
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.get('/calendar/events/:id', async (req, res) => {
  try {
    const client = req.client!;
    const event = await client.getEventDetails([req.params.id]);
    if (!event) return res.status(404).json({ error: 'Event not found' });
    res.json(event);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.post('/calendar/events', async (req, res) => {
  try {
    const client = req.client!;
    const { notify_chat_id, notify_chat_type, ...eventData } = req.body;
    const eventId = await client.createEvent(eventData);

    if (notify_chat_id && notify_chat_type && eventId) {
      try {
        const eName = eventData.name || 'Unbenannt';
        const startTs = Number(eventData.start);
        const endTs = Number(eventData.end);
        const isAllday = eventData.allday === true || eventData.allday === '1';
        const dateOpts: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' };
        const timeOpts: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
        const startDate = new Date(startTs * 1000).toLocaleDateString('de-DE', dateOpts);
        const endDate = new Date(endTs * 1000).toLocaleDateString('de-DE', dateOpts);
        const startTime = isAllday ? '' : `, ${new Date(startTs * 1000).toLocaleTimeString('de-DE', timeOpts)} Uhr`;
        const endTime = isAllday ? '' : `, ${new Date(endTs * 1000).toLocaleTimeString('de-DE', timeOpts)} Uhr`;
        const loc = eventData.location ? `\nOrt: ${eventData.location}` : '';
        const desc = eventData.description ? `\n${eventData.description}` : '';

        const msgText = `📅 **Neuer Termin: „${eName}"**${desc}\n${isAllday ? 'Ganztägig: ' : ''}${startDate}${startTime} – ${endDate}${endTime}${loc}\n\nDetails im Kalender ansehen. [%event:${eventId}%]`;

        await client.sendMessage({ target: notify_chat_id, target_type: notify_chat_type, text: msgText }).catch(() => {});
      } catch { /* non-critical */ }
    }

    res.json({ id: eventId });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.put('/calendar/events/:id', async (req, res) => {
  try {
    const client = req.client!;
    const eventId = await client.editEvent({ ...req.body, event_id: req.params.id });
    res.json({ id: eventId });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.delete('/calendar/events/:id', async (req, res) => {
  try {
    const client = req.client!;
    await client.deleteEvents([req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.post('/calendar/events/:id/respond', async (req, res) => {
  try {
    const client = req.client!;
    const { status: rsvp } = req.body as { status: string };
    const me = await client.getMe() as unknown as Record<string, unknown>;
    await client.respondToEvent(req.params.id, String(me.id), rsvp as 'accepted' | 'declined' | 'open');
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.post('/calendar/events/:id/invite', async (req, res) => {
  try {
    const client = req.client!;
    const { userIds } = req.body as { userIds: string[] };
    await client.inviteToEvent(req.params.id, userIds);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.get('/calendar/channels/:companyId', async (req, res) => {
  try {
    const client = req.client!;
    res.json(await client.listChannelsHavingEvents(req.params.companyId));
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

export default router;
