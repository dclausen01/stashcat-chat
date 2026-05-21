/**
 * Dual-token authentication helper for push and push-preference routes.
 *
 * Accepts EITHER:
 *   - the legacy session token (`iv:ct:tag` hex triple, AES-GCM-decryptable),
 *   - or the mobile token (64-hex random) returned by `/api/auth/mobile-login`.
 *
 * Both resolve to the same routing key (`clientKey` from the Stashcat session)
 * so push-token registration and dispatcher fan-out use the same userId space.
 */
import type { Request } from 'express';
import { decryptSession } from '../token-crypto';
import { touchMobileToken } from '../mobile-auth';

const SESSION_TOKEN_RE = /^[0-9a-f]+:[0-9a-f]+:[0-9a-f]+$/i;
const MOBILE_TOKEN_RE = /^[0-9a-f]{64}$/i;

export interface ResolvedAuth {
  /** Stable per-user routing key (= Stashcat clientKey). */
  userId: string;
  /** True when the request authenticated via mobile token. */
  isMobile: boolean;
  /** The mobile token (only present when isMobile === true). */
  mobileToken: string | null;
  /** The associated session token (always present after resolution). */
  sessionToken: string;
}

function extractBearer(req: Request): string | null {
  const header = req.headers['authorization'];
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    const token = header.slice('Bearer '.length).trim();
    return token || null;
  }
  // Query-param fallback (used by EventSource / file URLs elsewhere).
  const q = req.query?.token;
  if (typeof q === 'string' && q) return q;
  return null;
}

/**
 * Resolve the incoming bearer to a `{ userId, sessionToken }` tuple. Returns
 * null if no/invalid auth was provided — the caller should 401.
 */
export async function resolveAuth(req: Request): Promise<ResolvedAuth | null> {
  const bearer = extractBearer(req);
  if (!bearer) return null;

  // Mobile token first: 64-hex, looked up in `.mobile-tokens.json`.
  if (MOBILE_TOKEN_RE.test(bearer)) {
    const record = await touchMobileToken(bearer);
    if (record) {
      return {
        userId: record.userId,
        isMobile: true,
        mobileToken: bearer,
        sessionToken: record.sessionToken,
      };
    }
    // Fall through — could still be a session token in some edge case, though
    // 64-hex collisions with the `iv:ct:tag` format are impossible.
  }

  // Legacy session token: AES-GCM iv:ct:tag triple.
  if (SESSION_TOKEN_RE.test(bearer)) {
    try {
      const payload = decryptSession(bearer);
      return {
        userId: payload.clientKey,
        isMobile: false,
        mobileToken: null,
        sessionToken: bearer,
      };
    } catch {
      return null;
    }
  }

  return null;
}

