'use client';

// DashboardCard — one saved dashboard-type view on the /dashboards index.
// Icon tile + label + "object · scope" line. Object-scoped views link into
// the object route with the view preselected (same URL shape the AI dialog
// navigates to); workspace-scoped ones (no object) live at /dashboards/<id>.

import { IconTile } from '@/components/northbeam/icon-tile';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { getViewIcon } from '@/lib/views/icons';
import type { ShareTarget } from '@northbeam/db/views';
import Link from 'next/link';

type DashboardViewLike = {
  id: string;
  label: string;
  icon: string | null;
  sharedWith: ShareTarget[];
};

function scopeLabel(sharedWith: ShareTarget[]): string {
  if (sharedWith.some((s) => s.kind === 'org')) return 'Workspace';
  if (sharedWith.some((s) => s.kind === 'role')) return 'Shared';
  return 'Personal';
}

export function DashboardCard({
  view,
  object,
  index = 0,
}: {
  view: DashboardViewLike;
  /** The object the view belongs to — resolves the route + subtitle. */
  object?: { key: string; labelPlural: string };
  /** Position in the grid, drives the reveal stagger. */
  index?: number;
}) {
  const Icon = getViewIcon(view.icon);
  const scope = scopeLabel(view.sharedWith);
  return (
    <Link
      href={object ? `/${object.key}?view=${view.id}` : `/dashboards/${view.id}`}
      className="rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Card
        className="reveal lift h-full cursor-pointer gap-4"
        style={{ '--reveal-delay': `${index * 40}ms` } as React.CSSProperties}
      >
        <CardHeader>
          <div className="flex min-w-0 items-center gap-3">
            <IconTile icon={Icon} tone={scope === 'Workspace' ? 'accent' : 'neutral'} />
            <div className="min-w-0">
              <CardTitle className="truncate">{view.label}</CardTitle>
              <p className="truncate text-muted-foreground text-xs">
                {object ? `${object.labelPlural} · ` : ''}
                {scope}
              </p>
            </div>
          </div>
        </CardHeader>
      </Card>
    </Link>
  );
}
