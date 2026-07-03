// Zod shapes shared across routers. Filter / FilterOp mirror the storage
// types in @northbeam/db views.ts exactly — the same filter contract powers
// saved views (view.ts) and object format rules (object.ts).

import type { Filter, FilterEntry, FilterGroup } from '@northbeam/db';
import { z } from 'zod';

export const FilterOpSchema = z.enum([
  'eq',
  'neq',
  'contains',
  'startsWith',
  'endsWith',
  'gt',
  'lt',
  'gte',
  'lte',
  'before',
  'after',
  'isTrue',
  'isFalse',
  'isEmpty',
  'isSet',
]);

export const FilterSchema: z.ZodType<Filter> = z.object({
  fieldKey: z.string().min(1),
  op: FilterOpSchema,
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
});

/** One OR group of leaf filters — one nesting level, leaves only. */
export const FilterGroupSchema: z.ZodType<FilterGroup> = z.object({
  any: z.array(FilterSchema).min(1).max(10),
});

/** Query-input filter entry: leaf or OR group. Saved-view rows still store
 *  leaf-only arrays (the filter UI edits leaves); groups arrive from the AI
 *  artifact path and API callers. A leaf-only array parses unchanged. */
export const FilterEntrySchema: z.ZodType<FilterEntry> = z.union([FilterSchema, FilterGroupSchema]);
