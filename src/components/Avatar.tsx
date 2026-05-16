import { useState, useEffect } from 'react';
import { clsx } from 'clsx';

interface AvatarProps {
  name: string;
  image?: string | null;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  online?: boolean;
  /** Availability status — overrides the `online` prop for color */
  availability?: 'available' | 'do_not_disturb';
}

const sizeClasses = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-12 w-12 text-base',
};

const dotSizeClasses = {
  xs: 'h-2 w-2',
  sm: 'h-3 w-3',
  md: 'h-3 w-3',
  lg: 'h-3.5 w-3.5',
};

function getInitials(name: string): string {
  if (!name || typeof name !== 'string') return '?';
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return words
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() || '')
    .join('') || '?';
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

export default function Avatar({ name, image, size = 'md', online, availability }: AvatarProps) {
  const [imgError, setImgError] = useState(false);

  // Reset error state when image URL changes
  useEffect(() => { setImgError(false); }, [image]);

  // Determine dot color
  let dotColor: string | undefined;
  let isPulsing = false;
  if (availability === 'available') {
    dotColor = 'bg-green-500';
    isPulsing = true;
  } else if (availability === 'do_not_disturb') {
    dotColor = 'bg-red-500';
  } else if (online !== undefined) {
    dotColor = online ? 'bg-green-500' : 'bg-surface-400';
  }

  const dotSize = dotSizeClasses[size] || dotSizeClasses.md;
  const showImage = !!image && !imgError;

  return (
    <div className="relative inline-flex shrink-0">
      {/*
       * Initials layer: always rendered, acts as an instant placeholder
       * while the image loads over the network. Once the image is ready,
       * it covers this layer completely via absolute positioning.
       */}
      <div
        className={clsx(
          'flex items-center justify-center rounded-full font-medium text-white',
          sizeClasses[size],
          getColor(name),
        )}
        aria-hidden={showImage}
      >
        {!showImage && getInitials(name)}
      </div>
      {showImage && (
        <img
          src={image}
          alt={name}
          onError={() => setImgError(true)}
          className="absolute inset-0 h-full w-full rounded-full object-cover"
        />
      )}
      {dotColor && (
        <span className={clsx('absolute bottom-0 right-0 rounded-full border-2 border-white dark:border-surface-800', dotSize)}>
          {isPulsing && (
            <span className={clsx('absolute inset-0 -z-10 animate-ping rounded-full bg-green-400 opacity-75', dotSize)} />
          )}
          <span className={clsx('block rounded-full', dotColor, dotSize)} />
        </span>
      )}
    </div>
  );
}
