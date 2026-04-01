import { MessageSquare } from 'lucide-react';

export default function EmptyState() {
  return (
    <div className="flex h-full flex-1 flex-col items-center justify-center bg-white text-surface-600 dark:bg-surface-950">
      <MessageSquare size={64} className="mb-4 text-surface-300 dark:text-surface-400" />
      <h2 className="text-xl font-semibold text-surface-600 dark:text-surface-400">
        Willkommen bei BBZ Chat
      </h2>
      <p className="mt-2 max-w-md text-center text-sm text-surface-600">
        Wähle einen Channel oder eine Konversation aus der Seitenleiste, um loszulegen.
      </p>
    </div>
  );
}
