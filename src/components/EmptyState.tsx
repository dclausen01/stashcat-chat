import { MessageSquare, Hash, Users, BarChart3 } from 'lucide-react';

export default function EmptyState() {
  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center gap-6 bg-white px-6 text-surface-600 dark:bg-surface-950">
      {/* Dekorativer Icon-Stack — wie ein "Schwarm" aus Chat-Bubbles */}
      <div className="relative" aria-hidden>
        <div className="flex h-24 w-24 items-center justify-center rounded-3xl bg-gradient-to-br from-primary-100 to-primary-50 text-primary-500 shadow-inner dark:from-primary-900/40 dark:to-primary-950/40 dark:text-primary-300">
          <MessageSquare size={48} strokeWidth={1.5} />
        </div>
        <div className="absolute -right-3 -top-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-amber-100 text-amber-600 shadow-sm dark:bg-amber-900/40 dark:text-amber-300">
          <Hash size={18} />
        </div>
        <div className="absolute -bottom-2 -left-3 flex h-9 w-9 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600 shadow-sm dark:bg-emerald-900/40 dark:text-emerald-300">
          <Users size={16} />
        </div>
      </div>

      <div className="text-center">
        <h2 className="text-lg font-semibold text-surface-700 dark:text-surface-200">
          Willkommen bei BBZ Chat
        </h2>
        <p className="mt-1.5 max-w-md text-sm leading-relaxed text-surface-500 dark:text-surface-400">
          Wähle links einen <span className="font-medium text-surface-700 dark:text-surface-300">Channel</span> oder eine
          <span className="font-medium text-surface-700 dark:text-surface-300"> Direktnachricht</span>, um loszulegen.
        </p>
      </div>

      {/* Hint-Karten — kleine Anregungen */}
      <div className="flex flex-wrap items-center justify-center gap-2 text-xs text-surface-500 dark:text-surface-400">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-100 px-3 py-1 dark:bg-surface-800/60">
          <Hash size={12} /> Channels
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-100 px-3 py-1 dark:bg-surface-800/60">
          <Users size={12} /> Direktnachrichten
        </span>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-100 px-3 py-1 dark:bg-surface-800/60">
          <BarChart3 size={12} /> Umfragen
        </span>
      </div>
    </div>
  );
}
