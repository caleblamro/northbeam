// Artifact generator. Takes a natural-language prompt + the object context
// + a live data summary and asks Claude to produce a structured ArtifactNode
// tree. The same tree shape powers:
//   - The ⌘K palette dialog's preview
//   - Persisted `dashboard` views (config.artifact)
// so a dashboard authored by the LLM and saved via the dialog renders
// identically to one authored by hand.
//
// Schema is intentionally NON-recursive — Vercel AI SDK's JSON-schema
// converter can't represent z.lazy self-references. We model the tree as
// two flat shapes:
//   - LeafNode: a single component with no children (most of them)
//   - SectionNode: a SectionCard that wraps an array of LeafNodes
// One level of nesting only.

import { anthropic } from '@ai-sdk/anthropic';
import { loadEnv } from '@northbeam/config';
import type { FieldRow, ObjectRow } from '@northbeam/db';
import { generateObject } from 'ai';
import { z } from 'zod';

const FILTER_OPS = [
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

const FilterSchema = z.object({
  fieldKey: z.string().min(1),
  op: z.enum(FILTER_OPS),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
});

const SortSchema = z.object({
  fieldKey: z.string().min(1),
  direction: z.enum(['asc', 'desc']),
});

/* ── Leaf nodes ─────────────────────────────────────────────────────────── */

const LEAF_COMPONENTS = [
  'PageHeader',
  'MetricGroup',
  'Metric',
  'Chart',
  'DescriptionList',
  'EmptyState',
  'Text',
  'RecordTable',
  'RecordGrid',
] as const;

const LeafNodeSchema = z.object({
  component: z.enum(LEAF_COMPONENTS),
  props: z.record(z.string(), z.unknown()).optional(),
});

/* ── Section node (one level of nesting) ────────────────────────────────── */

const SectionNodeSchema = z.object({
  component: z.literal('SectionCard'),
  props: z
    .object({
      title: z.string().optional(),
    })
    .passthrough()
    .optional(),
  children: z.array(LeafNodeSchema).optional(),
});

const ArtifactNodeSchema = z.union([LeafNodeSchema, SectionNodeSchema]);

const ArtifactSchema = z.object({
  version: z.literal('1'),
  components: z.array(ArtifactNodeSchema).min(1).max(20),
});

export type Artifact = z.infer<typeof ArtifactSchema>;
export type ArtifactLeafNode = z.infer<typeof LeafNodeSchema>;
export type ArtifactSectionNode = z.infer<typeof SectionNodeSchema>;
export type ArtifactNode = z.infer<typeof ArtifactNodeSchema>;
export type ArtifactFilter = z.infer<typeof FilterSchema>;
export type ArtifactSort = z.infer<typeof SortSchema>;

/* ── Preflight summary ──────────────────────────────────────────────────── */

export type DataSummary = {
  recordCount: number;
  picklistCounts: {
    fieldKey: string;
    fieldLabel: string;
    counts: { value: string; count: number }[];
  }[];
  numericSummary: { fieldKey: string; fieldLabel: string; sum: number; avg: number } | null;
};

function formatDataSummary(summary: DataSummary): string {
  const parts: string[] = [];
  parts.push(`- Total records: ${summary.recordCount.toLocaleString()}`);
  for (const p of summary.picklistCounts) {
    const top = p.counts
      .slice(0, 6)
      .map((c) => `${c.value} (${c.count})`)
      .join(', ');
    parts.push(`- ${p.fieldLabel} breakdown: ${top || 'no values'}`);
  }
  if (summary.numericSummary) {
    const { fieldLabel, sum, avg } = summary.numericSummary;
    parts.push(`- ${fieldLabel}: total ${sum.toLocaleString()}, average ${avg.toLocaleString()}`);
  }
  return parts.join('\n');
}

/* ── System prompt ──────────────────────────────────────────────────────── */

function buildSystemPrompt(object: ObjectRow, fields: FieldRow[], summary: DataSummary): string {
  const fieldLines = fields
    .filter((f) => !f.isSystem || f.key === 'name')
    .slice(0, 40)
    .map((f) => `- ${f.label} (${f.key}, type: ${f.type})`)
    .join('\n');

  return `You are composing a structured dashboard artifact for a CRM workspace inside Northbeam.

The artifact will be rendered as React components on the user's screen.
Respond with valid JSON matching the requested schema — no commentary, no markdown fences.

# Layout — the 12-column grid

Top-level components render onto a 12-column grid. Every top-level node may
set \`props.span\` (integer 1-12; omitted = 12 = full width). Nodes flow
left-to-right, wrapping when a row fills. Compose like a real dashboard:

- Row 1: PageHeader (no span — full width).
- Row 2: a KPI row of 3-4 \`Metric\` tiles, each with span 3 (or 4 for three).
- Row 3: a \`Chart\` with span 7-8 beside a narrower SectionCard (span 4-5)
  holding a RecordTable with 2-3 columns.
- Then full-width (span 12) SectionCards with tables.

Children inside a SectionCard stack vertically and ignore span.

# Available components

## Static (use ONLY these — anything else is dropped)

- PageHeader: hero at the top of the dashboard.
  props: { title: string, subtitle?: string }

- SectionCard: a bordered panel that holds children.
  props: { title?: string }
  children: array of leaf nodes (any component below except SectionCard itself).
  Nest at most one level deep.

- MetricGroup: a row of STATIC stat tiles. Prefer live \`Metric\` tiles (below)
  whenever the number can be computed from records; use MetricGroup only for
  values that exist nowhere in the data.
  props: { items: { label: string, value?: string, delta?: string }[] }
  Keep items ≤ 4 so the row fits.

- DescriptionList: a compact label / value list.
  props: { items: { label: string, value: string }[] }

- EmptyState: a placeholder block.
  props: { title: string, body?: string }

- Text: a plain paragraph.
  props: { value: string, muted?: boolean }

## Data-querying (these load LIVE records at render time)

- Metric: ONE stat tile computed from live records. Use for KPI rows.
  props: {
    label: string,                     // sentence case, e.g. "Open pipeline"
    objectKey: string,
    fn: 'count' | 'sum' | 'avg',
    fieldKey?: string,                 // REQUIRED for sum/avg — a number/currency/percent field key
    filters?: ArtifactFilter[],
    delta?: string,                    // optional signed delta text, e.g. "+12% vs last month"
    span?: number                      // usually 3 (four tiles) or 4 (three tiles)
  }
  Omit objectKey/fn to render a static tile via { label, value: string }.

- Chart: an aggregate chart over live records (group + count/sum/avg).
  props: {
    title?: string,                    // renders as the panel header
    objectKey: string,
    groupBy: string,                   // field key to group on (picklist/reference work best)
    fn: 'count' | 'sum' | 'avg',
    measure?: string,                  // REQUIRED for sum/avg — numeric field key
    chartType: 'bar' | 'donut',
    filters?: ArtifactFilter[],
    limit?: number,                    // top-N before folding the tail into "Other" (bar ≤ 12, donut ≤ 5)
    span?: number
  }
  chartType rules: 'bar' for ranked comparisons ("which industry has the
  most"); 'donut' ONLY for part-to-whole with few groups (≤ 5) and never
  with fn 'avg'. Don't add a Chart and a MetricGroup restating the same
  numbers.

- RecordTable: an embedded table of real records. The user can click any
  row to open the record. Use when the dashboard wants to show "the top N
  X" or "X matching criteria".
  props: {
    objectKey: string,                 // 'account' | 'contact' | 'deal' | 'activity' | another seeded object key
    filters?: ArtifactFilter[],        // see Filter schema below
    sort?: ArtifactSort[],             // see Sort schema below
    columns?: string[],                // field keys to display, 2-5 entries
    limit?: number                     // default 10, max 50
  }

- RecordGrid: card / tile presentation of real records.
  props: same as RecordTable, plus optional { columnsCount?: 1|2|3|4 }

# Filter / Sort schema

ArtifactFilter = { fieldKey: string, op: Op, value?: string | number | boolean | null }
  - fieldKey MUST come from the field list below for the matching objectKey.
  - Op is one of: ${FILTER_OPS.join(', ')}
  - The unary ops (isEmpty, isSet, isTrue, isFalse) take no value.

ArtifactSort = { fieldKey: string, direction: 'asc' | 'desc' }

# Object context

You are composing for the **${object.label}** object (key: \`${object.key}\`).

Fields available to reference:
${fieldLines || '- (no fields surfaced)'}

# Live data summary

Came from a real query against the workspace's data — use these numbers
for matching metrics; don't invent values for the same metrics.

${formatDataSummary(summary)}

# Output rules

- Top-level "components" array: 1-12 items in reading order (the grid
  flows them left-to-right, top-to-bottom by span).
- Lead with a PageHeader. Follow with a Metric KPI row, then Chart /
  SectionCard rows per the layout guidance above.
- Wrap related blocks (an explanatory Text + a RecordTable about the same
  theme) inside one SectionCard. Chart and Metric render their own panel —
  do NOT nest them inside a SectionCard.
- Use RecordTable / RecordGrid wherever the user's prompt implies "show
  me X" — they load real data and the user can click into rows. Avoid
  faking a table with DescriptionList items if you mean "show me records".
- Prefer live Metric / Chart over static numbers. For anything not
  computable from fields, either note that the value isn't tracked, or
  write a clearly-marked sample value prefixed with "—".
- Keep titles ≤ 60 chars, bodies ≤ 280 chars.`;
}

/** Generate an artifact from a natural-language prompt + object context +
 *  the live data summary. Throws when ANTHROPIC_API_KEY isn't configured. */
export async function generateArtifact(opts: {
  prompt: string;
  object: ObjectRow;
  fields: FieldRow[];
  summary: DataSummary;
}): Promise<Artifact> {
  const env = loadEnv();
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured');
  }
  const result = await generateObject({
    model: anthropic(env.ANTHROPIC_MODEL),
    system: buildSystemPrompt(opts.object, opts.fields, opts.summary),
    prompt: opts.prompt,
    schema: ArtifactSchema,
  });
  return result.object;
}
