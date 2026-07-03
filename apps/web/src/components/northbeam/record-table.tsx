'use client';

// RecordTable — the "list view body" extracted as a standalone primitive:
// DataGrid + pagination + local page-state. Targets the AI artifact engine
// (an AI-generated view can drop `<RecordTable columns rows .../>` into a
// SectionCard) and gives the list-renderer a single composable surface
// instead of the inline grid + pagination block we had before.

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
}: RecordTableProps) {
  const flush = chrome === 'flush';
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(flush ? 100 : defaultPageSize);

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
      {(footer === 'always' || pageCount > 1) && (
        <TablePagination
          pageIndex={safePageIndex}
          pageSize={pageSize}
          pageCount={pageCount}
          totalRows={rows.length}
          onPageChange={setPageIndex}
          onPageSizeChange={(n) => {
            setPageSize(n);
            setPageIndex(0);
          }}
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
  pageCount,
  totalRows,
  onPageChange,
  onPageSizeChange,
  flush = false,
  footerStart,
}: {
  pageIndex: number;
  pageSize: number;
  pageCount: number;
  totalRows: number;
  onPageChange: (i: number) => void;
  onPageSizeChange: (n: number) => void;
  flush?: boolean;
  footerStart?: ReactNode;
}) {
  const firstRow = totalRows === 0 ? 0 : pageIndex * pageSize + 1;
  const lastRow = Math.min(totalRows, (pageIndex + 1) * pageSize);
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
          {firstRow.toLocaleString()}–{lastRow.toLocaleString()} of {totalRows.toLocaleString()}
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
