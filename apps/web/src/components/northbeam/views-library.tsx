'use client';

// ViewsLibrary — the /views page body: EVERY saved view in one place
// (dashboards, reports, lists, record-page layouts — they're all "views"),
// searchable and filterable, with sharing managed HERE rather than at save
// time. The AI picks a view's object scope when it composes; people decide
// who sees it afterwards: keep it personal, share with specific teammates,
// or make it public to the whole workspace.
//
// Visibility of the list itself is server-enforced (listViewsForUser) — this
// page can only ever show what the caller is allowed to see. Share edits go
// through view.update, which enforces owner-or-admin.

import { useAiComposer } from '@/components/northbeam/ai-composer';
import { ConfirmDialog } from '@/components/northbeam/confirm-dialog';
import { EmptyState } from '@/components/northbeam/empty-state';
import { IconTile } from '@/components/northbeam/icon-tile';
import { SectionCard } from '@/components/northbeam/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Chip } from '@/components/ui/chip';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { type RouterOutputs, trpc } from '@/lib/api';
import { getViewIcon } from '@/lib/views/icons';
import type { ShareTarget, ViewType } from '@northbeam/db/views';
import { Globe, LayoutDashboard, Search, Share2, Trash2, Users } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

type ViewRow = RouterOutputs['view']['list'][number];
type ObjectRow = RouterOutputs['object']['list'][number];

const TYPE_LABEL: Record<ViewType, string> = {
  dashboard: 'Dashboard',
  report: 'Report',
  list: 'List',
  detail: 'Record layout',
};

const TYPE_FILTERS: Array<{ value: ViewType | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'dashboard', label: 'Dashboards' },
  { value: 'report', label: 'Reports' },
  { value: 'list', label: 'Lists' },
  { value: 'detail', label: 'Record layouts' },
];

/** Where clicking a view lands. Detail views apply to every record of their
 *  object, so they link to the object's collection. */
function hrefFor(view: ViewRow, object?: ObjectRow): string {
  if (view.type === 'detail') return object ? `/${object.key}` : '/views';
  if (view.objectId && object) return `/${object.key}?view=${view.id}`;
  return `/dashboards/${view.id}`;
}

function scopeOf(sharedWith: ShareTarget[]): 'public' | 'shared' | 'personal' {
  if (sharedWith.some((s) => s.kind === 'org')) return 'public';
  if (sharedWith.some((s) => s.kind === 'role')) return 'shared';
  // A single {user, owner} entry is just "mine"; any OTHER user share means shared.
  const userShares = sharedWith.filter((s) => s.kind === 'user');
  return userShares.length > 1 ? 'shared' : 'personal';
}

export function ViewsLibrary() {
  const composer = useAiComposer();
  const utils = trpc.useUtils();
  const views = trpc.view.list.useQuery({});
  const objects = trpc.object.list.useQuery();
  const boot = trpc.me.bootstrap.useQuery();
  const [q, setQ] = useState('');
  const [type, setType] = useState<ViewType | 'all'>('all');
  const [deleting, setDeleting] = useState<ViewRow | null>(null);

  const remove = trpc.view.delete.useMutation({
    meta: { context: "Couldn't delete the view" },
    onSuccess: () => utils.view.list.invalidate(),
  });

  const objectById = useMemo(
    () => new Map((objects.data ?? []).map((o) => [o.id, o])),
    [objects.data],
  );
  const userId = boot.data?.session?.userId;
  const role = boot.data?.activeOrg?.role;
  const isAdminish = role === 'owner' || role === 'admin';

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (
      (views.data ?? [])
        // Personal Home pages aren't library material.
        .filter((v) => !(v.objectId == null && v.key === 'home'))
        .filter((v) => type === 'all' || v.type === type)
        .filter((v) => {
          if (!needle) return true;
          const object = v.objectId ? objectById.get(v.objectId) : undefined;
          return `${v.label} ${object?.labelPlural ?? ''} ${TYPE_LABEL[v.type as ViewType] ?? ''}`
            .toLowerCase()
            .includes(needle);
        })
    );
  }, [views.data, q, type, objectById]);

  const loading = views.isLoading || objects.isLoading;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-56 flex-1">
          <Search className="-translate-y-1/2 absolute top-1/2 left-2.5 size-4 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search views…"
            className="pl-8"
            aria-label="Search views"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {TYPE_FILTERS.map((f) => (
            <Chip key={f.value} selected={type === f.value} onClick={() => setType(f.value)}>
              {f.label}
            </Chip>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <SectionCard>
          <EmptyState
            icon={LayoutDashboard}
            title={q || type !== 'all' ? 'No views match' : 'No views yet'}
            body={
              q || type !== 'all'
                ? 'Try a different search or filter.'
                : 'Ask the AI for a dashboard or report — everything you save lands here.'
            }
            action={<Button onClick={() => composer.open()}>New view</Button>}
          />
        </SectionCard>
      ) : (
        <div className="grid items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((v, i) => (
            <ViewCard
              key={v.id}
              view={v}
              object={v.objectId ? objectById.get(v.objectId) : undefined}
              canManage={isAdminish || v.ownerId === userId}
              currentUserId={userId}
              index={i}
              onDelete={() => setDeleting(v)}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        title={`Delete "${deleting?.label ?? ''}"?`}
        description="Anyone it's shared with loses access. This can't be undone."
        confirmLabel="Delete"
        tone="destructive"
        pending={remove.isPending}
        onConfirm={() => {
          if (deleting) {
            remove.mutate({ id: deleting.id }, { onSettled: () => setDeleting(null) });
          }
        }}
      />
    </div>
  );
}

/* ── One view card ──────────────────────────────────────────────────────── */

function ViewCard({
  view,
  object,
  canManage,
  currentUserId,
  index,
  onDelete,
}: {
  view: ViewRow;
  object?: ObjectRow;
  canManage: boolean;
  currentUserId?: string;
  index: number;
  onDelete: () => void;
}) {
  const Icon = getViewIcon(view.icon);
  const scope = scopeOf(view.sharedWith);
  const scopeBadge =
    scope === 'public' ? (
      <Badge className="gap-1">
        <Globe className="size-3" /> Public
      </Badge>
    ) : scope === 'shared' ? (
      <Badge variant="outline" className="gap-1">
        <Users className="size-3" /> Shared
      </Badge>
    ) : (
      <Badge variant="outline">Personal</Badge>
    );

  return (
    <div
      className="reveal lift group relative rounded-lg border bg-card p-4"
      style={{ '--reveal-delay': `${Math.min(index * 30, 300)}ms` } as React.CSSProperties}
    >
      <Link
        href={hrefFor(view, object)}
        className="flex min-w-0 items-start gap-3 outline-none"
        aria-label={`Open ${view.label}`}
      >
        <IconTile icon={Icon} tone={scope === 'public' ? 'accent' : 'neutral'} />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium text-sm group-hover:text-link">
            {view.label}
          </span>
          <span className="mt-0.5 block truncate text-muted-foreground text-xs">
            {TYPE_LABEL[view.type as ViewType] ?? view.type}
            {object ? ` · ${object.labelPlural}` : ' · Workspace'}
          </span>
        </span>
      </Link>
      <div className="mt-3 flex items-center justify-between gap-2">
        {scopeBadge}
        {canManage && (
          <span className="flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            <ShareControl view={view} currentUserId={currentUserId} />
            <Button variant="ghost" size="icon-xs" aria-label="Delete view" onClick={onDelete}>
              <Trash2 />
            </Button>
          </span>
        )}
      </div>
    </div>
  );
}

/* ── Sharing ────────────────────────────────────────────────────────────────
   Three modes, one popover: Personal (just me) / Specific people / Public
   (everyone in the workspace). Role-based shares set elsewhere survive until
   a mode is picked here — choosing one REPLACES sharedWith wholesale. */

function ShareControl({ view, currentUserId }: { view: ViewRow; currentUserId?: string }) {
  const utils = trpc.useUtils();
  const [open, setOpen] = useState(false);
  const members = trpc.org.members.useQuery(undefined, { enabled: open });
  const update = trpc.view.update.useMutation({
    meta: { context: "Couldn't update sharing" },
    onSuccess: () => utils.view.list.invalidate(),
  });

  const scope = scopeOf(view.sharedWith);
  const sharedUserIds = new Set(
    view.sharedWith.flatMap((s) => (s.kind === 'user' ? [s.userId] : [])),
  );

  const apply = (sharedWith: ShareTarget[]) => update.mutate({ id: view.id, sharedWith });
  // The owner always keeps access — every user-share set includes them.
  const ownerEntry: ShareTarget[] = view.ownerId ? [{ kind: 'user', userId: view.ownerId }] : [];

  const toggleUser = (userId: string, on: boolean) => {
    const next = new Set(sharedUserIds);
    if (on) next.add(userId);
    else next.delete(userId);
    if (view.ownerId) next.add(view.ownerId);
    apply([...next].map((id) => ({ kind: 'user', userId: id })));
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-xs" aria-label={`Share ${view.label}`}>
          <Share2 />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-3">
        <p className="font-medium text-sm">Sharing</p>
        <p className="mt-0.5 text-muted-foreground text-xs">
          {scope === 'public'
            ? 'Everyone in the workspace can see this view.'
            : scope === 'shared'
              ? 'Shared with specific people.'
              : 'Only you can see this view.'}
        </p>
        <div className="mt-3 flex gap-1.5">
          <Chip selected={scope === 'personal'} onClick={() => apply(ownerEntry)}>
            Personal
          </Chip>
          <Chip selected={scope === 'public'} onClick={() => apply([{ kind: 'org' }])}>
            Public
          </Chip>
        </div>
        <p className="mt-3 font-medium text-muted-foreground text-xs uppercase tracking-[0.08em]">
          Specific people
        </p>
        <div className="mt-1.5 flex max-h-48 flex-col gap-1 overflow-y-auto">
          {members.isLoading && <Skeleton className="h-8" />}
          {(members.data?.members ?? [])
            .filter((m) => m.userId !== view.ownerId)
            .map((m) => (
              <label
                key={m.userId}
                className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-muted"
              >
                <Checkbox
                  checked={scope !== 'public' && sharedUserIds.has(m.userId)}
                  disabled={scope === 'public' || update.isPending}
                  onCheckedChange={(on) => toggleUser(m.userId, on === true)}
                />
                <span className="min-w-0 flex-1 truncate">
                  {m.name || m.email}
                  {m.userId === currentUserId ? ' (you)' : ''}
                </span>
              </label>
            ))}
          {members.data && members.data.members.length <= 1 && (
            <p className="px-1.5 py-1 text-muted-foreground text-xs">
              No teammates yet — invite people from Settings.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
