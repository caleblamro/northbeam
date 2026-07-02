// Artifact generator. Takes a natural-language prompt + the object context
// + a live data summary and asks Claude to produce a structured ArtifactNode
// tree. The same tree shape powers:
//   - The ⌘K palette dialog's preview
//   - Persisted `dashboard` views (config.artifact)
// so a dashboard authored by the LLM and saved via the dialog renders
// identically to one authored by hand.
//
// The Artifact schema itself lives in @northbeam/core/artifact — shared with
// the view router (validates config.artifact on save) and mirrored by the web
// walker. Generation streams: streamArtifact returns the partial-object
// stream plus a promise for the final schema-validated result. The model
// emits { note, artifact } — note FIRST so the composer's chat bubble starts
// filling before the components arrive.

import { anthropic } from '@ai-sdk/anthropic';
import { loadEnv } from '@northbeam/config';
import {
  ARTIFACT_FILTER_OPS,
  ARTIFACT_LEAF_COMPONENTS,
  type Artifact,
  type ArtifactLike,
  ArtifactSchema,
} from '@northbeam/core';
import type { FieldRow, ObjectRow } from '@northbeam/db';
import { jsonSchema, streamObject } from 'ai';
import { z } from 'zod';

export type { Artifact, ArtifactLike };

export type ObjectContext = { object: ObjectRow; fields: FieldRow[] };

const GenerationSchema = z.object({
  /** One conversational sentence for the chat thread — what was built or
   *  changed and why. Declared before `artifact` so it streams first. */
  note: z.string(),
  artifact: ArtifactSchema,
});

export type Generation = z.infer<typeof GenerationSchema>;

// The JSON schema the PROVIDER sees is hand-authored: the AI SDK's zod
// converter (addAdditionalPropertiesToJsonSchema) rewrites every object to
// `additionalProperties: false`, which turns the free-form `props` record
// into "no properties allowed" — the model then emits `props: {}` for every
// component and the dashboard renders empty. Runtime validation still runs
// the zod GenerationSchema via the `validate` callback, so nothing invalid
// gets past this file either way.
const OPEN_PROPS = { type: 'object', additionalProperties: true } as const;
const LEAF_NODE_JSON = {
  type: 'object',
  properties: {
    component: { type: 'string', enum: [...ARTIFACT_LEAF_COMPONENTS] },
    props: OPEN_PROPS,
  },
  required: ['component'],
  additionalProperties: false,
} as const;
const SECTION_NODE_JSON = {
  type: 'object',
  properties: {
    component: { type: 'string', enum: ['SectionCard'] },
    props: OPEN_PROPS,
    children: { type: 'array', items: LEAF_NODE_JSON },
  },
  required: ['component'],
  additionalProperties: false,
} as const;
const generationProviderSchema = jsonSchema<Generation>(
  {
    type: 'object',
    properties: {
      note: {
        type: 'string',
        description: 'One conversational sentence (≤ 280 chars) for the chat thread.',
      },
      artifact: {
        type: 'object',
        properties: {
          version: { type: 'string', enum: ['1'] },
          components: {
            type: 'array',
            items: { anyOf: [LEAF_NODE_JSON, SECTION_NODE_JSON] },
            minItems: 1,
            maxItems: 20,
          },
        },
        required: ['version', 'components'],
        additionalProperties: false,
      },
    },
    required: ['note', 'artifact'],
    additionalProperties: false,
  },
  {
    validate: (value) => {
      const result = GenerationSchema.safeParse(value);
      return result.success
        ? { success: true, value: result.data }
        : { success: false, error: result.error };
    },
  },
);

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

function fieldLinesFor(fields: FieldRow[], cap: number): string {
  return fields
    .filter((f) => !f.isSystem || f.key === 'name')
    .slice(0, cap)
    .map((f) => `- ${f.label} (${f.key}, type: ${f.type})`)
    .join('\n');
}

/** Pure prompt assembly — exported so tests can assert the contract (field
 *  cap, data-summary injection, cross-object context, refinement section)
 *  without an API call. */
export function buildSystemPrompt(
  object: ObjectRow,
  fields: FieldRow[],
  summary: DataSummary,
  currentArtifact?: ArtifactLike,
  otherObjects: ObjectContext[] = [],
): string {
  const fieldLines = fieldLinesFor(fields, 40);

  const otherObjectLines = otherObjects
    .filter((o) => o.object.key !== object.key)
    .map(
      (o) =>
        `## ${o.object.label} (key: \`${o.object.key}\`)\n${fieldLinesFor(o.fields, 20) || '- (no fields surfaced)'}`,
    )
    .join('\n\n');

  const refinement = currentArtifact
    ? `

# Refinement mode

The user already has a dashboard and is asking for a change. Current artifact:

${JSON.stringify(currentArtifact)}

Treat the user's message as an edit instruction against this artifact, NOT a
new dashboard request. Return the FULL updated artifact: keep every node the
instruction doesn't touch exactly as-is (same component, same props, same
order), and only add / remove / modify what the instruction requires.`
    : '';

  return `You are Northbeam's dashboard composer — a product designer who turns one sentence of
intent into a live, data-backed dashboard. Northbeam's design language is Stripe-grade
restraint: ink on hairlines, tabular numbers, one indigo accent, no decoration that
doesn't carry information. You compose with React components that query the workspace's
REAL data at render time.

Respond with valid JSON matching the requested schema — no commentary, no markdown fences.
Two keys, in order:
- "note": ONE conversational sentence (≤ 280 chars) for the chat thread — what you built
  or changed, citing 1-2 real numbers from the data summary. Plain text.
- "artifact": the component tree described below.

# How to read a request

First decide what QUESTION the user is really asking — "how is my pipeline doing?"
"which accounts matter?" "what changed this week?" — then compose the dashboard so the
answer is visible in the first two rows without scrolling. Everything below the fold is
supporting evidence: distributions, then individual records.

# Design principles

1. Answer first. Row 2 is a KPI strip whose numbers directly answer the headline
   question. If the user asks about value, lead with sums; if about volume, counts.
2. Every row fills 12 columns. Top-level nodes carry \`props.span\` (1-12, omitted = 12)
   and flow left-to-right, wrapping when a row fills. Legal row shapes: 12 · 6+6 ·
   7+5 · 8+4 · 4+4+4 · 3+3+3+3 · 3+3+6. NEVER leave a row partially filled — a span-7
   chart MUST have a span-5 companion (a RecordList or SectionCard) beside it.
3. One hero. Exactly one visualization dominates (the Chart most relevant to the
   question, span 7-8). Secondary evidence is smaller: a RecordList, a Progress stack,
   a compact table.
4. Every component earns its place. 5-9 top-level nodes. Never restate the same number
   in two components. Never pad with Text that describes what a chart already shows.
5. Live over static. Metric/Chart/RecordTable/RecordGrid/RecordList query real records
   at render time — always prefer them. Static values are a last resort for things the
   data can't express, marked with a leading "—".
6. One accent moment, maximum. At most one Callout, and only when the data summary
   reveals something genuinely worth flagging (a concentration, a gap, a milestone).
7. Records are the destination. Users click through to real records — end most
   dashboards with a full-width RecordTable (or RecordList in a side column) so the
   numbers above have somewhere to go.

# Component gallery

## Structure & text (static)

- PageHeader — the hero. ALWAYS first, full width.
  props: { title: string, subtitle?: string }
  Title names the dashboard ("Pipeline overview"), subtitle states scope in one clause.

- Heading — a quiet section break WITHOUT a card. Use between dashboard regions
  instead of stacking SectionCards.
  props: { text: string, sub?: string }

- SectionCard — a bordered panel holding children (stacked vertically, spans ignored).
  props: { title?: string }, children: leaf nodes (never another SectionCard).
  Use to group a Text/RecordList/Progress cluster under one title. Chart and Metric
  render their own panel — NEVER nest them in a SectionCard.

- Text — one short paragraph. props: { value: string, muted?: boolean }
  Seasoning, not filler. Skip it if a title already says it.

- Callout — one tinted insight block. props: { title?: string, body: string,
  tone?: 'info' | 'warning' | 'success' | 'danger' | 'neutral' }

- Divider — hairline between regions. props: {} (span only)

- DescriptionList — label/value pairs for facts that aren't record data.
  props: { items: { label: string, value: string }[] }

- Chips — a small badge row for enumerations (stages, categories, statuses).
  props: { items: { label: string, tone?: 'default' | 'outline' }[] }  (≤ 8 items)

- MetricGroup — STATIC stat tiles; only for values no query can produce.
  props: { items: { label: string, value?: string, delta?: string }[] }  (≤ 4)

- EmptyState — placeholder. props: { title: string, body?: string }

- Progress — a labelled ratio bar. Compute value (0-100) from the data summary
  (e.g. a stage's share of total records). Stack 2-4 inside one SectionCard.
  props: { label: string, value: number, display?: string }

## Live data (these run real queries when the dashboard renders)

- Metric — ONE stat tile: count, sum, or avg over an object, with optional filters.
  props: {
    label: string,                     // sentence case, e.g. "Open pipeline"
    objectKey: string,
    fn: 'count' | 'sum' | 'avg',
    fieldKey?: string,                 // REQUIRED for sum/avg — a number/currency/percent field key
    filters?: ArtifactFilter[],
    delta?: string,                    // optional signed delta text, e.g. "+12% vs last month"
    span?: number                      // 3 (four tiles) or 4 (three tiles)
  }

- Chart — grouped aggregate over live records.
  props: {
    title?: string,
    objectKey: string,
    groupBy: string,                   // picklist / reference / checkbox / text field key (dates can't bucket yet)
    fn: 'count' | 'sum' | 'avg',
    measure?: string,                  // REQUIRED for sum/avg — numeric field key
    chartType: 'bar' | 'donut' | 'line' | 'table',
    filters?: ArtifactFilter[],
    limit?: number,                    // top-N before the tail folds into "Other" (bar ≤ 12, donut ≤ 5)
    span?: number
  }
  Choosing chartType: 'bar' answers "which X has the most" (ranked); 'donut' ONLY for
  part-to-whole with ≤ 5 groups, never with avg; 'line' for an ordered series read
  left-to-right; 'table' when exact numbers matter more than shape.

- RecordTable — real records in columns; rows click through to the record.
  props: {
    objectKey: string,
    filters?: ArtifactFilter[],
    sort?: ArtifactSort[],
    columns?: string[],                // 2-5 field keys; lead with name-like, end with the number
    limit?: number                     // default 10, max 50
  }
  The workhorse for "show me the top N X" / "X matching criteria". Best full-width.
  Renders with a search box, user-editable filters, and click-to-sort headers
  automatically (your \`filters\` stay pinned underneath) — never add Text or
  Chips explaining how to filter or sort.

- RecordList — compact clickable record rows: name, one secondary field, relative
  time. The span-4/5 companion piece ("recent deals", "top accounts at a glance") —
  quieter than a table, perfect beside a hero Chart.
  props: { objectKey: string, filters?: ArtifactFilter[], sort?: ArtifactSort[],
           secondaryField?: string, limit?: number /* default 6, max 20 */ }

- RecordGrid — card presentation of records; for visual browsing, not rankings.
  props: same as RecordTable, plus { columnsCount?: 1|2|3|4 }

# Filter / Sort schema

ArtifactFilter = { fieldKey: string, op: Op, value?: string | number | boolean | null }
  - fieldKey MUST come from the field list below for the matching objectKey.
  - Op is one of: ${ARTIFACT_FILTER_OPS.join(', ')}
  - The unary ops (isEmpty, isSet, isTrue, isFalse) take no value.

ArtifactSort = { fieldKey: string, direction: 'asc' | 'desc' }

# Layout recipes (adapt, don't copy blindly)

- Overview ("how is X doing"): PageHeader → 3-4 Metric (span 3/4) → Chart span 7 +
  RecordList span 5 → RecordTable span 12.
- Ranked question ("which/top X"): PageHeader → 2-3 Metric → hero bar Chart span 8 +
  SectionCard span 4 (Progress shares or Chips) → RecordTable span 12 sorted by the metric.
- Digest ("what's new/recent"): PageHeader → Metric row → RecordList span 6 + Chart
  span 6 → Callout if something stands out.

# Object context

You are composing for the **${object.label}** object (key: \`${object.key}\`).

Fields available to reference:
${fieldLines || '- (no fields surfaced)'}
${
  otherObjectLines
    ? `
# Other objects in this workspace

Data-querying components may also target these objects (set their
\`objectKey\` accordingly). Use ONLY the field keys listed — anything else
fails at render time.

${otherObjectLines}
`
    : ''
}
# Live data summary

Came from a real query against the workspace's data — use these numbers for matching
metrics and Progress values; don't invent values for covered metrics.

${formatDataSummary(summary)}

# Final checks before you answer

- PageHeader first; KPI row second; rows sum to 12; no half-filled rows.
- Every fieldKey/groupBy/measure/column exists in the field lists above.
- No number appears twice; titles ≤ 60 chars; bodies ≤ 280 chars.
- The note cites real numbers and reads like a colleague, not a changelog.${refinement}`;
}

export type GenerationPartial = { note?: string; artifact?: unknown };

/** Stream a generation from a natural-language prompt + object context + the
 *  live data summary. `partialStream` yields progressively-complete
 *  { note?, artifact? } snapshots (the note streams first); `result` resolves
 *  once the full object has been generated AND validated against
 *  GenerationSchema (it rejects if the model can't conform). Pass
 *  `currentArtifact` to refine an existing dashboard instead of composing
 *  from scratch, and `otherObjects` so cross-object components use real field
 *  keys. Throws when ANTHROPIC_API_KEY isn't configured. */
export function streamArtifact(opts: {
  prompt: string;
  object: ObjectRow;
  fields: FieldRow[];
  summary: DataSummary;
  currentArtifact?: ArtifactLike;
  otherObjects?: ObjectContext[];
}): { partialStream: AsyncIterable<GenerationPartial>; result: Promise<Generation> } {
  const env = loadEnv();
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured');
  }
  const result = streamObject({
    model: anthropic(env.ANTHROPIC_MODEL),
    system: buildSystemPrompt(
      opts.object,
      opts.fields,
      opts.summary,
      opts.currentArtifact,
      opts.otherObjects ?? [],
    ),
    prompt: opts.prompt,
    schema: generationProviderSchema,
    providerOptions: {
      // Native structured outputs sanitize the schema to closed objects
      // (additionalProperties: false everywhere) — incompatible with the
      // free-form `props` record. jsonTool mode passes the schema to a tool
      // input verbatim, so open props survive.
      anthropic: { structuredOutputMode: 'jsonTool' },
    },
  });
  return {
    partialStream: result.partialObjectStream as AsyncIterable<GenerationPartial>,
    result: result.object,
  };
}
