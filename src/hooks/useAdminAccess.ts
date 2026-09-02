/**
 * Ermittelt einmalig pro Session, ob der eingeloggte Nutzer Admin-Rechte in
 * seiner (primaeren) Company hat, und stellt eine `has()`-Pruefung bereit.
 *
 * Wird sowohl vom SidebarFooter (Button ein-/ausblenden) als auch von der
 * AdminView benutzt. Ergebnis und laufender Request werden modulweit gecached,
 * damit parallele Consumer nur einen Roundtrip ausloesen.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import * as api from '../api';
import type { PermissionKey } from '../api/admin';

export interface AdminAccess {
  /** Primaere Company des Nutzers — leer solange nicht geladen. */
  companyId: string;
  permissions: PermissionKey[];
  isAdmin: boolean;
  loading: boolean;
  /** true, wenn mindestens eines der angegebenen Rechte vorliegt. */
  has: (...needed: PermissionKey[]) => boolean;
}

interface Resolved {
  companyId: string;
  permissions: PermissionKey[];
  isAdmin: boolean;
}

let cache: Resolved | null = null;
let inflight: Promise<Resolved> | null = null;

async function resolveAccess(): Promise<Resolved> {
  const companies = await api.getCompanies();
  const companyId = companies.length ? String(companies[0].id) : '';
  if (!companyId) return { companyId: '', permissions: [], isAdmin: false };
  try {
    const { permissions, isAdmin } = await api.getAdminPermissions(companyId);
    return { companyId, permissions, isAdmin };
  } catch {
    // Kein Admin oder Endpunkt nicht verfuegbar — kein Fehlerzustand fuers UI.
    return { companyId, permissions: [], isAdmin: false };
  }
}

/** Verwirft den Cache — beim Logout aufrufen. */
export function resetAdminAccess(): void {
  cache = null;
  inflight = null;
}

export function useAdminAccess(enabled = true): AdminAccess {
  const [state, setState] = useState<Resolved | null>(cache);
  const [loading, setLoading] = useState(enabled && !cache);

  useEffect(() => {
    if (!enabled || cache) {
      if (cache) setState(cache);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    inflight ??= resolveAccess();
    inflight
      .then((resolved) => {
        cache = resolved;
        inflight = null;
        if (!cancelled) setState(resolved);
      })
      .catch(() => {
        inflight = null;
        if (!cancelled) setState({ companyId: '', permissions: [], isAdmin: false });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [enabled]);

  // Eigene Referenz halten, damit `has` nicht bei jedem Render neu entsteht.
  const permissions = useMemo(() => state?.permissions ?? [], [state]);
  const has = useCallback(
    (...needed: PermissionKey[]) => needed.some((p) => permissions.includes(p)),
    [permissions],
  );

  return {
    companyId: state?.companyId ?? '',
    permissions,
    isAdmin: state?.isAdmin ?? false,
    loading,
    has,
  };
}
