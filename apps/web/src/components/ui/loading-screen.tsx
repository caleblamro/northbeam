// Centered loading spinner — replaces ad-hoc patterns like
// <div className="grid place-items-center p-12"><Spinner /></div>.
// Subtle (muted-foreground tint), not brand-colored — loading shouldn't
// scream for attention.

import { Spinner } from '@/components/northbeam/primitives';
import { cn } from '@/lib/cn';

const SIZE_CLASSES: Record<'sm' | 'md' | 'lg', string> = {
  sm: 'p-6',
  md: 'p-12',
  lg: 'p-20',
};

export function LoadingScreen({
  size = 'md',
  className,
}: {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  return (
    <div
      data-slot="loading-screen"
      className={cn('grid place-items-center', SIZE_CLASSES[size], className)}
    >
      <Spinner style={{ color: 'var(--ink-muted)' }} />
    </div>
  );
}
