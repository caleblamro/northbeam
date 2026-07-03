'use client';

// ListRenderer — the original table-with-pagination view, now a thin shim
// over the RecordTable primitive. Columns come from view.columns; fall back
// to the object's layout.listColumns / first-N field heuristic via the
// renderer's defaultColumns().

import type { FieldDefLite } from '@/components/northbeam/field-render';
import { RecordTable } from '@/components/northbeam/record-table';
import type { ViewRenderer, ViewRendererProps } from '@/lib/views/types';
import { List } from 'lucide-react';
import { z } from 'zod';

export function ListView({
  view,
  objectKey,
  fields,
  rows,
  refLabels,
  sort,
  onSortChange,
  onCellEdit,
  onRowEdit,
  onRowDelete,
  tableChrome,
  footerStart,
}: ViewRendererProps) {
  const columnKeys = view.columns.length > 0 ? view.columns : fields.slice(0, 4).map((f) => f.key);
  const columns = columnKeys
    .map((k) => fields.find((f) => f.key === k))
    .filter((f): f is FieldDefLite => !!f);
  return (
    // Key the table by view.id so switching views remounts the grid (and
    // re-initialises TanStack's sort from the new view). Sort changes from
    // a header click stay in TanStack's internal store, so changing sort
    // does NOT remount — pagination + scroll position survive.
    <RecordTable
      key={view.id}
      columns={columns}
      rows={rows}
      refLabels={refLabels}
      objectKey={objectKey}
      sort={sort}
      onSortChange={onSortChange}
      onCellEdit={onCellEdit}
      onRowEdit={onRowEdit}
      onRowDelete={onRowDelete}
      chrome={tableChrome}
      footerStart={footerStart}
    />
  );
}

// Empty schema — list-specific config isn't needed yet. Density / wrap flags
// land here when the list-view editor surface ships.
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
