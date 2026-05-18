import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getPublicConfig } from '../api/config';

interface ConfigContextValue {
  /** Basis-URL der Nextcloud-Instanz (ohne abschließenden Slash). */
  nextcloudUrl: string;
  /** Host (Hostname) der Nextcloud-Instanz, z. B. "cloud.bbz-rd-eck.de". Für Link-Erkennung. */
  nextcloudHost: string;
}

// Fallback bis der Server-Wert geladen ist. Identisch mit dem Backend-Default,
// damit erste Renderings keine fremden URLs anzeigen.
const DEFAULT_NEXTCLOUD_URL = 'https://cloud.bbz-rd-eck.de';

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

const ConfigContext = createContext<ConfigContextValue | null>(null);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [nextcloudUrl, setNextcloudUrl] = useState(DEFAULT_NEXTCLOUD_URL);

  useEffect(() => {
    let cancelled = false;
    getPublicConfig()
      .then((cfg) => {
        if (!cancelled && cfg.nextcloudUrl) {
          setNextcloudUrl(cfg.nextcloudUrl.replace(/\/+$/, ''));
        }
      })
      .catch((err) => {
        console.warn('[Config] Failed to load /api/config — using defaults:', err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<ConfigContextValue>(
    () => ({ nextcloudUrl, nextcloudHost: hostOf(nextcloudUrl) }),
    [nextcloudUrl],
  );

  return <ConfigContext value={value}>{children}</ConfigContext>;
}

export function useConfig(): ConfigContextValue {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error('useConfig must be used within ConfigProvider');
  return ctx;
}
