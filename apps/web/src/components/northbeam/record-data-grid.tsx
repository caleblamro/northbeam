'use client';

// RecordDataGrid — wraps the DataGrid primitive (TanStack Table +
// virtualization) for displaying a list of records.
//
// Inline editing: when `onCellEdit` is provided, columns whose field type has
// an editable cell variant (text/number/date/picklist/…) keep a string
// `header` so the grid renders its variant-based editable cell (double-click
// or Enter to edit; Tab/Enter/Esc handled inside the variants). The grid's
// `onDataChange` is diffed against the current rows and each changed cell is
// reported as a per-record patch. Reference/address/duration and computed
// fields (READONLY_FIELD_TYPES) always render read-only FieldValue cells via
// a function `header` — the same trick the Name column uses to keep its Link
// navigable.
//
// DataGrid assumes flat row data, so RecordRow's nested `data` is flattened
// into GridRow internally. Field keys can't collide with `id`/`name`: `name`
// is filtered out of the columns and `id` is a system column, not a field key.

import { DataGrid } from '@/components/data-grid/data-grid';
import type { FieldDefLite } from '@/components/northbeam/field-render';
import {
  FieldValue,
  READONLY_FIELD_TYPES,
  formatFieldValueText,
} from '@/components/northbeam/field-render';
import { useDataGrid } from '@/hooks/use-data-grid';
import type { CellOpts } from '@/types/data-grid';
import type { FieldType } from '@northbeam/db/field-types';
import type { ViewSort } from '@northbeam/db/views';
import type { ColumnDef, SortingState } from '@tanstack/react-table';
import Link from 'next/link';
import { useCallback, useMemo } from 'react';

export type RecordRow = {
  id: string;
  name: string;
  data: Record<string, unknown>;
};

type GridRow = Record<string, unknown> & { id: string; name: string };

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
  /** Patch one or more fields on a record. Inline editing is enabled only
   *  when present — without it every cell is a read-only display cell. */
  onCellEdit?: (recordId: string, patch: Record<string, unknown>) => void;
}

// Field types with no editable grid variant: reference needs an async
// combobox, address/duration have bespoke inputs, and computed types are
// never writable.
const GRID_READONLY_TYPES = new Set<FieldType>([
  ...READONLY_FIELD_TYPES,
  'reference',
  'address',
  'duration',
]);

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
      return { variant: 'number', display: (v) => formatFieldValueText(f, v) };
    case 'date':
    case 'datetime':
      return { variant: 'date', display: (v) => formatFieldValueText(f, v) };
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

/** Normalise what a cell variant emitted into what record.update stores. */
function coerceCellValue(field: FieldDefLite, raw: unknown): unknown {
  switch (field.type) {
    case 'number':
    case 'currency':
    case 'percent': {
      if (raw == null || raw === '') return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    }
    case 'checkbox':
      return raw === true;
    case 'multipicklist':
      return Array.isArray(raw) ? raw : [];
    default: {
      if (raw == null) return null;
      const s = String(raw).trim();
      return s === '' ? null : s;
    }
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
  onCellEdit,
}: RecordDataGridProps) {
  const gridRows = useMemo<GridRow[]>(
    () => rows.map((r) => ({ ...r.data, id: r.id, name: r.name })),
    [rows],
  );

  const gridColumns = useMemo<ColumnDef<GridRow>[]>(() => {
    const nameCol: ColumnDef<GridRow> = {
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

    // Drop any caller-supplied `name` field — we always prepend a synthetic
    // Name column (the one that links to the record detail). Without this,
    // a view whose columns include 'name' (or the layout-listColumns fallback
    // for an object whose first field IS 'name') produces two columns with
    // the same id and React fires duplicate-key warnings.
    const dataCols = columnFields
      .filter((f) => f.key !== 'name')
      .map<ColumnDef<GridRow>>((f) => {
        const editable = !!onCellEdit && !GRID_READONLY_TYPES.has(f.type);
        if (editable) {
          return {
            id: f.key,
            accessorFn: (r) => r[f.key],
            header: f.label,
            size: 180,
            enableSorting: true,
            meta: {
              label: f.label,
              cell: fieldToCellOpts(f),
            },
          };
        }
        return {
          id: f.key,
          accessorFn: (r) => r[f.key],
          header: () => <span>{f.label}</span>,
          size: 180,
          enableSorting: true,
          meta: { label: f.label },
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
        };
      });

    return [nameCol, ...dataCols];
  }, [columnFields, refLabels, objectKey, onCellEdit]);

  // The grid's cell variants commit through onDataUpdate → onDataChange with
  // a whole new data array. Diff it against the current rows (unchanged rows
  // keep their identity) and report each changed cell as a record patch.
  const handleDataChange = useCallback(
    (next: GridRow[]) => {
      if (!onCellEdit) return;
      for (let i = 0; i < next.length; i++) {
        const after = next[i];
        const before = gridRows[i];
        if (!after || !before || after === before) continue;
        const patch: Record<string, unknown> = {};
        for (const f of columnFields) {
          if (f.key === 'name' || GRID_READONLY_TYPES.has(f.type)) continue;
          if (!Object.is(after[f.key], before[f.key])) {
            patch[f.key] = coerceCellValue(f, after[f.key]);
          }
        }
        if (Object.keys(patch).length > 0) onCellEdit(before.id, patch);
      }
    },
    [onCellEdit, gridRows, columnFields],
  );

  const initialSorting = useMemo<SortingState>(() => (sort ? toTanStackSorting(sort) : []), [sort]);

  const grid = useDataGrid<GridRow>({
    data: gridRows,
    columns: gridColumns,
    readOnly: !onCellEdit,
    onDataChange: onCellEdit ? handleDataChange : undefined,
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

  return <DataGrid<GridRow> {...grid} height={height} stretchColumns />;
}
