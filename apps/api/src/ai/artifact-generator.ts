// Artifact generator. Takes a natural-language prompt + the object context
// and asks Claude to produce a structured ArtifactNode tree the ⌘K palette
// renders inline. Schema is intentionally NON-recursive — Vercel AI SDK's
// JSON-schema converter can't represent z.lazy self-references, so we
// flatten to two shapes:
//
//   - LeafNode: a single component with no children
//   - SectionNode: a SectionCard that wraps an array of LeafNodes
//
// Top-level is an array of LeafNode | SectionNode. That covers every layout
// we want without recursion.
//
// The renderer (ai-generate-dialog.tsx) walks the same shape; both sides
// agree on the whitelist.

import { anthropic } from '@ai-sdk/anthropic';
import { loadEnv } from '@northbeam/config';
import type { FieldRow, ObjectRow } from '@northbeam/db';
import { generateObject } from 'ai';
import { z } from 'zod';

const LEAF_COMPONENTS = [
  'PageHeader',
  'MetricGroup',
  'DescriptionList',
  'EmptyState',
  'Text',
] as const;

const LeafNodeSchema = z.object({
  component: z.enum(LEAF_COMPONENTS),
  props: z.record(z.string(), z.unknown()).optional(),
});

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

// The model also produces a saved-view suggestion that captures the same
// intent in a form a regular list view can hold: a label, filters, sort,
// and the columns the user should see. The dialog's "Save as view" button
// turns this into a real `view` row; the artifact itself is never persisted.
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

const SuggestedFilterSchema = z.object({
  fieldKey: z.string().min(1),
  op: z.enum(FILTER_OPS),
  value: z.union([z.string(), z.number(), z.boolean(), z.null()]).optional(),
});

const SuggestedSortSchema = z.object({
  fieldKey: z.string().min(1),
  direction: z.enum(['asc', 'desc']),
});

const ViewSuggestionSchema = z.object({
  label: z.string().min(1).max(80),
  filters: z.array(SuggestedFilterSchema).max(10).default([]),
  sort: z.array(SuggestedSortSchema).max(3).default([]),
  columns: z.array(z.string()).max(8).default([]),
});

const ArtifactSchema = z.object({
  version: z.literal('1'),
  components: z.array(ArtifactNodeSchema).min(1).max(20),
  view: ViewSuggestionSchema,
});

export type Artifact = z.infer<typeof ArtifactSchema>;
export type ArtifactLeafNode = z.infer<typeof LeafNodeSchema>;
export type ArtifactSectionNode = z.infer<typeof SectionNodeSchema>;
export type ArtifactNode = z.infer<typeof ArtifactNodeSchema>;
export type ViewSuggestion = z.infer<typeof ViewSuggestionSchema>;

/** Compact summary of the data that lives in the target object. Computed
 *  by the API before the LLM call and baked into the system prompt so the
 *  artifact's metric values reflect reality (not Claude's training-set
 *  guesses). Shape is intentionally narrow — `recordCount`, a few
 *  group-by counts, optional top-N. */
export type DataSummary = {
  recordCount: number;
  /** Group-by counts on the first one or two picklist fields. Empty when
   *  the object has no picklists. */
  picklistCounts: { fieldKey: string; fieldLabel: string; counts: { value: string; count: number }[] }[];
  /** Sum + average for the first currency / number field, if any. */
  numericSummary: { fieldKey: string; fieldLabel: string; sum: number; avg: number } | null;
};

function formatDataSummary(summary: DataSummary): string {
  const parts: string[] = [];
  parts.push(`- Total records: ${summary.recordCount.toLocaleString()}`);
  for (const p of summary.picklistCounts) {
    const top = p.counts.slice(0, 6).map((c) => `${c.value} (${c.count})`).join(', ');
    parts.push(`- ${p.fieldLabel} breakdown: ${top || 'no values'}`);
  }
  if (summary.numericSummary) {
    const { fieldLabel, sum, avg } = summary.numericSummary;
    parts.push(
      `- ${fieldLabel}: total ${sum.toLocaleString()}, average ${avg.toLocaleString()}`,
    );
  }
  return parts.join('\n');
}

function buildSystemPrompt(
  object: ObjectRow,
  fields: FieldRow[],
  summary: DataSummary,
): string {
  const fieldLines = fields
    .filter((f) => !f.isSystem || f.key === 'name')
    .slice(0, 40)
    .map((f) => `- ${f.label} (${f.key}, type: ${f.type})`)
    .join('\n');

  return `You are generating a structured UI artifact for a CRM dashboard inside Northbeam.

The artifact will be rendered as React components in a dialog.
You must respond with valid JSON matching the requested schema — no commentary, no markdown fences.

# Available components (use ONLY these — anything else is dropped)

- PageHeader: a hero section at the top.
  props: { title: string, subtitle?: string }

- SectionCard: a bordered panel that holds children.
  props: { title?: string }
  children: array of LeafNodes (PageHeader / MetricGroup / DescriptionList / EmptyState / Text).
  Nest at most one level — children cannot be SectionCards.

- MetricGroup: a row of stat tiles.
  props: { items: { label: string, value?: string, delta?: string }[] }
  Use small arrays (≤ 4) so the row fits.

- DescriptionList: a label / value list.
  props: { items: { label: string, value: string }[] }

- EmptyState: a placeholder block.
  props: { title: string, body?: string }

- Text: a plain paragraph.
  props: { value: string, muted?: boolean }

# Object context

You are generating for the **${object.label}** object (key: \`${object.key}\`).

Fields available to reference:
${fieldLines || '- (no fields surfaced)'}

# Live data summary

The following came from a real query against the workspace's data — use
these numbers (don't invent values for the same metrics):

${formatDataSummary(summary)}

# Output rules

- Top-level "components" array: 1-6 items in reading order.
- Wrap multi-block content in SectionCards.
- Use the live numbers above wherever the user's prompt asks for those
  metrics. For anything NOT in the summary, you may either (a) note that
  the value isn't tracked, or (b) write a clearly-marked sample value
  prefixed with "—" so it's obvious it isn't live.
- Keep titles ≤ 60 chars, bodies ≤ 280 chars.

# View suggestion (always included)

In addition to the artifact, every response must include a "view" object — the
equivalent saved-view configuration the user could pin if they liked your
output. The user will see the artifact in the preview and may click "Save as
view"; the filters / sort / columns you propose drive the saved list view.

- "label": short name (≤ 60 chars) summarising what the saved list shows.
- "filters": array of { fieldKey, op, value? }.
  - fieldKey MUST come from the field list above.
  - Valid ops: ${FILTER_OPS.join(', ')}.
  - isEmpty / isSet / isTrue / isFalse take no value; everything else
    requires a value.
- "sort": array of { fieldKey, direction } — 0–2 entries.
- "columns": array of field keys for the saved list's columns, in order.
  4–6 entries.

The view should reflect the SAME intent as the artifact. If the prompt is
"top deals at risk", the artifact might show metric tiles for at-risk
counts, and the view should pre-filter to that stage / probability range
and sort by amount descending.`;
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
