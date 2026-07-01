// InsightCard — icon-left, title + body callout tile. Composes Card + IconTile.
// Optional `href` makes the whole card a link; optional `action` sits top-right.

import { Card } from '@/components/ui/card';
import { cn } from '@/lib/cn';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { IconTile } from './icon-tile';

type InsightTone = 'neutral' | 'brand' | 'accent' | 'success' | 'warning' | 'danger';

interface InsightCardProps {
  icon: LucideIcon;
  tone?: InsightTone;
  title: ReactNode;
  body: ReactNode;
  href?: string;
  action?: ReactNode;
  className?: string;
}

export function InsightCard({
  icon,
  tone = 'neutral',
  title,
  body,
  href,
  action,
  className,
}: InsightCardProps) {
  const content = (
    <>
      <IconTile icon={icon} tone={tone} size="md" />
      <div className="min-w-0 flex-1">
        <div className="font-medium text-[0.9375rem] text-foreground tracking-[-0.005em]">
          {title}
        </div>
        <div className="mt-1 text-muted-foreground text-sm leading-relaxed">{body}</div>
      </div>
      {action && <div className="-mt-0.5 ml-auto flex shrink-0 items-center gap-2">{action}</div>}
    </>
  );

  const card = (
    <Card
      data-slot="insight-card"
      className={cn(
        'flex-row items-start gap-3.5 p-5',
        href && 'transition-colors hover:bg-muted/40',
        className,
      )}
    >
      {content}
    </Card>
  );

  if (href) {
    return (
      <Link href={href} className="block">
        {card}
      </Link>
    );
  }

  return card;
}
