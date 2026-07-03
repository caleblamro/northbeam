// Artifact contract — the { version, components } tree behind `dashboard`
// views. One schema, three consumers:
//   - apps/api/src/ai/artifact-generator.ts asks Claude for this shape
//     (generateObject / streamObject validate against it)
//   - apps/api/src/trpc/routers/view.ts validates `config.artifact` before a
//     dashboard view row is written
//   - apps/web .../views/artifact-walker.tsx renders it (the walker stays
//     runtime-lenient so drifted saved artifacts degrade instead of crashing —
//     the `*Like` types below are its shape)
//
// The strict schema is intentionally NON-recursive — Vercel AI SDK's
// JSON-schema converter can't represent z.lazy self-references. The tree is
// modeled as two flat shapes:
//   - LeafNode: a single component with no children (most of them)
//   - SectionNode: a SectionCard that wraps an array of LeafNodes
// One level of nesting only.

import { z } from 'zod';

export const ARTIFACT_FILTER_OPS = [
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
] as const;

export const ArtifactFilterSchema = z.object({
  fieldKey: z.string().min(1),
  op: z.enum(ARTIFACT_FILTER_OPS),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
});

export const ArtifactSortSchema = z.object({
  fieldKey: z.string().min(1),
  direction: z.enum(['asc', 'desc']),
});

/** The Chart node's chartType vocabulary — one const consumed by the prompt
 *  gallery (artifact-generator), the repair pass, and the web walker so the
 *  three can't drift. Deliberately excludes the report-view-only 'kpi': a
 *  dashboard's single stat is the Metric component. */
export const ARTIFACT_CHART_TYPES = [
  'bar',
  'line',
  'area',
  'donut',
  'scatter',
  'funnel',
  'table',
  'matrix',
] as const;

export type ArtifactChartType = (typeof ARTIFACT_CHART_TYPES)[number];

/** Date-grain vocabulary for Chart `dateGrain` props — mirrors the engine's
 *  DateGrain (packages/db) without coupling core to db. */
export const ARTIFACT_DATE_GRAINS = ['day', 'week', 'month', 'quarter', 'year'] as const;

/* ── Actions ────────────────────────────────────────────────────────────────
   Declarative next-steps a dashboard can offer. The model composes specs from
   this CLOSED vocabulary only; execution happens client-side through the
   app's existing flows and mutations, so server-side permission checks stay
   authoritative. Deliberately absent: delete, bulk mutations, arbitrary
   navigation — the vocabulary is the security boundary. */

export const ArtifactActionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('createRecord'),
    label: z.string().min(1).max(40),
    objectKey: z.string().min(1),
    /** Field defaults pre-filled into the create form (still user-submitted
     *  through record.create with full validation). */
    defaults: z
      .record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]))
      .optional(),
  }),
  z.object({
    kind: z.literal('navigate'),
    label: z.string().min(1).max(40),
    /** Object list page only — the model can't know real view/record ids. */
    objectKey: z.string().min(1),
  }),
  z.object({
    kind: z.literal('openComposer'),
    label: z.string().min(1).max(40),
    prompt: z.string().min(1).max(500),
  }),
]);

export type ArtifactAction = z.infer<typeof ArtifactActionSchema>;

/** Per-row quick action on RecordTable / RecordList nodes — one click sets
 *  one field to one value ("Mark won"), via the ordinary record.update. */
export const ArtifactRowActionSchema = z.object({
  kind: z.literal('setField'),
  label: z.string().min(1).max(30),
  fieldKey: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean()]),
});

export type ArtifactRowAction = z.infer<typeof ArtifactRowActionSchema>;

/* ── Leaf nodes ─────────────────────────────────────────────────────────── */

export const ARTIFACT_LEAF_COMPONENTS = [
  'PageHeader',
  'Heading',
  'MetricGroup',
  'Metric',
  'Chart',
  'Progress',
  'Chips',
  'DescriptionList',
  'EmptyState',
  'Text',
  'Callout',
  'Divider',
  'RecordTable',
  'RecordGrid',
  'RecordList',
  'ActionBar',
  // Workspace (home) components — the Home page's greeting hero, inline
  // stat band, and the needs-attention work queue. Meaningful on workspace-
  // scoped dashboards; soft-fail elsewhere.
  'Greeting',
  'StatBand',
  'AttentionQueue',
  // Record-context components — meaningful only inside a `detail` view's
  // record page (they read the current record); soft-fail elsewhere.
  'RecordFields',
  'RelatedList',
  'StagePath',
  // Advanced declarative query (QuerySpec) — multi-measure / expression /
  // EXISTS shapes the simpler Chart/Metric props can't express.
  'QueryBlock',
] as const;

export const ArtifactLeafNodeSchema = z.object({
  component: z.enum(ARTIFACT_LEAF_COMPONENTS),
  props: z.record(z.string(), z.unknown()).optional(),
});

/* ── Section node (one level of nesting) ────────────────────────────────── */

export const ArtifactSectionNodeSchema = z.object({
  component: z.literal('SectionCard'),
  props: z
    .object({
      title: z.string().optional(),
    })
    .passthrough()
    .optional(),
  children: z.array(ArtifactLeafNodeSchema).optional(),
});

export const ArtifactNodeSchema = z.union([ArtifactLeafNodeSchema, ArtifactSectionNodeSchema]);

export const ArtifactSchema = z.object({
  version: z.literal('1'),
  components: z.array(ArtifactNodeSchema).min(1).max(20),
});

/* ── Refinement patches ─────────────────────────────────────────────────────
   Small edits shouldn't regenerate the whole tree: in refinement mode the
   model may return PATCH OPS against the current artifact's top-level
   components (by index) instead of a full artifact — cheaper, faster, and
   structurally incapable of drifting nodes the instruction didn't touch. */

export const ArtifactPatchOpSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('set'),
    index: z.number().int().min(0).max(19),
    node: ArtifactNodeSchema,
  }),
  z.object({
    op: z.literal('insert'),
    index: z.number().int().min(0).max(20),
    node: ArtifactNodeSchema,
  }),
  z.object({ op: z.literal('remove'), index: z.number().int().min(0).max(19) }),
  z.object({
    op: z.literal('props'),
    index: z.number().int().min(0).max(19),
    /** Shallow-merged into the node's props; a null value deletes the key. */
    props: z.record(z.string(), z.unknown()),
  }),
]);

export const ArtifactPatchSchema = z.array(ArtifactPatchOpSchema).min(1).max(10);

export type ArtifactPatchOp = z.infer<typeof ArtifactPatchOpSchema>;
export type ArtifactPatch = z.infer<typeof ArtifactPatchSchema>;

export type Artifact = z.infer<typeof ArtifactSchema>;
export type ArtifactLeafNode = z.infer<typeof ArtifactLeafNodeSchema>;
export type ArtifactSectionNode = z.infer<typeof ArtifactSectionNodeSchema>;
export type ArtifactNode = z.infer<typeof ArtifactNodeSchema>;
export type ArtifactFilter = z.infer<typeof ArtifactFilterSchema>;
export type ArtifactSort = z.infer<typeof ArtifactSortSchema>;

/* ── Lenient shape ──────────────────────────────────────────────────────── */

// What an artifact looks like when you can't trust it conformed to the strict
// schema above: older saved dashboards, hand-edited config JSON, mid-stream
// partials. The walker renders this shape (unknown components soft-fail), and
// ai.preview accepts it as the refinement base so a drifted dashboard can
// still be refined. Recursive on purpose — this one never passes through the
// AI SDK's schema converter.
export type ArtifactNodeLike = {
  component: string;
  props?: Record<string, unknown>;
  children?: ArtifactNodeLike[];
};

export type ArtifactLike = {
  version: '1';
  components: ArtifactNodeLike[];
};

export const ArtifactNodeLikeSchema: z.ZodType<ArtifactNodeLike> = z.lazy(() =>
  z.object({
    component: z.string().min(1),
    props: z.record(z.string(), z.unknown()).optional(),
    children: z.array(ArtifactNodeLikeSchema).optional(),
  }),
);

export const ArtifactLikeSchema: z.ZodType<ArtifactLike> = z.object({
  version: z.literal('1'),
  components: z.array(ArtifactNodeLikeSchema).min(1),
});
