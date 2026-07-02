// Zod shapes shared across routers. Filter / FilterOp mirror the storage
// types in @northbeam/db views.ts exactly — the same filter contract powers
// saved views (view.ts) and object format rules (object.ts).

import type { Filter } from '@northbeam/db';
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
