// QuerySpec — the "almost raw SQL" declarative query language the AI (and
// API callers) can emit. The COMPILER is the security boundary, not the
// model: every spec resolves against live metadata and compiles through the
// same qid()/parameterization/aclPredicate machinery as every other query
// (packages/db/src/dynamic/query-compiler.ts). The spec is deliberately
// capped — condition depth ≤ 3, exists non-nested, ≤ 5 measures, one
// expression level — and deliberately missing arbitrary functions,
// subselects, and unions. That ceiling is the design, not a TODO.

import { z } from 'zod';
import { ArtifactFilterSchema } from './artifact.js';

export const QUERY_MEASURE_FNS = [
  'count',
  'sum',
  'avg',
  'min',
  'max',
  'countDistinct',
  'median',
  'stddev',
  'p90',
  'p10',
] as const;

const MeasureIdSchema = z.string().regex(/^[a-z][a-z0-9_]{0,23}$/, 'lowercase measure id');

/** One operand of a measure expression: another measure's id, or a literal. */
const OperandSchema = z.union([
  z.object({ ref: MeasureIdSchema }),
  z.object({ value: z.number().finite() }),
]);

export const QueryMeasureSchema = z.object({
  id: MeasureIdSchema,
  fn: z.enum(QUERY_MEASURE_FNS).optional(),
  fieldKey: z.string().min(1).optional(),
  /** Computed measure — one binary op over other (non-expr) measures /
   *  literals. `/` compiles with a nullif guard (divide-by-zero → NULL). */
  expr: z
    .object({
      op: z.enum(['+', '-', '*', '/']),
      left: OperandSchema,
      right: OperandSchema,
    })
    .optional(),
  /** Running total across buckets, chronological — requires the query to
   *  have exactly one DATE grouping. */
  cumulative: z.boolean().optional(),
  /** This bucket's share of the grand total (0–1) — requires ≥1 grouping. */
  share: z.boolean().optional(),
});

export type QueryMeasure = z.infer<typeof QueryMeasureSchema>;

/** Related-record condition — records of `objectKey` whose `refFieldKey`
 *  points at the current row. `negate` = "with NO such records". */
export type QueryExists = {
  exists: { objectKey: string; refFieldKey: string; where?: QueryCondition };
  negate?: boolean;
};

export type QueryCondition =
  | z.infer<typeof ArtifactFilterSchema>
  | { all: QueryCondition[] }
  | { any: QueryCondition[] }
  | QueryExists;

/** Depth-capped condition tree. z.lazy is fine here — QuerySpec never rides
 *  the AI SDK's schema converter (QueryBlock props flow through the open
 *  props record; validation happens in repair + the router). */
export const QueryConditionSchema: z.ZodType<QueryCondition> = z.lazy(() =>
  z.union([
    ArtifactFilterSchema,
    z.object({ all: z.array(QueryConditionSchema).min(1).max(10) }),
    z.object({ any: z.array(QueryConditionSchema).min(1).max(10) }),
    z.object({
      exists: z.object({
        objectKey: z.string().min(1),
        refFieldKey: z.string().min(1),
        // Leaves + one and/or level only inside an exists — no exists-in-exists.
        where: z
          .union([
            ArtifactFilterSchema,
            z.object({ all: z.array(ArtifactFilterSchema).min(1).max(10) }),
            z.object({ any: z.array(ArtifactFilterSchema).min(1).max(10) }),
          ])
          .optional(),
      }),
      negate: z.boolean().optional(),
    }),
  ]),
);

export const QueryHavingSchema = z.object({
  /** A measure id, or 'count' for the bucket's record count. */
  measure: z.union([MeasureIdSchema, z.literal('count')]),
  op: z.enum(['gt', 'gte', 'lt', 'lte']),
  value: z.number().finite(),
});

export const QuerySpecSchema = z
  .object({
    objectKey: z.string().min(1),
    where: QueryConditionSchema.optional(),
    /** 0–2 groupings; keys may be one-hop dot paths ('account.industry'). */
    groupBy: z
      .array(
        z.object({
          fieldKey: z.string().min(1),
          grain: z.enum(['day', 'week', 'month', 'quarter', 'year']).optional(),
        }),
      )
      .max(2)
      .optional(),
    measures: z.array(QueryMeasureSchema).min(1).max(5),
    having: z.array(QueryHavingSchema).max(4).optional(),
    orderBy: z
      .object({
        ref: z.union([z.literal('group'), MeasureIdSchema]),
        direction: z.enum(['asc', 'desc']),
      })
      .optional(),
    limit: z.number().int().min(1).max(1000).optional(),
  })
  .superRefine((spec, ctx) => {
    const ids = new Set<string>();
    for (const m of spec.measures) {
      if (ids.has(m.id)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `duplicate measure id '${m.id}'` });
      }
      ids.add(m.id);
      if (m.expr && m.fn) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `measure '${m.id}' can't be both an aggregate and an expression`,
        });
      }
      if (!m.expr && !m.fn) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `measure '${m.id}' needs fn or expr`,
        });
      }
      if (m.fn && m.fn !== 'count' && !m.fieldKey) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `measure '${m.id}': fn '${m.fn}' requires a fieldKey`,
        });
      }
    }
    // Expression operands may only reference NON-expression measures — one
    // computed level, no chains.
    const plainIds = new Set(spec.measures.filter((m) => !m.expr).map((m) => m.id));
    for (const m of spec.measures) {
      if (!m.expr) continue;
      for (const side of [m.expr.left, m.expr.right]) {
        if ('ref' in side && !plainIds.has(side.ref)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `measure '${m.id}' references unknown or computed measure '${side.ref}'`,
          });
        }
      }
    }
  });

export type QuerySpec = z.infer<typeof QuerySpecSchema>;
