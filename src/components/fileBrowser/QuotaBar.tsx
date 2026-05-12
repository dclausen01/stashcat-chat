import { clsx } from 'clsx';
import type * as api from '../../api';

export function QuotaBar({ label, quota }: { label: string; quota: api.FileQuota }) {
  const totalKb = quota.absolute.kb;
  const personalKb = quota.personal_used?.kb || 0;
  const sharedKb = Math.max(0, quota.used.kb - personalKb);

  const personalPct = totalKb > 0 ? (personalKb / totalKb) * 100 : 0;
  const sharedPct = totalKb > 0 ? (sharedKb / totalKb) * 100 : 0;
  const usedPct = personalPct + sharedPct;

  const isHigh = usedPct > 80;
  const isCritical = usedPct > 95;

  const personalDisplay = quota.personal_used
    ? `${quota.personal_used.value} ${quota.personal_used.unit}`
    : '0 B';
  const sharedDisplay = sharedKb > 0
    ? `${(sharedKb / 1024 / 1024).toFixed(2)} GB`
    : '0 B';
  const freeDisplay = `${quota.free.value} ${quota.free.unit}`;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11px]">
        <span className="font-medium text-surface-600 dark:text-surface-400">{label}</span>
        <span className={clsx(
          'tabular-nums',
          isCritical ? 'text-red-500 dark:text-red-400' : isHigh ? 'text-amber-500 dark:text-amber-400' : 'text-surface-500 dark:text-surface-400',
        )}>
          {personalDisplay} persönlich + {sharedDisplay} geteilte Dateien
        </span>
      </div>

      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-200 dark:bg-surface-700">
        <div className="flex h-full w-full">
          {personalPct > 0 && (
            <div
              className="h-full bg-ci-blue-700 dark:bg-ci-blue-600"
              style={{ width: `${personalPct}%` }}
              title={`Persönlich: ${personalDisplay}`}
            />
          )}
          {sharedPct > 0 && (
            <div
              className={clsx(
                'h-full',
                isCritical ? 'bg-red-400' : isHigh ? 'bg-amber-400' : 'bg-ci-blue-400 dark:bg-ci-blue-300'
              )}
              style={{ width: `${sharedPct}%` }}
              title={`Channel/Shared: ${sharedDisplay}`}
            />
          )}
        </div>
      </div>

      <div className="flex items-center justify-between text-[10px] text-surface-500 dark:text-surface-500">
        <span>{usedPct.toFixed(0)}% belegt</span>
        <span>{freeDisplay} frei</span>
      </div>
    </div>
  );
}
