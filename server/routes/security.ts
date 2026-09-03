import { Router } from 'express';
import crypto from 'node:crypto';
import { errorMessage } from '../lib/logging';
import { getSigningKey } from '../lib/signing';

const router = Router();

/**
 * Diagnose: Ist der private Signierschluessel verfuegbar, und passt er zum
 * hinterlegten oeffentlichen Signierschluessel?
 *
 * Ohne diesen Schluessel werden Chat-Schluessel unsigniert verteilt — der
 * offizielle Client meldet dann „Signatur fehlt oder ungueltig".
 */
router.get('/security/signing-status', async (req, res) => {
  try {
    const client = req.client!;
    if (!client.isE2EUnlocked()) {
      return void res.json({ available: false, reason: 'E2E nicht entsperrt' });
    }

    const signingKey = await getSigningKey(client);
    if (!signingKey) {
      return void res.json({
        available: false,
        reason: 'Kein Signierschluessel hinterlegt — der Schluessel wird beim Anlegen des Kontos erzeugt; fehlt er, wurde die Migration uebersprungen.',
      });
    }

    // Gegenprobe: aus dem privaten Schluessel den oeffentlichen ableiten und
    // mit dem vom Server gelieferten vergleichen.
    const data = client.api.createAuthenticatedRequestData({ type: 'signing', format: 'jwk' });
    const payload = await client.api.post<{ keys?: { public_key?: string } | null }>('/security/get_private_key', data);
    const storedPublic = payload?.keys?.public_key;

    const derived = crypto.createPublicKey(signingKey).export({ format: 'jwk' }) as crypto.JsonWebKey;
    let matches: boolean | null = null;
    if (storedPublic) {
      try {
        const stored = JSON.parse(storedPublic) as crypto.JsonWebKey;
        matches = stored.n === derived.n && stored.e === derived.e;
      } catch {
        matches = null;
      }
    }

    // Fingerprint wie im Webclient: SHA-256 ueber kty + e + n.
    const fingerprint = crypto
      .createHash('sha256')
      .update(`${derived.kty}${derived.e}${derived.n}`)
      .digest('hex');

    res.json({ available: true, matchesStoredPublicKey: matches, fingerprint });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err, 'Signing-Status nicht ermittelbar') });
  }
});

export default router;
