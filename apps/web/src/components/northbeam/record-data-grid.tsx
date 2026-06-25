'use client';

// RecordDataGrid — wraps the DataGrid primitive (TanStack Table +
// virtualization) for displaying a list of records.
//
// Current scope (v0):
//   - Read-only display + per-column sort (DataGrid provides this out of the
//     box via column.enableSorting + header dropdown).
//   - Name cell is a Link so clicking it still navigates to the record page.
//   - Other cells render via FieldValue (display only).
//
// Out of scope (deferred to a follow-up):
//   - Inline cell editing. DataGrid assumes flat row data; our records are
//     `{ id, name, data: {...} }`, so onDataChange would need a translation
//     layer back to trpc.record.update. Doable but non-trivial; the existing
//     RecordFormDrawer covers create/edit for now.
//   - Per-row actions (delete/duplicate) — pending row-context-menu API.

import { DataGrid } from '@/components/data-grid/data-grid';
import { useDataGrid } from '@/hooks/use-data-grid';
import type { FieldDefLite } from '@/components/northbeam/field-render';
import { FieldValue } from '@/components/northbeam/field-render';
import type { CellOpts } from '@/types/data-grid';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import type { ViewSort } from '@northbeam/db/views';
import Link from 'next/link';
import { useMemo } from 'react';

export type RecordRow = {
  id: string;
  name: string;
  data: Record<string, unknown>;
};

interface RecordDataGridProps {
  columns: FieldDefLite[];
  rows: RecordRow[];
  refLabels: Record<string, string>;
  objectKey: string;
  height?: number;
  /** Optional controlled sort state. When provided, the grid initialises
   *  TanStack's sort to match and reports column-header clicks back via
   *  `onSortChange`. Without these, the grid runs uncontrolled (sort is
   *  in-memory and lost on refresh). */
  sort?: ViewSort[];
  onSortChange?: (sort: ViewSort[]) => void;
}

function toTanStackSorting(sort: ViewSort[]): SortingState {
  // Special-case the synthetic "name" column key so a saved sort on the
  // record's display name still works.
  return sort.map((s) => ({ id: s.fieldKey, desc: s.direction === 'desc' }));
}

function fromTanStackSorting(state: SortingState): ViewSort[] {
  return state.map((s) => ({ fieldKey: s.id, direction: s.desc ? 'desc' : 'asc' }));
}

function fieldToCellOpts(f: FieldDefLite): CellOpts {
  const cfg = (f.config ?? {}) as {
    options?: { value: string; label: string }[];
  };
  switch (f.type) {
    case 'textarea':
      return { variant: 'long-text' };
    case 'number':
    case 'currency':
    case 'percent':
      return { variant: 'number' };
    case 'date':
    case 'datetime':
      return { variant: 'date' };
    case 'checkbox':
      return { variant: 'checkbox' };
    case 'url':
    case 'email':
    case 'phone':
      return { variant: 'url' };
    case 'picklist':
      return {
        variant: 'select',
        options: (cfg.options ?? []).map((o) => ({ value: o.value, label: o.label })),
      };
    case 'multipicklist':
      return {
        variant: 'multi-select',
        options: (cfg.options ?? []).map((o) => ({ value: o.value, label: o.label })),
      };
    default:
      return { variant: 'short-text' };
  }
}

export function RecordDataGrid({
  columns: columnFields,
  rows,
  refLabels,
  objectKey,
  height = 560,
  sort,
  onSortChange,
}: RecordDataGridProps) {
  const gridColumns = useMemo<ColumnDef<RecordRow>[]>(() => {
    const nameCol: ColumnDef<RecordRow> = {
      id: 'name',
      accessorFn: (r) => r.name,
      // header given as a function so DataGrid uses our custom `cell`
      // renderer (Link) instead of the variant-based editable cell. Without
      // this, the Name column would render as an editable text cell and
      // swallow the click that should navigate.
      header: () => <span>Name</span>,
      size: 240,
      enableSorting: true,
      meta: { label: 'Name' },
      cell: (info) => (
        <Link
          href={`/${objectKey}/${info.row.original.id}`}
          className="flex h-full w-full items-center truncate font-medium text-foreground hover:underline"
        >
          {info.getValue() as string}
        </Link>
      ),
    };

    const dataCols = columnFields.map<ColumnDef<RecordRow>>((f) => ({
      id: f.key,
      accessorFn: (r) => r.data[f.key],
      header: f.label,
      size: 180,
      enableSorting: true,
      meta: {
        label: f.label,
        cell: fieldToCellOpts(f),
      },
      cell: (info) => {
        const v = info.getValue();
        return (
          <FieldValue
            field={f}
            value={v}
            referenceLabel={f.type === 'reference' ? refLabels[String(v)] : undefined}
          />
        );
      },
    }));

    return [nameCol, ...dataCols];
  }, [columnFields, refLabels, objectKey]);

  const initialSorting = useMemo<SortingState>(
    () => (sort ? toTanStackSorting(sort) : []),
    [sort],
  );

  const grid = useDataGrid<RecordRow>({
    data: rows,
    columns: gridColumns,
    readOnly: true,
    enableSearch: false,
    enablePaste: false,
    getRowId: (r) => r.id,
    initialState: { sorting: initialSorting },
    onSortingChange: onSortChange
      ? (updater) => {
          // useDataGrid's typing exposes TanStack's Updater shape, but its
          // internal wrapper (use-data-grid.ts:1890) resolves the updater
          // before calling out — narrow defensively and forward the
          // resolved state.
          const next = typeof updater === 'function' ? updater([]) : updater;
          onSortChange(fromTanStackSorting(next));
        }
      : undefined,
  });

  return <DataGrid<RecordRow> {...grid} height={height} stretchColumns />;
}
