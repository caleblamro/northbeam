'use client';

// ListRenderer — the original table-with-pagination view, now registered as
// a member of VIEW_RENDERERS. Renders the DataGrid + a compact pager
// underneath. Columns come from view.columns; falls back to the object's
// layout.listColumns or the first few fields.
//
// State that's purely renderer-local (page index, page size) stays inside
// the component. The dispatcher (RecordListView) is renderer-agnostic.

import { RecordDataGrid } from '@/components/northbeam/record-data-grid';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ViewRenderer, ViewRendererProps } from '@/lib/views/types';
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  List,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { z } from 'zod';

export function ListView({
  view,
  objectKey,
  fields,
  rows,
  refLabels,
}: ViewRendererProps) {
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(25);

  // Column resolution: prefer view.columns, then the object layout, then the
  // first few fields. Mapping back to FieldDefLite ignores anything stale.
  const columnKeys =
    view.columns.length > 0
      ? view.columns
      : fields.slice(0, 4).map((f) => f.key);
  const columns = columnKeys
    .map((k) => fields.find((f) => f.key === k))
    .filter((f): f is (typeof fields)[number] => !!f);

  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePageIndex = Math.min(pageIndex, pageCount - 1);
  const pagedRows = useMemo(
    () => rows.slice(safePageIndex * pageSize, safePageIndex * pageSize + pageSize),
    [rows, safePageIndex, pageSize],
  );

  return (
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
        {firstRow.toLocaleString()}–{lastRow.toLocaleString()} of {totalRows.toLocaleString()}
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-muted-foreground text-xs">
          <span>Rows per page</span>
          <Select value={`${pageSize}`} onValueChange={(v) => onPageSizeChange(Number(v))}>
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

// Empty schema — no list-specific config needed today. Add a `density` or
// `wrap` setting here when the list editor surface ships.
const ListConfigSchema = z.object({}).passthrough();

export const ListRenderer: ViewRenderer<Record<string, never>> = {
  type: 'list',
  label: 'List',
  icon: List,
  Component: ListView,
  configSchema: ListConfigSchema,
  defaultConfig: () => ({}),
  defaultColumns: (fields) => fields.slice(0, 4).map((f) => f.key),
};
