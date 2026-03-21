import { clsx } from 'clsx';

interface AvatarProps {
  name: string;
  image?: string | null;
  size?: 'sm' | 'md' | 'lg';
  online?: boolean;
}

const sizeClasses = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-12 w-12 text-base',
};

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

function getColor(name: string): string {
  const colors = [
    'bg-blue-500', 'bg-green-500', 'bg-purple-500', 'bg-orange-500',
    'bg-pink-500', 'bg-teal-500', 'bg-indigo-500', 'bg-rose-500',
  ];
  let hash = 0;
  for (const ch of name) hash = ch.charCodeAt(0) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}

export default function Avatar({ name, image, size = 'md', online }: AvatarProps) {
  return (
    <div className="relative inline-flex shrink-0">
      {image ? (
        <img
          src={image}
          alt={name}
          className={clsx('rounded-full object-cover', sizeClasses[size])}
        />
      ) : (
        <div
          className={clsx(
            'flex items-center justify-center rounded-full font-medium text-white',
            sizeClasses[size],
            getColor(name),
          )}
        >
          {getInitials(name)}
        </div>
      )}
      {online !== undefined && (
        <span
          className={clsx(
            'absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 border-white dark:border-surface-800',
            online ? 'bg-green-500' : 'bg-surface-400',
          )}
        />
      )}
    </div>
  );
}
