'use client';

// Generic list view for any object — a single control row (identity + saved-
// view tabs + filter chips + search + create) over a full-bleed table with a
// sticky aggregate footer. One component backs Contacts/Accounts/Deals/
// Activities on real data; presentation dispatches through the view-renderer
// registry so dashboards/reports render through the same chrome.

import { HidePageHead } from '@/components/northbeam/app-shell';
import { ConfirmDialog } from '@/components/northbeam/confirm-dialog';
import { EmptyState } from '@/components/northbeam/empty-state';
import type { FieldDefLite } from '@/components/northbeam/field-render';
import { formatFieldValueText } from '@/components/northbeam/field-render';
import { ListControlBar } from '@/components/northbeam/list-control-bar';
import { RecordFormDrawer } from '@/components/northbeam/record-form';
import { SaveViewDialog } from '@/components/northbeam/save-view-dialog';
import { Button } from '@/components/ui/button';
import { LoadingScreen } from '@/components/ui/loading-screen';
import { trpc } from '@/lib/api';
import { useCan, useCanObject } from '@/lib/can';
import { type Filter, readFiltersFromParams, writeFiltersToParams } from '@/lib/filters';
import { getViewRenderer } from '@/lib/views/registry';
import type { ViewRow } from '@/lib/views/types';
import { readSortFromParams, writeSortToParams } from '@/lib/views/url-state';
import type { ObjectLayout } from '@northbeam/db/field-types';
import type { ShareTarget, ViewIcon } from '@northbeam/db/views';
import type { ViewSort } from '@northbeam/db/views';
import { AlertCircle, UserPlus } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

export function RecordListView({
  objectKey,
  newLabel,
  staticFilters,
}: {
  objectKey: string;
  newLabel?: string;
  /** Always-applied filters that aren't user-editable and don't appear in the
   *  URL. Use to scope a derived list (e.g. a saved view that pins
   *  type=customer). The user's own filters layer on top via the FilterBar. */
  staticFilters?: Filter[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [q, setQ] = useState('');
  // Server-side pagination: record.list takes limit/offset, so paging works
  // past the server's 200-row page cap. The whole-set count comes from
  // record.aggregate below.
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [editing, setEditing] = useState<
    { id: string; data: Record<string, unknown> } | 'new' | null
  >(null);

  // Filters live in the URL so refresh + share-the-link both work. The
  // searchParams object is reactive — useMemo just avoids re-parsing JSON on
  // every render.
  const filters = useMemo(
    () => readFiltersFromParams(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );
  const setFilters = useCallback(
    (next: Filter[]) => {
      const params = new URLSearchParams(searchParams.toString());
      writeFiltersToParams(params, next);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  const utils = trpc.useUtils();

  // The saved-view lookup needs the object id, which only arrives with the
  // list response — but the list input needs the active view's filters. Break
  // the cycle by echoing the id into state once known: render 1 fetches the
  // unfiltered list, the id lands, views load, and the list refetches with the
  // view's filters applied. Defensive `retry: false` + silent meta means the
  // page renders fine even if the schema hasn't been pushed yet — the
  // dispatcher just falls back to a synthetic default below.
  const [objectId, setObjectId] = useState<string | null>(null);
  const viewsQ = trpc.view.list.useQuery(
    { objectId: objectId ?? '' },
    {
      enabled: !!objectId,
      retry: false,
      meta: { silent: true },
    },
  );

  // The stored view the URL (or the default flag) points at, if any. The full
  // `activeView` — including the synthetic fallback, which needs the object
  // summary — is derived after the list query below.
  const storedView: ViewRow | null = useMemo(() => {
    const explicit = searchParams.get('view');
    const stored = viewsQ.data ?? [];
    const found = explicit ? stored.find((v) => v.id === explicit) : null;
    // Unpinned default: a LIST view or nothing — landing on /property should
    // show records (the synthetic All-records fallback), never whichever
    // imported dashboard happens to sort first. Dashboards/reports stay
    // reachable via ?view= and the view picker.
    return (
      found ?? stored.find((v) => v.isDefault) ?? stored.find((v) => v.type === 'list') ?? null
    );
  }, [searchParams, viewsQ.data]);

  // Effective filter set = static (caller-pinned) + view's stored filters
  // + transient URL overrides. Pushed down to SQL via record.list — the
  // server's filters-sql.ts mirrors the web matcher in lib/filters.ts, so
  // rows come back identical to the old client-side pass (which now only
  // survives for format-rule evaluation).
  const effectiveFilters = useMemo(
    () => [...(staticFilters ?? []), ...(storedView?.filters ?? []), ...filters],
    [staticFilters, storedView?.filters, filters],
  );
  // Sort: URL takes precedence (header click writes there), otherwise fall
  // back to the saved view's sort. Empty URL + empty view = server default
  // (created_at desc).
  const urlSort = useMemo(
    () => readSortFromParams(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );
  const effectiveSort = useMemo<ViewSort[]>(
    () => (urlSort.length > 0 ? urlSort : (storedView?.sort ?? [])),
    [urlSort, storedView?.sort],
  );
  const setSort = useCallback(
    (next: ViewSort[]) => {
      const params = new URLSearchParams(searchParams.toString());
      writeSortToParams(params, next);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  const listInput = useMemo(
    () => ({
      objectKey,
      search: q || undefined,
      filters: effectiveFilters,
      sort: effectiveSort,
      limit: pageSize,
      offset: pageIndex * pageSize,
    }),
    [objectKey, q, effectiveFilters, effectiveSort, pageIndex, pageSize],
  );
  // Any change to WHAT is queried resets to page 1 — a stale offset would
  // otherwise point past the end of the new result set.
  const queryShape = JSON.stringify([objectKey, q, effectiveFilters, effectiveSort]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: queryShape serializes the real deps
  useEffect(() => {
    setPageIndex(0);
  }, [queryShape]);
  // Filters/sort are part of the query key, so edits would otherwise blank the
  // table while the server round-trips — keep the previous page on screen.
  const list = trpc.record.list.useQuery(listInput, { placeholderData: (prev) => prev });
  const remove = trpc.record.remove.useMutation({
    onSuccess: () => utils.record.list.invalidate(),
  });
  // Inline cell edits: optimistically patch the exact record.list cache entry
  // this component queries, roll back on error, then settle with the server
  // truth (the update may ripple into formulas/rollups/display name).
  const update = trpc.record.update.useMutation({
    meta: { context: "Couldn't save the change" },
    onMutate: async ({ id, data }) => {
      const input = listInput;
      await utils.record.list.cancel(input);
      const prev = utils.record.list.getData(input);
      utils.record.list.setData(input, (old) =>
        old
          ? {
              ...old,
              rows: old.rows.map((r) => (r.id === id ? { ...r, data: { ...r.data, ...data } } : r)),
            }
          : old,
      );
      return { prev, input };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx) utils.record.list.setData(ctx.input, ctx.prev);
    },
    onSettled: () => utils.record.list.invalidate(),
  });

  // `placeholderData` keeps the PREVIOUS response on screen while a refetch
  // runs. That's right for filter/sort edits (same object), but navigating
  // between objects would briefly render another object's fields/rows against
  // this object's view + sort — which trips the grid ("column does not
  // exist"). Treat cross-object placeholders as still-loading instead.
  const isStale = !!list.data && list.data.object.key !== objectKey;
  const fields = (isStale ? [] : (list.data?.fields ?? [])) as FieldDefLite[];
  // Rows arrive filtered + sorted by the server — no client-side pass needed.
  const rows = isStale ? [] : (list.data?.rows ?? []);
  const refLabels = (isStale ? {} : (list.data?.refLabels ?? {})) as Record<string, string>;
  const object = isStale ? undefined : list.data?.object;
  const objectLabel = object?.label ?? '';
  const objectPlural = object?.labelPlural ?? '';
  const layout = (object?.layout ?? {}) as ObjectLayout;

  // Echo the object id into state for the saved-view query above. Cleared
  // when the objectKey changes (list.data goes undefined while refetching).
  useEffect(() => {
    setObjectId(object?.id ?? null);
  }, [object?.id]);

  const activeView: ViewRow = useMemo(() => {
    if (storedView) return storedView;
    // Synthetic fallback: a transient "All <object>" list view derived from
    // the object's layout. Used when the view table is empty (pre-seed) or
    // when the schema hasn't been pushed yet. Never written back to the DB.
    return {
      id: '__synthetic__',
      // `organizationId` isn't exposed on the record.list object summary
      // (it lives on the server). The dispatcher never round-trips this row,
      // so an empty string is fine for the synthetic.
      organizationId: '',
      objectId: object?.id ?? '',
      key: 'all',
      label: `All ${objectPlural.toLowerCase() || 'records'}`,
      type: 'list',
      icon: 'list' as ViewIcon,
      config: {},
      filters: [],
      sort: [],
      columns: layout.listColumns ?? [],
      sharedWith: [{ kind: 'org' }],
      ownerId: null,
      isDefault: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    } satisfies ViewRow;
  }, [storedView, object, objectPlural, layout.listColumns]);

  // True record count for the control bar, footer, and pagination. The list
  // page is limit/offset-windowed, so rows.length can't count — this asks
  // record.aggregate for the whole filtered+searched set (same ACL + search
  // predicate as the list, shared server-side).
  const countQ = trpc.record.aggregate.useQuery(
    {
      objectKey,
      groupBy: null,
      measure: { agg: 'count' },
      filters: effectiveFilters,
      search: q || undefined,
    },
    { enabled: !!object, retry: false, meta: { silent: true } },
  );
  const serverCount = countQ.data ? Number(countQ.data.buckets[0]?.value ?? 0) : null;

  // First money-like visible column drives the Σ/avg footer aggregates.
  const sumField = useMemo(() => {
    const visibleKeys =
      activeView.columns.length > 0 ? activeView.columns : fields.slice(0, 4).map((f) => f.key);
    const visible = visibleKeys
      .map((k) => fields.find((f) => f.key === k))
      .filter((f): f is FieldDefLite => !!f);
    return visible.find((f) => f.type === 'currency') ?? visible.find((f) => f.type === 'number');
  }, [activeView.columns, fields]);

  // Override detection — the control bar uses this to surface "Save as new
  // view…" when the URL state (filters or sort) diverges from what the active
  // view stores. A sort-only column-header click counts as an override too.
  const hasOverrides = filters.length > 0 || urlSort.length > 0;

  /** Navigate to a saved view, clearing the transient overrides on the URL
   *  (the view carries them). */
  const selectView = useCallback(
    (next: ViewRow) => {
      const params = new URLSearchParams();
      if (next.id !== '__synthetic__') params.set('view', next.id);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  const boot = trpc.me.bootstrap.useQuery();
  const currentUserId = boot.data?.session?.userId ?? null;

  // Per-object CRUD gates — mirror the server's object-permission grid so
  // roles without a grant don't see affordances that would error on click.
  const canCreate = useCanObject(objectKey, 'create');
  const canWrite = useCanObject(objectKey, 'update');
  const canDelete = useCanObject(objectKey, 'delete');
  const canWriteViews = useCan('view.write');

  const createView = trpc.view.create.useMutation({
    meta: { context: "Couldn't save the view" },
  });
  const setDefaultView = trpc.view.setDefault.useMutation({
    meta: { context: "Couldn't pin that view as default" },
    onSuccess: () => utils.view.list.invalidate({ objectId: object?.id ?? '' }),
  });
  const deleteView = trpc.view.delete.useMutation({
    meta: { context: "Couldn't delete that view" },
    onSuccess: () => utils.view.list.invalidate({ objectId: object?.id ?? '' }),
  });

  // Confirm dialog state for view deletion. Holds the view pending deletion
  // so the dialog can show the view label and trigger the mutation on confirm.
  const [deleteConfirmView, setDeleteConfirmView] = useState<ViewRow | null>(null);
  // Confirm dialog state for record deletion (from the row hover actions).
  const [deleteRecordId, setDeleteRecordId] = useState<string | null>(null);

  // Dialog state for "Save as new view…". Opened either from the control bar
  // (no overrides) or from a renderer that wants to persist its transient
  // state along with the new view — currently just AIView, which passes
  // its in-progress prompt through `config`.
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [pendingSaveOverrides, setPendingSaveOverrides] = useState<{ config?: unknown } | null>(
    null,
  );
  const saveAsNewView = useCallback((overrides?: { config?: unknown }) => {
    setPendingSaveOverrides(overrides ?? null);
    setSaveDialogOpen(true);
  }, []);

  const onSaveDialogSubmit = useCallback(
    async ({
      label,
      sharedWith,
      icon,
    }: { label: string; sharedWith: ShareTarget[]; icon: ViewIcon }) => {
      if (!object?.id) return;
      const slug =
        label
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 48) || 'view';
      const created = await createView.mutateAsync({
        objectId: object.id,
        key: `${slug}-${Date.now().toString(36)}`,
        label,
        type: 'list',
        icon,
        // Capture the visible state: the active view's persisted filters
        // PLUS the user's transient URL overrides on top. Save means "pin
        // what I'm looking at right now."
        filters: [...(activeView.filters ?? []), ...filters],
        sort: effectiveSort,
        columns: activeView.columns,
        sharedWith,
        // Merge any renderer-provided config on top of the synthetic config
        // so the persisted view picks up exactly what the user was working on.
        config: { ...(activeView.config as object), ...(pendingSaveOverrides?.config ?? {}) },
      });
      await utils.view.list.invalidate({ objectId: object.id });
      setSaveDialogOpen(false);
      setPendingSaveOverrides(null);
      selectView(created as ViewRow);
    },
    [
      activeView,
      createView,
      effectiveSort,
      filters,
      object?.id,
      pendingSaveOverrides,
      selectView,
      utils.view.list,
    ],
  );

  const createBtn = canCreate ? (
    <Button size="sm" onClick={() => setEditing('new')}>
      <UserPlus />
      {newLabel ?? `New ${objectLabel.toLowerCase() || 'record'}`}
    </Button>
  ) : null;

  if (list.isError) {
    // Only a real NOT_FOUND means the object doesn't exist — anything else
    // (bad saved-view filter, server error) must show its actual message,
    // not masquerade as a missing object.
    const notFound = list.error.data?.code === 'NOT_FOUND';
    return (
      <>
        <HidePageHead />
        <EmptyState
          icon={AlertCircle}
          title={notFound ? 'Unknown object' : `Couldn't load ${objectKey} records`}
          body={
            notFound ? `No object '${objectKey}' exists in this workspace.` : list.error.message
          }
        />
      </>
    );
  }

  const isListType = activeView.type === 'list';

  return (
    <>
      <HidePageHead />
      {/* Break out of .app-wrap's 32px gutter + 24px top padding so the
          control row and grid run edge-to-edge under the topbar. The
          `page-flush-bottom` marker removes the wrapper's bottom padding
          (via :has() in components-app.css) so the sticky footer sits on
          the viewport edge — other pages keep their breathing room. */}
      <div className="page-flush-bottom -mx-8 -mt-6 flex flex-col">
        <ListControlBar
          objectLabel={objectLabel || objectKey}
          objectPlural={objectPlural || objectKey}
          objectColor={object?.color}
          count={serverCount}
          views={viewsQ.data ?? []}
          activeView={activeView}
          hasOverrides={hasOverrides}
          currentUserId={currentUserId}
          onSelectView={selectView}
          onSaveAsNew={() => saveAsNewView()}
          onSetDefault={(v) => setDefaultView.mutate({ id: v.id })}
          onDeleteView={(v) => setDeleteConfirmView(v)}
          fields={fields}
          filters={filters}
          onFiltersChange={setFilters}
          loadReferenceOptions={(targetObject, query) =>
            utils.record.searchRefs.fetch({ objectKey: targetObject, q: query })
          }
          searchValue={q}
          onSearchChange={setQ}
          searchPlaceholder={`Search ${objectPlural.toLowerCase() || 'records'}…`}
          createAction={createBtn}
          canWriteViews={canWriteViews}
        />

        {list.isLoading || isStale ? (
          <LoadingScreen size="md" />
        ) : rows.length === 0 && pageIndex === 0 && activeView.type !== 'report' ? (
          // Report views aggregate server-side over ALL rows — the list's
          // max-200-row page being empty says nothing about the report, so they
          // skip this empty-state gate and render regardless.
          <div className="px-8 py-10">
            <EmptyState
              icon={UserPlus}
              title={
                q
                  ? `No ${objectPlural.toLowerCase()} match`
                  : `No ${objectPlural.toLowerCase()} yet`
              }
              body={
                q
                  ? 'Try a different search.'
                  : `Create your first ${objectLabel.toLowerCase()}, or run a Salesforce migration.`
              }
              action={!q && createBtn}
            />
          </div>
        ) : (
          (() => {
            // Dispatch to the registered renderer for `activeView.type`. The
            // dispatcher is renderer-agnostic; per-type state (pagination here,
            // kanban columns later, etc.) lives inside each registration.
            const renderer = getViewRenderer(activeView.type);
            if (!renderer) {
              return (
                <div className="px-8 py-10">
                  <EmptyState
                    icon={AlertCircle}
                    title="Unknown view type"
                    body={`No renderer registered for type '${activeView.type}'.`}
                  />
                </div>
              );
            }
            const Renderer = renderer.Component;
            const body = (
              <Renderer
                view={activeView}
                objectKey={objectKey}
                objectLabel={objectLabel}
                fields={fields}
                rows={rows}
                refLabels={refLabels}
                isLoading={list.isLoading}
                onRowOpen={(id) => router.push(`/${objectKey}/${id}`)}
                onRowEdit={canWrite ? (row) => setEditing(row) : undefined}
                onRowDelete={canDelete ? (id) => setDeleteRecordId(id) : undefined}
                onCellEdit={
                  canWrite
                    ? (id, patch) => update.mutate({ objectKey, id, data: patch })
                    : undefined
                }
                onSaveView={canWriteViews ? saveAsNewView : undefined}
                sort={effectiveSort}
                onSortChange={setSort}
                tableChrome={isListType ? 'flush' : undefined}
                pagination={
                  isListType
                    ? {
                        pageIndex,
                        pageSize,
                        // Search-aware: the aggregate count applies the same
                        // search predicate as the list, so totals stay exact
                        // while typing.
                        totalRows: serverCount,
                        onPageChange: setPageIndex,
                        onPageSizeChange: (n) => {
                          setPageSize(n);
                          setPageIndex(0);
                        },
                      }
                    : undefined
                }
                footerStart={
                  isListType ? (
                    <ListAggregates
                      search={q || undefined}
                      serverCount={serverCount}
                      sumField={sumField}
                      objectKey={objectKey}
                      filters={effectiveFilters}
                      enabled={!!object}
                    />
                  ) : undefined
                }
              />
            );
            // Card-style renderers (dashboard/report) keep page gutters; the
            // flush list grid owns the full width itself.
            return isListType ? body : <div className="px-8 py-5">{body}</div>;
          })()
        )}
      </div>

      <ConfirmDialog
        open={!!deleteConfirmView}
        onOpenChange={(o) => !o && setDeleteConfirmView(null)}
        title="Delete view"
        description={
          deleteConfirmView ? `Delete "${deleteConfirmView.label}"? This can't be undone.` : ''
        }
        confirmLabel="Delete"
        tone="destructive"
        pending={deleteView.isPending}
        onConfirm={() => {
          if (!deleteConfirmView) return;
          deleteView.mutate({ id: deleteConfirmView.id });
          if (deleteConfirmView.id === activeView.id) {
            // Clear the URL so the dispatcher falls back to a different view.
            router.replace(pathname, { scroll: false });
          }
          setDeleteConfirmView(null);
        }}
      />

      <ConfirmDialog
        open={!!deleteRecordId}
        onOpenChange={(o) => !o && setDeleteRecordId(null)}
        title={`Delete ${objectLabel.toLowerCase() || 'record'}`}
        description="This permanently deletes the record. This can't be undone."
        confirmLabel="Delete"
        tone="destructive"
        pending={remove.isPending}
        onConfirm={() => {
          if (!deleteRecordId) return;
          remove.mutate({ objectKey, id: deleteRecordId });
          setDeleteRecordId(null);
        }}
      />

      <SaveViewDialog
        open={saveDialogOpen}
        onOpenChange={setSaveDialogOpen}
        defaultLabel={activeView.label}
        isSaving={createView.isPending}
        onSave={onSaveDialogSubmit}
      />

      {editing && object && (
        <RecordFormDrawer
          open
          onClose={() => setEditing(null)}
          objectKey={objectKey}
          objectLabel={objectLabel}
          fields={fields}
          sections={layout.sections}
          record={editing === 'new' ? null : editing}
          refLabels={refLabels}
        />
      )}
    </>
  );
}

/** Σ / avg / count strip for the sticky list footer. Whole-set numbers from
 *  record.aggregate, which applies the same filter + search predicates as
 *  the list itself — exact even while the search box is active. */
function ListAggregates({
  search,
  serverCount,
  sumField,
  objectKey,
  filters,
  enabled,
}: {
  search: string | undefined;
  serverCount: number | null;
  sumField: FieldDefLite | undefined;
  objectKey: string;
  filters: Filter[];
  enabled: boolean;
}) {
  const sumQ = trpc.record.aggregate.useQuery(
    {
      objectKey,
      groupBy: null,
      measure: { agg: 'sum', fieldKey: sumField?.key ?? '' },
      filters,
      search,
    },
    { enabled: enabled && !!sumField, retry: false, meta: { silent: true } },
  );

  const count = serverCount;
  const sum = sumQ.data ? Number(sumQ.data.buckets[0]?.value ?? 0) : null;
  const avg = sum != null && count != null && count > 0 ? sum / count : null;

  return (
    <div className="flex items-center gap-5 text-muted-foreground text-sm tabular-nums">
      {sumField && sum != null && (
        <span>
          Σ {sumField.label}{' '}
          <span className="font-medium text-foreground">{formatFieldValueText(sumField, sum)}</span>
        </span>
      )}
      {sumField && avg != null && (
        <span>
          Avg{' '}
          <span className="font-medium text-foreground">{formatFieldValueText(sumField, avg)}</span>
        </span>
      )}
      {count != null && (
        <span>
          <span className="font-medium text-foreground">{count.toLocaleString()}</span>{' '}
          {count === 1 ? 'record' : 'records'}
        </span>
      )}
    </div>
  );
}
