import { useEffect, useState } from 'react';
import { HardDrive } from 'lucide-react';
import { clsx } from 'clsx';
import * as api from '../../api';
import { formatBytes } from './helpers';

export function NCQuotaBar() {
  const [quota, setQuota] = useState<api.NCQuota | null>(null);
  useEffect(() => {
    api.ncQuota().then(setQuota).catch(() => setQuota(null));
  }, []);

  if (!quota) return null;

  const isUnlimited = quota.available < 0; // -1 = kein festes Quota

  if (isUnlimited) {
    return (
      <div className="shrink-0 border-t border-surface-200 px-4 py-3 dark:border-surface-700">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wider">
          <HardDrive size={12} />
          Nextcloud-Speicher
        </div>
        <div className="mt-1 text-[11px] text-surface-500">
          {formatBytes(quota.used)} belegt
        </div>
      </div>
    );
  }

  const total = quota.used + quota.available;
  const pct = total > 0 ? (quota.used / total) * 100 : 0;
  const isCritical = pct > 95;
  const isHigh = pct > 80;

  return (
    <div className="shrink-0 border-t border-surface-200 px-4 py-3 space-y-1 dark:border-surface-700">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-surface-500 dark:text-surface-400 uppercase tracking-wider">
        <HardDrive size={12} />
        Nextcloud-Speicher
      </div>
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-surface-600 dark:text-surface-400">Belegt</span>
        <span className={clsx('tabular-nums', isCritical ? 'text-red-500' : isHigh ? 'text-amber-500' : 'text-surface-500')}>
          {formatBytes(quota.used)} / {formatBytes(total)}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-200 dark:bg-surface-700">
        <div
          className={clsx('h-full rounded-full transition-all', isCritical ? 'bg-red-500' : isHigh ? 'bg-amber-400' : 'bg-teal-500')}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <div className="text-[10px] text-surface-500">{formatBytes(quota.available)} frei</div>
    </div>
  );
}
