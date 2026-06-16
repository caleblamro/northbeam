'use client';

// GridRenderer — tile / card presentation of records. Same data contract as
// the list, different visual density. Default surfaces the first three
// fields (after Name) on each card; the editor surface (#18 follow-up)
// will let users pick which fields show + how many columns wide.

import type { FieldDefLite } from '@/components/northbeam/field-render';
import { RecordGrid } from '@/components/northbeam/record-grid';
import type { ViewRenderer, ViewRendererProps } from '@/lib/views/types';
import { LayoutGrid } from 'lucide-react';
import { z } from 'zod';

type GridConfig = {
  /** Field keys shown on each card body. */
  card_fields?: string[];
  /** Cards per row at xl breakpoint. */
  columns?: 1 | 2 | 3 | 4;
};

export function GridView({
  view,
  objectKey,
  fields,
  rows,
  refLabels,
}: ViewRendererProps) {
  const cfg = (view.config ?? {}) as GridConfig;
  const fieldKeys =
    cfg.card_fields && cfg.card_fields.length > 0
      ? cfg.card_fields
      : view.columns.length > 0
        ? view.columns.slice(0, 3)
        : fields.slice(0, 3).map((f) => f.key);
  const cardFields = fieldKeys
    .map((k) => fields.find((f) => f.key === k))
    .filter((f): f is FieldDefLite => !!f);
  // The CVA variant takes the column count as a string union — convert.
  const cols = (cfg.columns ? String(cfg.columns) : '3') as '1' | '2' | '3' | '4';
  return (
    <RecordGrid
      fields={cardFields}
      rows={rows}
      refLabels={refLabels}
      objectKey={objectKey}
      columns={cols}
    />
  );
}

const GridConfigSchema = z
  .object({
    card_fields: z.array(z.string()).optional(),
    columns: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  })
  .passthrough();

export const GridRenderer: ViewRenderer<GridConfig> = {
  type: 'grid',
  label: 'Grid',
  icon: LayoutGrid,
  Component: GridView,
  configSchema: GridConfigSchema,
  defaultConfig: () => ({ columns: 3 }),
  defaultColumns: (fields) => fields.slice(0, 3).map((f) => f.key),
};
