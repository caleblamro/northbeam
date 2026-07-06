'use client';

// ViewsLibrary — the /views page body, in the V2 "explorer" shape: views are
// organized the way the data model organizes them. A left rail lists the
// workspace scope plus every object (with per-object counts and a type-mix
// dot strip); the main pane shows the selected scope's views grouped by type
// (Lists · Reports · Dashboards · Record layouts) as compact rows with
// summaries, scope badges, and manage actions. Sharing is managed HERE
// rather than at save time — keep a view personal, share with specific
// teammates, or make it public to the whole workspace.
//
// Visibility of the list itself is server-enforced (listViewsForUser) — this
// page can only ever show what the caller is allowed to see. Share edits go
// through view.update, which enforces owner-or-admin.

import { ObjChip } from '@/components/northbeam/app-bits';
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
import { cn } from '@/lib/cn';
import { timeAgo } from '@/lib/time';
import type { ShareTarget, ViewType } from '@northbeam/db/views';
import {
  ArrowUpRight,
  ChartBar,
  FileText,
  Globe,
  House,
  LayoutDashboard,
  List,
  Pin,
  Search,
  Share2,
  Star,
  Trash2,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

type ViewRow = RouterOutputs['view']['list'][number];
type ObjectRow = RouterOutputs['object']['list'][number];

/** Section order in the main pane + the rail's type-mix dot strip. */
const TYPE_ORDER: ViewType[] = ['list', 'report', 'dashboard', 'detail'];

const TYPE_META: Record<ViewType, { plural: string; icon: typeof List; dot: string }> = {
  list: { plural: 'Lists', icon: List, dot: 'var(--ink-subtle)' },
  report: { plural: 'Reports', icon: ChartBar, dot: 'var(--accent)' },
  dashboard: { plural: 'Dashboards', icon: LayoutDashboard, dot: 'var(--success)' },
  detail: { plural: 'Record layouts', icon: FileText, dot: 'var(--warning)' },
};

const TYPE_FILTERS: Array<{ value: ViewType | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'list', label: 'Lists' },
  { value: 'report', label: 'Reports' },
  { value: 'dashboard', label: 'Dashboards' },
  { value: 'detail', label: 'Record layouts' },
];

/** Rail scope key: an objectId, or the workspace bucket. */
type ScopeKey = string | 'workspace';

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

function humanizeKey(key: string): string {
  return key.replace(/[_.]/g, ' ');
}

/** One-line description per view type — what this view IS, from its stored
 *  definition, without loading the object's field metadata. */
function summaryFor(view: ViewRow): string {
  if (view.type === 'report') {
    const cfg = (view.config ?? {}) as {
      measure?: { agg?: string; fieldKey?: string };
      groupBy?: string | null;
    };
    const agg = cfg.measure?.agg ?? 'count';
    const measure =
      agg === 'count'
        ? 'Count of records'
        : `${agg} of ${humanizeKey(cfg.measure?.fieldKey ?? '')}`.trim();
    return cfg.groupBy ? `${measure} by ${humanizeKey(cfg.groupBy)}` : measure;
  }
  if (view.type === 'dashboard' || view.type === 'detail') {
    const cfg = (view.config ?? {}) as { artifact?: { components?: unknown[] } };
    const n = cfg.artifact?.components?.length ?? 0;
    if (view.type === 'dashboard') return n > 0 ? `${n} widget${n === 1 ? '' : 's'}` : 'Dashboard';
    return n > 0 ? `Record page · ${n} section${n === 1 ? '' : 's'}` : 'Record page';
  }
  const filters = view.filters.length;
  const sort = view.sort[0];
  const base = filters > 0 ? `${filters} filter${filters === 1 ? '' : 's'}` : 'All records';
  return sort ? `${base} · sorted by ${humanizeKey(sort.fieldKey)}` : base;
}

export function ViewsLibrary() {
  const utils = trpc.useUtils();
  const views = trpc.view.list.useQuery({});
  const objects = trpc.object.list.useQuery();
  const boot = trpc.me.bootstrap.useQuery();
  const [q, setQ] = useState('');
  const [type, setType] = useState<ViewType | 'all'>('all');
  const [scope, setScope] = useState<ScopeKey | null>(null);
  const [deleting, setDeleting] = useState<ViewRow | null>(null);

  const remove = trpc.view.delete.useMutation({
    meta: { context: "Couldn't delete the view" },
    onSuccess: () => utils.view.list.invalidate(),
  });
  const setDefault = trpc.view.setDefault.useMutation({
    meta: { context: "Couldn't pin that view as default" },
    onSuccess: () => utils.view.list.invalidate(),
  });

  const objectById = useMemo(
    () => new Map((objects.data ?? []).map((o) => [o.id, o])),
    [objects.data],
  );
  const userId = boot.data?.session?.userId;
  const role = boot.data?.activeOrg?.role;
  const isAdminish = role === 'owner' || role === 'admin';

  // Personal Home pages aren't library material.
  const all = useMemo(
    () => (views.data ?? []).filter((v) => !(v.objectId == null && v.key === 'home')),
    [views.data],
  );

  // Rail model: workspace bucket + one entry per object that has views,
  // ordered by view count. The selected scope defaults to the busiest.
  const byScope = useMemo(() => {
    const m = new Map<ScopeKey, ViewRow[]>();
    for (const v of all) {
      const k: ScopeKey = v.objectId ?? 'workspace';
      const arr = m.get(k) ?? [];
      arr.push(v);
      m.set(k, arr);
    }
    return m;
  }, [all]);

  const railEntries = useMemo(() => {
    const entries = [...byScope.entries()]
      .filter(([k]) => k === 'workspace' || objectById.has(k))
      .sort((a, b) => b[1].length - a[1].length);
    // Workspace pins to the top when present.
    entries.sort((a, b) => (a[0] === 'workspace' ? -1 : b[0] === 'workspace' ? 1 : 0));
    return entries;
  }, [byScope, objectById]);

  const activeScope: ScopeKey | null = scope ?? railEntries[0]?.[0] ?? null;
  const activeObject =
    activeScope && activeScope !== 'workspace' ? objectById.get(activeScope) : undefined;

  const scoped = activeScope ? (byScope.get(activeScope) ?? []) : [];
  const needle = q.trim().toLowerCase();
  const visible = scoped
    .filter((v) => type === 'all' || v.type === type)
    .filter((v) => !needle || v.label.toLowerCase().includes(needle));

  const sections = TYPE_ORDER.map((t) => ({
    type: t,
    rows: visible.filter((v) => v.type === t),
  })).filter((s) => s.rows.length > 0);

  const loading = views.isLoading || objects.isLoading;

  if (loading) {
    return (
      <div className="grid gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-9 rounded-md" />
          ))}
        </div>
        <div className="space-y-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (all.length === 0) {
    return (
      <SectionCard>
        <EmptyState
          icon={LayoutDashboard}
          title="No views yet"
          body="Save a list, build a report, or ask the AI for a dashboard — everything lands here."
        />
      </SectionCard>
    );
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
      {/* ── Rail: workspace + objects, with type-mix dots ── */}
      <nav className="flex flex-col gap-4 lg:sticky lg:top-4" aria-label="View scopes">
        <div>
          <p className="mb-1.5 px-2.5 font-medium text-[10px] text-muted-foreground uppercase tracking-wider">
            Workspace
          </p>
          <Link
            href="/"
            className="flex items-center gap-2.5 rounded-md px-2.5 py-1.5 text-muted-foreground text-sm hover:bg-muted hover:text-foreground"
          >
            <House className="size-3.5" />
            <span className="flex-1">Home</span>
            <Star className="size-3 text-[var(--accent)]" fill="currentColor" />
          </Link>
          {byScope.has('workspace') && (
            <RailItem
              label="Shared dashboards"
              icon={<LayoutDashboard className="size-3.5" />}
              rows={byScope.get('workspace') ?? []}
              active={activeScope === 'workspace'}
              onClick={() => setScope('workspace')}
            />
          )}
        </div>
        <div>
          <p className="mb-1.5 px-2.5 font-medium text-[10px] text-muted-foreground uppercase tracking-wider">
            Objects
          </p>
          {railEntries
            .filter(([k]) => k !== 'workspace')
            .map(([k, rows]) => {
              const obj = objectById.get(k as string);
              if (!obj) return null;
              return (
                <RailItem
                  key={k}
                  label={obj.label}
                  icon={<ObjChip label={obj.label} color={obj.color} size={18} />}
                  rows={rows}
                  active={activeScope === k}
                  onClick={() => setScope(k)}
                />
              );
            })}
        </div>
      </nav>

      {/* ── Main pane: scoped views grouped by type ── */}
      <div className="flex min-w-0 flex-col gap-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="font-semibold text-[15px] tracking-[-0.01em]">
            {activeScope === 'workspace' ? 'Workspace views' : `${activeObject?.label ?? ''} views`}
          </h2>
          <span className="text-muted-foreground text-sm tabular-nums">{scoped.length}</span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="-translate-y-1/2 absolute top-1/2 left-2.5 size-3.5 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search views…"
                className="h-8 w-52 pl-8"
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
        </div>

        {sections.length === 0 ? (
          <SectionCard>
            <EmptyState
              icon={Search}
              title="No views match"
              body="Try a different search or type filter."
              size="sm"
            />
          </SectionCard>
        ) : (
          sections.map(({ type: t, rows }) => (
            <section key={t}>
              <div className="flex items-baseline gap-2 border-border border-b pb-2">
                <span className="font-semibold text-[10.5px] text-muted-foreground uppercase tracking-[0.12em]">
                  {TYPE_META[t].plural}
                </span>
                <span className="text-muted-foreground text-xs tabular-nums">{rows.length}</span>
              </div>
              <ul className="flex flex-col">
                {rows.map((v) => (
                  <ViewRowItem
                    key={v.id}
                    view={v}
                    object={v.objectId ? objectById.get(v.objectId) : undefined}
                    canManage={isAdminish || v.ownerId === userId}
                    currentUserId={userId}
                    onDelete={() => setDeleting(v)}
                    onSetDefault={
                      v.objectId && !v.isDefault ? () => setDefault.mutate({ id: v.id }) : undefined
                    }
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>

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

/* ── Rail item: scope button with count + type-mix dots ─────────────────── */

function RailItem({
  label,
  icon,
  rows,
  active,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  rows: ViewRow[];
  active: boolean;
  onClick: () => void;
}) {
  const typesPresent = TYPE_ORDER.filter((t) => rows.some((v) => v.type === t));
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors',
        active
          ? 'bg-[var(--accent-soft)] text-foreground shadow-[inset_2px_0_0_var(--accent)]'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="flex items-center gap-0.5">
        {typesPresent.map((t) => (
          <span
            key={t}
            className="size-1 rounded-full"
            style={{ background: TYPE_META[t].dot }}
            title={TYPE_META[t].plural}
          />
        ))}
      </span>
      <span className="text-muted-foreground text-xs tabular-nums">{rows.length}</span>
    </button>
  );
}

/* ── One view row ───────────────────────────────────────────────────────── */

function ViewRowItem({
  view,
  object,
  canManage,
  currentUserId,
  onDelete,
  onSetDefault,
}: {
  view: ViewRow;
  object?: ObjectRow;
  canManage: boolean;
  currentUserId?: string;
  onDelete: () => void;
  /** Present only when the view can become its object's default. */
  onSetDefault?: () => void;
}) {
  const TypeIcon = TYPE_META[view.type as ViewType]?.icon ?? List;
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
    <li className="group flex items-center gap-3 border-border/60 border-b py-2.5 last:border-b-0">
      <IconTile icon={TypeIcon} tone={scope === 'public' ? 'accent' : 'neutral'} />
      <div className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <Link
            href={hrefFor(view, object)}
            className="truncate font-medium text-sm hover:text-link"
          >
            {view.label}
          </Link>
          {view.isDefault && (
            <Star
              className="size-3 shrink-0 text-[var(--accent)]"
              fill="currentColor"
              aria-label="Default view"
            />
          )}
        </span>
        <span className="block truncate text-muted-foreground text-xs">{summaryFor(view)}</span>
      </div>
      <span className="hidden text-muted-foreground text-xs tabular-nums sm:block">
        {timeAgo(view.updatedAt)}
      </span>
      {scopeBadge}
      <span
        className={cn(
          'flex items-center gap-0.5 opacity-0 transition-opacity',
          'focus-within:opacity-100 group-hover:opacity-100',
        )}
      >
        {canManage && onSetDefault && (
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="Set as default view"
            title="Set as default"
            onClick={onSetDefault}
          >
            <Pin />
          </Button>
        )}
        {canManage && <ShareControl view={view} currentUserId={currentUserId} />}
        {canManage && (
          <Button variant="ghost" size="icon-xs" aria-label="Delete view" onClick={onDelete}>
            <Trash2 />
          </Button>
        )}
        <Button variant="ghost" size="icon-xs" aria-label={`Open ${view.label}`} asChild>
          <Link href={hrefFor(view, object)}>
            <ArrowUpRight />
          </Link>
        </Button>
      </span>
    </li>
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
