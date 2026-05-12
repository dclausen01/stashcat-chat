import { memo } from 'react';

function DateSeparatorImpl({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 py-2 px-4">
      <div className="h-px flex-1 bg-surface-200 dark:bg-surface-700" />
      <span className="rounded-full bg-surface-100 px-3 py-0.5 text-xs font-medium text-surface-600 dark:bg-surface-800 dark:text-surface-400 select-none">
        {label}
      </span>
      <div className="h-px flex-1 bg-surface-200 dark:bg-surface-700" />
    </div>
  );
}

export const DateSeparator = memo(DateSeparatorImpl);
