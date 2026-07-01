import { type VariantProps, cva } from 'class-variance-authority';
import type { LucideIcon } from 'lucide-react';
import type * as React from 'react';

import { cn } from '@/lib/cn';

// Soft inline message block — token-driven tints, hairline border, soft radius.
// Variant colors live in TONE (driven via CSS vars) so no hex leaks into the
// component; cva only handles the structural class shell.
const calloutVariants = cva(
  'flex w-full gap-3 rounded-md border px-3.5 py-3 text-sm [&>svg]:mt-0.5 [&>svg]:size-4 [&>svg]:shrink-0',
);

type CalloutVariant = 'info' | 'warning' | 'success' | 'danger' | 'neutral';

// Each tone maps to a soft background + matching border + text color, all from
// tokens.css. info reuses the indigo accent; neutral falls back to muted.
const TONE: Record<CalloutVariant, { background: string; borderColor: string; color: string }> = {
  info: {
    background: 'var(--info-bg)',
    borderColor: 'var(--accent-soft)',
    color: 'var(--info)',
  },
  warning: {
    background: 'var(--warning-bg)',
    borderColor: 'var(--warning-border)',
    color: 'var(--warning)',
  },
  success: {
    background: 'var(--success-bg)',
    borderColor: 'var(--success-border)',
    color: 'var(--success)',
  },
  danger: {
    background: 'var(--danger-bg)',
    borderColor: 'var(--danger-border)',
    color: 'var(--danger)',
  },
  neutral: {
    background: 'var(--surface-sunken)',
    borderColor: 'var(--border)',
    color: 'var(--ink-secondary)',
  },
};

function Callout({
  variant = 'neutral',
  icon: Icon,
  title,
  children,
  className,
  style,
  ...props
}: Omit<React.ComponentProps<'div'>, 'title'> &
  VariantProps<typeof calloutVariants> & {
    variant?: CalloutVariant;
    icon?: LucideIcon;
    title?: React.ReactNode;
  }) {
  const tone = TONE[variant];

  return (
    <div
      data-slot="callout"
      data-variant={variant}
      role="note"
      className={cn(calloutVariants(), className)}
      style={{
        background: tone.background,
        borderColor: tone.borderColor,
        color: tone.color,
        ...style,
      }}
      {...props}
    >
      {Icon && <Icon aria-hidden="true" />}
      <div className="min-w-0 flex-1 space-y-1">
        {title && <p className="font-semibold leading-snug">{title}</p>}
        {children && <div className="text-foreground/80 leading-snug">{children}</div>}
      </div>
    </div>
  );
}

export { Callout, calloutVariants };
