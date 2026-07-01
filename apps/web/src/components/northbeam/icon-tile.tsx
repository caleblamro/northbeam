import { type VariantProps, cva } from 'class-variance-authority';
import type { LucideIcon } from 'lucide-react';

import { cn } from '@/lib/cn';

// Tinted rounded square that frames a single lucide icon. Tones stay quiet:
// most read as neutral muted squares with a tone-colored glyph; only `accent`
// gets a soft chromatic fill, in keeping with the system's single-accent rule.
const iconTileVariants = cva('grid shrink-0 place-items-center rounded-md', {
  variants: {
    tone: {
      neutral: 'bg-muted text-foreground',
      brand: 'bg-muted text-foreground',
      accent: 'bg-[var(--accent-soft)] text-link',
      success: 'bg-muted text-[var(--success)]',
      warning: 'bg-muted text-[var(--warning)]',
      danger: 'bg-muted text-[var(--danger)]',
    },
    size: {
      sm: 'size-7 [&>svg]:size-3.5',
      md: 'size-9 [&>svg]:size-4.5',
    },
  },
  defaultVariants: {
    tone: 'neutral',
    size: 'md',
  },
});

export function IconTile({
  icon: Icon,
  tone = 'neutral',
  size = 'md',
  className,
}: {
  icon: LucideIcon;
  className?: string;
} & VariantProps<typeof iconTileVariants>) {
  return (
    <span
      data-slot="icon-tile"
      data-tone={tone}
      className={cn(iconTileVariants({ tone, size }), className)}
    >
      <Icon aria-hidden="true" />
    </span>
  );
}
