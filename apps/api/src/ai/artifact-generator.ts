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
  ARTIFACT_CHART_TYPES,
  ARTIFACT_DATE_GRAINS,
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
  /** Month-grain record counts over the first date field — evidence for
   *  whether a time-series chart has enough buckets to be interesting. */
  dateSeries: {
    fieldKey: string;
    fieldLabel: string;
    points: { bucket: string; count: number }[];
  } | null;
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
  if (summary.dateSeries && summary.dateSeries.points.length > 0) {
    const pts = summary.dateSeries.points.map((p) => `${p.bucket} (${p.count})`).join(', ');
    parts.push(
      `- ${summary.dateSeries.fieldLabel} by month (fieldKey \`${summary.dateSeries.fieldKey}\`): ${pts}`,
    );
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
 *  without an API call. Pass `object: null` for WORKSPACE scope (the user's
 *  Home page): no single target object, every live node names its own
 *  objectKey, and the Greeting/AttentionQueue home nodes come into play. */
export function buildSystemPrompt(
  object: ObjectRow | null,
  fields: FieldRow[],
  summary: DataSummary | null,
  currentArtifact?: ArtifactLike,
  otherObjects: ObjectContext[] = [],
): string {
  const fieldLines = fieldLinesFor(fields, 40);

  const otherObjectLines = otherObjects
    .filter((o) => o.object.key !== object?.key)
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

- PageHeader — the hero. ALWAYS first on object dashboards, full width.
  props: { title: string, subtitle?: string }
  Title names the dashboard ("Pipeline overview"), subtitle states scope in one clause.

- Greeting — the Home-page hero: "Good afternoon, <user>" plus today's date, resolved
  at render time. WORKSPACE (home) dashboards only — it replaces PageHeader there;
  never use it on an object dashboard.
  props: { subtitle?: string }

- AttentionQueue — the "needs attention" work queue: the user's overdue and due-soon
  activities plus deals closing inside two weeks, each row with a one-click action.
  Live and self-fetching — no query props to configure. WORKSPACE (home) dashboards
  only; renders best full width, directly under the greeting/KPI rows.
  props: {}

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

- Metric — ONE stat tile: an aggregate over an object, with optional filters.
  props: {
    label: string,                     // sentence case, e.g. "Open pipeline"
    objectKey: string,
    fn: 'count' | 'sum' | 'avg' | 'min' | 'max',
    fieldKey?: string,                 // REQUIRED unless fn is count — a number/currency/percent field key
    filters?: ArtifactFilter[],
    delta?: string,                    // optional signed delta text, e.g. "+12% vs last month"
    span?: number                      // 3 (four tiles) or 4 (three tiles)
  }

- Chart — grouped aggregate over live records (one native GROUP BY, up to two levels).
  props: {
    title?: string,
    objectKey: string,
    groupBy: string,                   // picklist / reference / checkbox / text / date / datetime field key
    dateGrain?: ${ARTIFACT_DATE_GRAINS.map((g) => `'${g}'`).join(' | ')},  // ONLY when groupBy is a date/datetime field; default 'month'
    groupBy2?: string,                 // second dimension — stacked bars, multi-series lines/areas, matrix tables
    groupBy2Grain?: same as dateGrain, // ONLY when groupBy2 is a date/datetime field
    fn: 'count' | 'sum' | 'avg' | 'min' | 'max',
    measure?: string,                  // REQUIRED unless fn is count — numeric field key
    chartType: ${ARTIFACT_CHART_TYPES.map((t) => `'${t}'`).join(' | ')},
    stacked?: boolean,                 // bar/area with groupBy2: stack the series instead of grouping
    filters?: ArtifactFilter[],
    limit?: number,                    // top-N before the tail folds into "Other" (bar ≤ 12, donut ≤ 5)
    span?: number
  }
  Choosing chartType:
  - 'bar' answers "which X has the most" (ranked). Add groupBy2 + stacked: true only
    when the composition WITHIN each bar matters (pipeline by stage, split by owner).
  - 'line' is a value moving over ordered buckets — the default for a date groupBy.
  - 'area' is line with weight: cumulative/volume feel; count/sum over time only,
    never avg/min/max (a filled area implies additive magnitude).
  - 'donut' ONLY for part-to-whole with ≤ 5 groups, never with avg/min/max.
  - 'scatter' plots one point per group: x = record count, y = the measure. Needs a
    numeric measure (never fn: count). Use it to spot outlier groups ("many small
    deals vs a few large").
  - 'funnel' is ordered stage progression: groupBy a stage-like picklist, fn count or
    sum; stages render in picklist order.
  - 'table' when exact numbers matter more than shape.
  - 'matrix' is a two-dimension pivot: groupBy = rows, groupBy2 = columns (REQUIRES
    groupBy2, keep it a low-cardinality field — ≤ ~8 columns). The answer to "X by Y"
    questions when both dimensions matter equally.
  Dates: any date/datetime field can be a groupBy — set dateGrain to match the
  question's horizon (recent weeks → 'day'/'week', this year → 'month', multi-year →
  'quarter'/'year'). Time-series charts (line/area over a date) must NOT set limit —
  buckets are chronological, and the tail must not fold into "Other".

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
- Trend ("how is X changing / over time"): PageHeader → Metric row → hero line/area
  Chart span 8 grouped by a date field (dateGrain to fit the horizon) + RecordList
  span 4 → RecordTable span 12. Add groupBy2 to the hero when the split matters
  (revenue by month, stacked by stage). For "X by Y" with two equal dimensions,
  a matrix Chart is the hero instead.

${
  object
    ? `# Object context

You are composing for the **${object.label}** object (key: \`${object.key}\`).

Fields available to reference:
${fieldLines || '- (no fields surfaced)'}
`
    : `# Workspace context (HOME page)

You are composing the user's HOME page — a workspace-level dashboard that spans all
objects. Open with Greeting (not PageHeader), lead with the numbers that matter across
the workspace (open pipeline, record counts), put AttentionQueue where the user will
act on it, and close with recent records (RecordList over the activity object works
well). EVERY live node (Metric/Chart/RecordTable/RecordGrid/RecordList) must name its
objectKey from the objects listed below.
`
}${
  otherObjectLines
    ? `
# ${object ? 'Other objects in this workspace' : 'Objects in this workspace'}

Data-querying components may ${object ? 'also ' : ''}target these objects (set their
\`objectKey\` accordingly). Use ONLY the field keys listed — anything else
fails at render time.

${otherObjectLines}
`
    : ''
}${
  summary
    ? `
# Live data summary

Came from a real query against the workspace's data — use these numbers for matching
metrics and Progress values; don't invent values for covered metrics.

${formatDataSummary(summary)}
`
    : ''
}

# Final checks before you answer

- PageHeader first; KPI row second; rows sum to 12; no half-filled rows.
- Every fieldKey/groupBy/measure/column exists in the field lists above.
- dateGrain only when the groupBy field is date/datetime; groupBy2 only on charts
  whose type can draw a second dimension (stacked bar, line, area, matrix).
- scatter and every sum/avg/min/max carry a numeric measure; matrix carries groupBy2.
- Time-series (line/area over a date groupBy) never set limit.
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
  /** Null = workspace scope (the Home page): no single target object. */
  object: ObjectRow | null;
  fields: FieldRow[];
  summary: DataSummary | null;
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
