import { Router } from 'express';
import fs from 'node:fs';

const router = Router();

/**
 * Kennzeichnet den Codestand. Beim Aendern serverseitiger Logik mit
 * hochzaehlen, damit `/api/config` beantworten kann, welche Version wirklich
 * laeuft — der Plesk/Passenger-Prozess behaelt seine Module im Speicher, bis
 * er neu startet, und ein Deploy allein sieht von aussen genauso aus.
 */
const BUILD_MARKER = 'admin-edit-channel-type';

/** Startzeit des Prozesses — daraus laesst sich der letzte Neustart ablesen. */
const STARTED_AT = new Date().toISOString();

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
  // Zeitstempel der laufenden Serverdatei. Ist sie neuer als `startedAt`,
  // liegt neuer Code auf der Platte, den der Prozess noch nicht geladen hat.
  let serverFileTime: string | null = null;
  try {
    serverFileTime = fs.statSync(__filename).mtime.toISOString();
  } catch {
    serverFileTime = null;
  }

  res.json({
    nextcloudUrl,
    onlyofficeUrl,
    buildMarker: BUILD_MARKER,
    startedAt: STARTED_AT,
    serverFileTime,
    stale: serverFileTime !== null && serverFileTime > STARTED_AT,
  });
});

export default router;
