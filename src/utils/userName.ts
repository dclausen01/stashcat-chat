/**
 * Format a user's display name from first_name/last_name, falling back to
 * email and finally id. Accepts any object with optional first_name/
 * last_name/email/id fields, since the Stashcat API is loose about these.
 */
export function formatUserName(
  u: {
    first_name?: string | null;
    last_name?: string | null;
    email?: string | null;
    id?: string | number | null;
  } | null | undefined,
  fallback = 'Unbekannt',
): string {
  if (!u) return fallback;
  const name = `${u.first_name ?? ''} ${u.last_name ?? ''}`.trim();
  if (name) return name;
  if (u.email) return u.email;
  if (u.id != null) return String(u.id);
  return fallback;
}
