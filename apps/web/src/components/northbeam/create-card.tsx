import { type LucideIcon, Plus } from 'lucide-react';
import Link from 'next/link';

import { cn } from '@/lib/cn';

// Dashed "add new" tile. Quiet by default (muted text, hairline dashed border),
// firming up on hover with the stronger border token + a subtle lift. Renders as
// a next/link when `href` is set, otherwise a button when `onClick` is set.
export function CreateCard({
  icon: Icon = Plus,
  label,
  href,
  onClick,
  className,
}: {
  icon?: LucideIcon;
  label: string;
  href?: string;
  onClick?: () => void;
  className?: string;
}) {
  const classes = cn(
    'group/create-card flex min-h-28 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-card px-4 py-6 text-center text-muted-foreground outline-none transition-all hover:-translate-y-0.5 hover:border-[var(--border-strong)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
    className,
  );

  const body = (
    <>
      <Icon className="size-5 shrink-0 transition-colors" aria-hidden="true" />
      <span className="font-medium text-sm">{label}</span>
    </>
  );

  if (href) {
    return (
      <Link data-slot="create-card" href={href} className={classes}>
        {body}
      </Link>
    );
  }

  return (
    <button data-slot="create-card" type="button" onClick={onClick} className={classes}>
      {body}
    </button>
  );
}
