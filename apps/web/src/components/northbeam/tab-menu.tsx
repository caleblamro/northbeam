'use client';

// Lightning-style nav-tab dropdown: every OBJECT tab in the top bar gets a
// chevron menu with that object's recent records, its saved list views, and
// a New action. Data loads lazily on first open (object.list is cached
// org-wide; view.list fetches per object).

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { trpc } from '@/lib/api';
import { useRecentRecords } from '@/lib/recent-records';
import { ChevronDown, List, Plus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ObjChip } from './app-bits';

/** Pinned-tab href → objectDef key (standard tabs use plural routes). */
const STATIC_ROUTES: Record<string, string> = {
  '/accounts': 'account',
  '/contacts': 'contact',
  '/deals': 'deal',
  '/activities': 'activity',
  '/pipeline': 'deal',
};

export function tabObjectKey(href: string, objectKeys: ReadonlySet<string>): string | null {
  const staticKey = STATIC_ROUTES[href];
  if (staticKey) return staticKey;
  const slug = href.replace(/^\//, '');
  return objectKeys.has(slug) ? slug : null;
}

export function TabMenu({
  href,
  objectKey,
  label,
}: {
  href: string;
  objectKey: string;
  label: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const recents = useRecentRecords()
    .filter((r) => r.objectKey === objectKey)
    .slice(0, 5);

  const objects = trpc.object.list.useQuery(undefined, { enabled: open });
  const objectId = objects.data?.find((o) => o.key === objectKey)?.id;
  const views = trpc.view.list.useQuery(
    { objectId: objectId ?? '' },
    { enabled: open && Boolean(objectId) },
  );
  const listViews = (views.data ?? []).filter((v) => v.type === 'list').slice(0, 8);

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button type="button" className="shelltab__menu" aria-label={`${label} menu`}>
          <ChevronDown size={12} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        {recents.length > 0 && (
          <>
            <DropdownMenuLabel>Recent</DropdownMenuLabel>
            {recents.map((r) => (
              <DropdownMenuItem key={r.id} onSelect={() => router.push(`/${r.objectKey}/${r.id}`)}>
                <ObjChip label={r.objectLabel} color={r.color ?? '#635bff'} size={16} />
                <span className="truncate">{r.name}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </>
        )}
        {listViews.length > 0 && (
          <>
            <DropdownMenuLabel>List views</DropdownMenuLabel>
            {listViews.map((v) => (
              <DropdownMenuItem key={v.id} onSelect={() => router.push(`${href}?view=${v.id}`)}>
                <List className="size-4 text-muted-foreground" />
                <span className="truncate">{v.label}</span>
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onSelect={() => router.push(`${href}?new=1`)}>
          <Plus className="size-4 text-muted-foreground" />
          New {label.replace(/s$/, '').toLowerCase()}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
