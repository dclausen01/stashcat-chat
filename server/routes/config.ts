import { Router } from 'express';

const router = Router();

const DEFAULT_NEXTCLOUD_URL = 'https://cloud.bbz-rd-eck.de';

// Öffentlich lesbare Laufzeit-Konfiguration für das Frontend. Enthält nur
// nicht-sensitive Werte (URLs), die ohnehin in jedem ausgehenden Request
// erscheinen würden. Wird vom Frontend einmal beim Start geladen, damit
// Link-Erkennung und Editor-Platzhalter dynamisch auf die konfigurierte
// Nextcloud-Instanz zeigen statt auf eine hardcodete BBZ-URL.
router.get('/config', (_req, res) => {
  const nextcloudUrl = (process.env.NEXTCLOUD_URL || DEFAULT_NEXTCLOUD_URL).replace(/\/+$/, '');
  res.json({ nextcloudUrl });
});

export default router;
