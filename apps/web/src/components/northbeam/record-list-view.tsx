'use client';

// Generic list view for any object — toolbar + filter bar + table + row→record-
// page navigation + create/edit drawer + delete. One component backs Contacts/
// Accounts/Deals/Activities on real data.

import { ObjChip } from '@/components/northbeam/app-bits';
import { HidePageHead, PageActions } from '@/components/northbeam/app-shell';
import { ConfirmDialog } from '@/components/northbeam/confirm-dialog';
import { EmptyState } from '@/components/northbeam/empty-state';
import type { FieldDefLite } from '@/components/northbeam/field-render';
import { FilterDialog } from '@/components/northbeam/filter-bar';
import { ListToolbar } from '@/components/northbeam/list-toolbar';
import { RecordFormDrawer } from '@/components/northbeam/record-form';
import { SaveViewDialog } from '@/components/northbeam/save-view-dialog';
import { ViewPicker } from '@/components/northbeam/view-picker';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { LoadingScreen } from '@/components/ui/loading-screen';
import { trpc } from '@/lib/api';
import { type Filter, readFiltersFromParams, writeFiltersToParams } from '@/lib/filters';
import { getViewRenderer } from '@/lib/views/registry';
import type { ViewRow } from '@/lib/views/types';
import { readSortFromParams, writeSortToParams } from '@/lib/views/url-state';
import type { ObjectLayout } from '@northbeam/db/field-types';
import type { ShareTarget, ViewIcon } from '@northbeam/db/views';
import type { ViewSort } from '@northbeam/db/views';
import { AlertCircle, Upload, UserPlus } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';

export function RecordListView({
  objectKey,
  newLabel,
  showImport = true,
  standalone = false,
  staticFilters,
}: {
  objectKey: string;
  newLabel?: string;
  showImport?: boolean;
  standalone?: boolean;
  /** Always-applied filters that aren't user-editable and don't appear in the
   *  URL. Use to scope a derived list (e.g. a saved view that pins
   *  type=customer). The user's own filters layer on top via the FilterBar. */
  staticFilters?: Filter[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [q, setQ] = useState('');
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
    return found ?? stored.find((v) => v.isDefault) ?? stored[0] ?? null;
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
    }),
    [objectKey, q, effectiveFilters, effectiveSort],
  );
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

  const fields = (list.data?.fields ?? []) as FieldDefLite[];
  // Rows arrive filtered + sorted by the server — no client-side pass needed.
  const rows = list.data?.rows ?? [];
  const refLabels = list.data?.refLabels ?? {};
  const object = list.data?.object;
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

  // Override detection — the picker uses this to surface "Save as new view…"
  // when the URL state (filters or sort) diverges from what the active view
  // stores. A sort-only column-header click counts as an override too.
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

  // Dialog state for "Save as new view…". Opened either from the picker
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

  const createBtn = (
    <Button onClick={() => setEditing('new')}>
      <UserPlus />
      {newLabel ?? `New ${objectLabel.toLowerCase() || 'record'}`}
    </Button>
  );

  if (list.isError) {
    return (
      <>
        {standalone && <HidePageHead />}
        <EmptyState
          icon={AlertCircle}
          title="Unknown object"
          body={`No object '${objectKey}' exists in this workspace.`}
        />
      </>
    );
  }

  return (
    <>
      {standalone ? (
        <>
          <HidePageHead />
          <header className="mb-6 flex items-center gap-3">
            <ObjChip label={objectLabel || objectKey} color={object?.color} size={32} />
            <div className="min-w-0 flex-1">
              <h1 className="font-medium text-2xl tracking-[-0.02em]">
                {objectPlural || objectKey}
              </h1>
              {!list.isLoading && (
                <p className="text-muted-foreground text-sm tabular-nums">
                  {rows.length.toLocaleString()} {rows.length === 1 ? 'record' : 'records'}
                </p>
              )}
            </div>
            <div>{createBtn}</div>
          </header>
        </>
      ) : (
        <PageActions>
          {showImport && (
            <Button variant="outline">
              <Upload />
              Import
            </Button>
          )}
          {createBtn}
        </PageActions>
      )}

      <div className="mb-3 flex items-center justify-between gap-2">
        <ViewPicker
          views={viewsQ.data ?? []}
          activeView={activeView}
          hasOverrides={hasOverrides}
          currentUserId={currentUserId}
          onSelect={selectView}
          onSaveAsNew={saveAsNewView}
          onSetDefault={(v) => setDefaultView.mutate({ id: v.id })}
          onDelete={(v) => setDeleteConfirmView(v)}
        />
      </div>

      <ListToolbar
        searchValue={q}
        onSearchChange={setQ}
        searchPlaceholder={`Search ${objectPlural.toLowerCase() || 'records'}…`}
        actions={
          <FilterDialog
            fields={fields}
            filters={filters}
            onChange={setFilters}
            loadReferenceOptions={(targetObject, query) =>
              utils.record.searchRefs.fetch({ objectKey: targetObject, q: query })
            }
          />
        }
      />

      {list.isLoading ? (
        <Card className="p-0">
          <LoadingScreen size="md" />
        </Card>
      ) : rows.length === 0 && activeView.type !== 'report' ? (
        // Report views aggregate server-side over ALL rows — the list's
        // max-200-row page being empty says nothing about the report, so they
        // skip this empty-state gate and render regardless.
        <Card className="p-0">
          <EmptyState
            icon={UserPlus}
            title={
              q ? `No ${objectPlural.toLowerCase()} match` : `No ${objectPlural.toLowerCase()} yet`
            }
            body={
              q
                ? 'Try a different search.'
                : `Create your first ${objectLabel.toLowerCase()}, or run a Salesforce migration.`
            }
            action={!q && createBtn}
          />
        </Card>
      ) : (
        (() => {
          // Dispatch to the registered renderer for `activeView.type`. The
          // dispatcher is renderer-agnostic; per-type state (pagination here,
          // kanban columns later, etc.) lives inside each registration.
          const renderer = getViewRenderer(activeView.type);
          if (!renderer) {
            return (
              <Card className="p-0">
                <EmptyState
                  icon={AlertCircle}
                  title="Unknown view type"
                  body={`No renderer registered for type '${activeView.type}'.`}
                />
              </Card>
            );
          }
          const Renderer = renderer.Component;
          return (
            <Renderer
              view={activeView}
              objectKey={objectKey}
              objectLabel={objectLabel}
              fields={fields}
              rows={rows}
              refLabels={refLabels}
              isLoading={list.isLoading}
              onRowOpen={(id) => router.push(`/${objectKey}/${id}`)}
              onRowEdit={(row) => setEditing(row)}
              onRowDelete={(id) => remove.mutate({ objectKey, id })}
              onCellEdit={(id, patch) => update.mutate({ objectKey, id, data: patch })}
              onSaveView={saveAsNewView}
              sort={effectiveSort}
              onSortChange={setSort}
            />
          );
        })()
      )}

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

// Pagination + grid moved into components/northbeam/views/list-renderer.tsx
// when the renderer dispatcher pattern landed. Kept here as a breadcrumb in
// case anyone greps for it.
