import { get } from './core';

export interface SigningStatus {
  /** Konnte der private Signierschluessel entpackt werden? */
  available: boolean;
  /** Warum nicht — nur gesetzt, wenn `available` false ist. */
  reason?: string;
  /**
   * Passt der abgeleitete Public Key zu dem, was auf dem Server liegt?
   * `null`, wenn der Server keinen vergleichbaren Schluessel geliefert hat.
   */
  matchesStoredPublicKey?: boolean | null;
  /** SHA-256 ueber kty + e + n, wie im offiziellen Client. */
  fingerprint?: string;
}

/**
 * Diagnose der Chat-Schluessel-Signierung. Siehe `docs/signing-keys.md`.
 */
export function getSigningStatus(): Promise<SigningStatus> {
  return get<SigningStatus>('/security/signing-status');
}
