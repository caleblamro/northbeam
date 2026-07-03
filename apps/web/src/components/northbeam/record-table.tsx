'use client';

// RecordTable — the "list view body" extracted as a standalone primitive:
// DataGrid + pagination. Targets the AI artifact engine (an AI-generated view
// can drop `<RecordTable columns rows .../>` into a SectionCard) and gives
// the list-renderer a single composable surface.
//
// Two pagination modes:
//   - Uncontrolled (default): `rows` is the whole set; the table slices
//     pages client-side. Embedded artifact tables live here.
//   - Controlled (`pagination` prop): `rows` is ONE server page — the
//     full-page list drives record.list's limit/offset and supplies the
//     whole-set count from record.aggregate, so paging works past the
//     server's 200-row page cap.

import type { FieldDefLite } from '@/components/northbeam/field-render';
import { RecordDataGrid, type RecordRow } from '@/components/northbeam/record-data-grid';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/cn';
import type { ViewSort } from '@northbeam/db/views';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';

export type { RecordRow };

/** Controlled server-side pagination. `totalRows` comes from
 *  record.aggregate (filter- AND search-aware); null = count still loading,
 *  in which case "next" stays enabled while pages come back full. */
export type ListPagination = {
  pageIndex: number;
  pageSize: number;
  totalRows: number | null;
  onPageChange: (i: number) => void;
  onPageSizeChange: (n: number) => void;
};

interface RecordTableProps {
  columns: FieldDefLite[];
  rows: RecordRow[];
  refLabels: Record<string, string>;
  objectKey: string;
  /** Override the initial page size — defaults to 25 to match the list view. */
  defaultPageSize?: number;
  /** 'auto' hides the pagination footer when everything fits on one page —
   *  embedded artifact tables use this so a 5-row widget isn't wearing
   *  full list-view chrome. Default 'always' (the list view). */
  footer?: 'always' | 'auto';
  /** Optional row-height override; passed through to the data grid. */
  rowHeight?: number;
  sort?: ViewSort[];
  onSortChange?: (sort: ViewSort[]) => void;
  /** Patch one or more fields on a record — enables inline cell editing. */
  onCellEdit?: (recordId: string, patch: Record<string, unknown>) => void;
  /** Row hover actions — edit opens the form drawer, delete confirms +
   *  removes. The actions column only renders when at least one is given. */
  onRowEdit?: (row: { id: string; data: Record<string, unknown> }) => void;
  onRowDelete?: (id: string) => void;
  /** 'flush' = full-page list chrome: edge-to-edge grid (no card radius),
   *  viewport-fit height, and a sticky footer bar. Default 'card' keeps the
   *  original bordered widget look for embedded/artifact tables. */
  chrome?: 'card' | 'flush';
  /** Rendered at the start of the footer bar (the aggregate strip). */
  footerStart?: ReactNode;
  /** Server-side pagination (see ListPagination). When present, `rows` is
   *  already one page and no client-side slicing happens. */
  pagination?: ListPagination;
}

export function RecordTable({
  columns,
  rows,
  refLabels,
  objectKey,
  defaultPageSize = 25,
  footer = 'always',
  rowHeight = 36,
  sort,
  onSortChange,
  onCellEdit,
  onRowEdit,
  onRowDelete,
  chrome = 'card',
  footerStart,
  pagination,
}: RecordTableProps) {
  const flush = chrome === 'flush';
  const [localPageIndex, setLocalPageIndex] = useState(0);
  const [localPageSize, setLocalPageSize] = useState(defaultPageSize);

  const controlled = !!pagination;
  const pageSize = pagination?.pageSize ?? localPageSize;
  const clientPageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const pageIndex = pagination?.pageIndex ?? Math.min(localPageIndex, clientPageCount - 1);

  const pagedRows = useMemo(
    () => (controlled ? rows : rows.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize)),
    [controlled, rows, pageIndex, pageSize],
  );
  const totalRows = controlled ? (pagination?.totalRows ?? null) : rows.length;
  const multiPage =
    totalRows != null ? totalRows > pageSize : pageIndex > 0 || rows.length === pageSize;

  return (
    <>
      <RecordDataGrid
        columns={columns}
        rows={pagedRows}
        refLabels={refLabels}
        objectKey={objectKey}
        // Flush mode: fill the viewport under the topbar + control row and
        // leave room for the sticky footer; the grid scrolls internally so
        // its header can stay stuck.
        height={flush ? 'calc(100dvh - 152px)' : Math.min(560, 44 + pageSize * rowHeight)}
        flush={flush}
        sort={sort}
        onSortChange={onSortChange}
        onCellEdit={onCellEdit}
        onRowEdit={onRowEdit}
        onRowDelete={onRowDelete}
      />
      {(footer === 'always' || multiPage) && (
        <TablePagination
          pageIndex={pageIndex}
          pageSize={pageSize}
          rowsOnPage={pagedRows.length}
          totalRows={totalRows}
          onPageChange={pagination?.onPageChange ?? setLocalPageIndex}
          onPageSizeChange={
            pagination?.onPageSizeChange ??
            ((n) => {
              setLocalPageSize(n);
              setLocalPageIndex(0);
            })
          }
          flush={flush}
          footerStart={footerStart}
        />
      )}
    </>
  );
}

function TablePagination({
  pageIndex,
  pageSize,
  rowsOnPage,
  totalRows,
  onPageChange,
  onPageSizeChange,
  flush = false,
  footerStart,
}: {
  pageIndex: number;
  pageSize: number;
  rowsOnPage: number;
  /** null = unknown total (server pagination during an active search). */
  totalRows: number | null;
  onPageChange: (i: number) => void;
  onPageSizeChange: (n: number) => void;
  flush?: boolean;
  footerStart?: ReactNode;
}) {
  const firstRow = rowsOnPage === 0 ? 0 : pageIndex * pageSize + 1;
  const lastRow = pageIndex * pageSize + rowsOnPage;
  const pageCount = totalRows != null ? Math.max(1, Math.ceil(totalRows / pageSize)) : null;
  const hasNext = pageCount != null ? pageIndex < pageCount - 1 : rowsOnPage === pageSize;
  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 text-sm',
        // Flush = the full-page list's footer bar: sticks to the bottom of
        // the app scroll container, full-width hairline on top.
        flush ? 'sticky bottom-0 z-20 border-border border-t bg-background px-4 py-2' : 'mt-3',
      )}
    >
      <div className="flex items-center gap-5">
        {footerStart}
        <div className="text-muted-foreground tabular-nums">
          {firstRow.toLocaleString()}–{lastRow.toLocaleString()}
          {totalRows != null && ` of ${totalRows.toLocaleString()}`}
        </div>
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
            {(pageIndex + 1).toLocaleString()}
            {pageCount != null && ` / ${pageCount.toLocaleString()}`}
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Next page"
            disabled={!hasNext}
            onClick={() => onPageChange(pageIndex + 1)}
          >
            <ChevronRight />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Last page"
            disabled={pageCount == null || pageIndex >= pageCount - 1}
            onClick={() => pageCount != null && onPageChange(pageCount - 1)}
          >
            <ChevronsRight />
          </Button>
        </div>
      </div>
    </div>
  );
}
