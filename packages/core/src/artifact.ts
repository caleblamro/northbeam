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
