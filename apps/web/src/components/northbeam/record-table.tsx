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
import type { ViewSort } from '@northbeam/db/views';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useMemo, useState } from 'react';

export type { RecordRow };

interface RecordTableProps {
  columns: FieldDefLite[];
  rows: RecordRow[];
  refLabels: Record<string, string>;
  objectKey: string;
  /** Override the initial page size — defaults to 25 to match the list view. */
  defaultPageSize?: number;
  /** Optional row-height override; passed through to the data grid. */
  rowHeight?: number;
  sort?: ViewSort[];
  onSortChange?: (sort: ViewSort[]) => void;
  /** Patch one or more fields on a record — enables inline cell editing. */
  onCellEdit?: (recordId: string, patch: Record<string, unknown>) => void;
}

export function RecordTable({
  columns,
  rows,
  refLabels,
  objectKey,
  defaultPageSize = 25,
  rowHeight = 36,
  sort,
  onSortChange,
  onCellEdit,
}: RecordTableProps) {
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(defaultPageSize);

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
        height={Math.min(560, 44 + pageSize * rowHeight)}
        sort={sort}
        onSortChange={onSortChange}
        onCellEdit={onCellEdit}
      />
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
      />
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
