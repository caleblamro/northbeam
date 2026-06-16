'use client';

// Generic list view for any object — toolbar + filter bar + table + row→record-
// page navigation + create/edit drawer + delete. One component backs Contacts/
// Accounts/Deals/Activities on real data.

import { EmptyState } from '@/components/northbeam/empty-state';
import { FilterDialog } from '@/components/northbeam/filter-bar';
import { ListToolbar } from '@/components/northbeam/list-toolbar';
import { RecordDataGrid } from '@/components/northbeam/record-data-grid';
import { RecordFormDrawer } from '@/components/northbeam/record-form';
import { ObjChip } from '@/components/northbeam/app-bits';
import { HidePageHead, PageActions } from '@/components/northbeam/app-shell';
import { type FieldDefLite } from '@/components/northbeam/field-render';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { LoadingScreen } from '@/components/ui/loading-screen';
import { trpc } from '@/lib/api';
import {
  type Filter,
  readFiltersFromParams,
  rowPassesFilters,
  writeFiltersToParams,
} from '@/lib/filters';
import type { ObjectLayout } from '@northbeam/db/field-types';
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Upload,
  UserPlus,
} from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

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
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);
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
  const list = trpc.record.list.useQuery({ objectKey, search: q || undefined });
  const remove = trpc.record.remove.useMutation({
    onSuccess: () => utils.record.list.invalidate(),
  });

  const fields = (list.data?.fields ?? []) as FieldDefLite[];
  const allRows = list.data?.rows ?? [];
  // Client-side filtering for v0. Server-side filtering on `record.list` is
  // the next move once the dynamic-records layer grows predicate support — at
  // that point this `rows` is `allRows` again and the `filters` array is
  // passed straight into the tRPC query.
  const effectiveFilters = useMemo(
    () => (staticFilters ? [...staticFilters, ...filters] : filters),
    [staticFilters, filters],
  );
  const rows = useMemo(
    () =>
      effectiveFilters.length === 0
        ? allRows
        : allRows.filter((r) => rowPassesFilters(fields, r.data, effectiveFilters)),
    [allRows, fields, effectiveFilters],
  );
  const refLabels = list.data?.refLabels ?? {};
  const object = list.data?.object;
  const objectLabel = object?.label ?? '';
  const objectPlural = object?.labelPlural ?? '';
  const layout = (object?.layout ?? {}) as ObjectLayout;

  // Reset to page 0 when the result set shrinks below the current page.
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePageIndex = Math.min(pageIndex, pageCount - 1);
  const pagedRows = useMemo(
    () => rows.slice(safePageIndex * pageSize, safePageIndex * pageSize + pageSize),
    [rows, safePageIndex, pageSize],
  );

  const colKeys = layout.listColumns?.length
    ? layout.listColumns
    : fields.slice(0, 4).map((f) => f.key);
  const columns = colKeys
    .map((k) => fields.find((f) => f.key === k))
    .filter((f): f is FieldDefLite => !!f);

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
              <h1 className="font-medium text-2xl tracking-[-0.02em]">{objectPlural || objectKey}</h1>
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
      ) : rows.length === 0 ? (
        <Card className="p-0">
          <EmptyState
            icon={UserPlus}
            title={q ? `No ${objectPlural.toLowerCase()} match` : `No ${objectPlural.toLowerCase()} yet`}
            body={
              q
                ? 'Try a different search.'
                : `Create your first ${objectLabel.toLowerCase()}, or run a Salesforce migration.`
            }
            action={!q && createBtn}
          />
        </Card>
      ) : (
        <>
          <RecordDataGrid
            columns={columns}
            rows={pagedRows}
            refLabels={refLabels}
            objectKey={objectKey}
            height={Math.min(560, 44 + pageSize * 36)}
          />
          <Pagination
            pageIndex={safePageIndex}
            pageSize={pageSize}
            pageCount={pageCount}
            totalRows={rows.length}
            onPageChange={setPageIndex}
            onPageSizeChange={(n) => {
              setPageSize(n);
              setPageIndex(0);
            }}
          />
        </>
      )}

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

function Pagination({
  pageIndex,
  pageSize,
  pageCount,
  totalRows,
  onPageChange,
  onPageSizeChange,
}: {
  pageIndex: number;
  pageSize: number;
  pageCount: number;
  totalRows: number;
  onPageChange: (i: number) => void;
  onPageSizeChange: (n: number) => void;
}) {
  const firstRow = totalRows === 0 ? 0 : pageIndex * pageSize + 1;
  const lastRow = Math.min(totalRows, (pageIndex + 1) * pageSize);
  return (
    <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
      <div className="text-muted-foreground tabular-nums">
        {firstRow.toLocaleString()}–{lastRow.toLocaleString()} of{' '}
        {totalRows.toLocaleString()}
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-muted-foreground text-xs">
          <span>Rows per page</span>
          <Select
            value={`${pageSize}`}
            onValueChange={(v) => onPageSizeChange(Number(v))}
          >
            <SelectTrigger size="sm" className="h-7 w-16">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[10, 25, 50, 100].map((n) => (
                <SelectItem key={n} value={`${n}`}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="First page"
            disabled={pageIndex === 0}
            onClick={() => onPageChange(0)}
          >
            <ChevronsLeft />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Previous page"
            disabled={pageIndex === 0}
            onClick={() => onPageChange(pageIndex - 1)}
          >
            <ChevronLeft />
          </Button>
          <div className="px-2 text-muted-foreground text-xs tabular-nums">
            {(pageIndex + 1).toLocaleString()} / {pageCount.toLocaleString()}
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Next page"
            disabled={pageIndex >= pageCount - 1}
            onClick={() => onPageChange(pageIndex + 1)}
          >
            <ChevronRight />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Last page"
            disabled={pageIndex >= pageCount - 1}
            onClick={() => onPageChange(pageCount - 1)}
          >
            <ChevronsRight />
          </Button>
        </div>
      </div>
    </div>
  );
}
