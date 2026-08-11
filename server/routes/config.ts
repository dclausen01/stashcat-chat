import { Router } from 'express';

const router = Router();

const DEFAULT_NEXTCLOUD_URL = 'https://cloud.bbz-rd-eck.de';
const DEFAULT_ONLYOFFICE_URL = 'https://office.bbz-rd-eck.de';

// Öffentlich lesbare Laufzeit-Konfiguration für das Frontend. Enthält nur
// nicht-sensitive Werte (URLs), die ohnehin in jedem ausgehenden Request
// erscheinen würden. Wird vom Frontend einmal beim Start geladen, damit
// Link-Erkennung und Editor-Platzhalter dynamisch auf die konfigurierte
// Nextcloud-Instanz zeigen statt auf eine hardcodete BBZ-URL.
router.get('/config', (_req, res) => {
  const nextcloudUrl = (process.env.NEXTCLOUD_URL || DEFAULT_NEXTCLOUD_URL).replace(/\/+$/, '');
  // onlyofficeUrl ist die Quelle, gegen die der Viewer die (vom Aufrufer
  // kontrollierbare) URL aus dem #hash prueft — dieselbe Env, aus der auch die
  // CSP gebaut wird. Muss oeffentlich lesbar bleiben, sonst kann der Viewer
  // nicht mehr fail-closed pruefen.
  const onlyofficeUrl = (process.env.ONLYOFFICE_URL || DEFAULT_ONLYOFFICE_URL).replace(/\/+$/, '');
  res.json({ nextcloudUrl, onlyofficeUrl });
});

export default router;
