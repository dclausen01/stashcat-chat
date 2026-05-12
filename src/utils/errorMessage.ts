/**
 * Extract a user-facing message from an unknown thrown value (Error / string /
 * anything). Use this instead of `err instanceof Error ? err.message : ...`
 * in catch blocks throughout the frontend.
 */
export function getErrorMessage(err: unknown, fallback = 'Fehler'): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return fallback;
}
