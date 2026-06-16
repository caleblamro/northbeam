// Artifact generator. Takes a natural-language prompt + the object context
// and asks Claude to produce a structured ArtifactNode tree the web side
// renders via AIRenderer's whitelist (apps/web/src/components/northbeam/
// views/ai-renderer.tsx).
//
// Uses Vercel AI SDK's `generateObject` so the model is forced into the
// schema-validated JSON shape — bad generations get rejected at the SDK
// boundary instead of surfacing as runtime render failures.

import { anthropic } from '@ai-sdk/anthropic';
import { loadEnv } from '@northbeam/config';
import type { FieldRow, ObjectRow } from '@northbeam/db';
import { generateObject } from 'ai';
import { z } from 'zod';

/** Mirrors the v1 artifact format AIRenderer walks. Keep this list in sync
 *  with ARTIFACT_COMPONENTS in ai-renderer.tsx — anything outside the
 *  whitelist surfaces as an "Unsupported component" placeholder. */
const ALLOWED_COMPONENTS = [
  'PageHeader',
  'SectionCard',
  'MetricGroup',
  'DescriptionList',
  'EmptyState',
  'Text',
] as const;

const ArtifactNodeSchema: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    component: z.enum(ALLOWED_COMPONENTS),
    props: z.record(z.string(), z.unknown()).optional(),
    children: z.array(ArtifactNodeSchema).optional(),
  }),
);

const ArtifactSchema = z.object({
  version: z.literal('1'),
  components: z.array(ArtifactNodeSchema).min(1).max(20),
});

export type Artifact = z.infer<typeof ArtifactSchema>;

function buildSystemPrompt(object: ObjectRow, fields: FieldRow[]): string {
  const fieldLines = fields
    .filter((f) => !f.isSystem || ['name'].includes(f.key))
    .slice(0, 40)
    .map((f) => `- ${f.label} (${f.key}, type: ${f.type})`)
    .join('\n');

  return `You are generating a structured UI artifact for a CRM view inside Northbeam.

The artifact will be rendered as React components on a user's dashboard.
You must respond with valid JSON matching the requested schema — no commentary, no markdown fences.

# Available components (use ONLY these — anything else is dropped)

- PageHeader: a hero section at the top.
  props: { title: string, subtitle?: string }
  no children.

- SectionCard: a bordered panel with an optional header.
  props: { title?: string }
  children: any of the above components.

- MetricGroup: a row of stat tiles.
  props: { items: { label: string, value?: string, delta?: string }[] }
  no children. Use small "items" arrays (≤ 4) so the row fits.

- DescriptionList: a label / value list.
  props: { items: { label: string, value: string }[] }
  no children.

- EmptyState: a placeholder block for an empty / not-yet-built section.
  props: { title: string, body?: string }
  no children.

- Text: a plain paragraph.
  props: { value: string, muted?: boolean }
  no children.

# Object context

You are generating a view for the **${object.label}** object (key: \`${object.key}\`).
Available fields the user can reference in their prompt:
${fieldLines || '- (no fields surfaced)'}

# Output rules

- Top-level "components" array: 1-6 items, in vertical reading order.
- Wrap content in SectionCard sections when the artifact has more than ~2 nodes.
- Use realistic placeholder labels / values when the user's prompt asks for data —
  prefix placeholder values with "—" or note "Sample value" so the user knows it's
  not live data. The Northbeam team will wire data-source bindings in a follow-up.
- Never invent components that aren't in the whitelist.
- Keep titles ≤ 60 chars, bodies ≤ 280 chars.`;
}

/** Generate an artifact from a natural-language prompt + object context.
 *  Throws when ANTHROPIC_API_KEY isn't configured (the caller should map
 *  that to a friendly tRPC error). */
export async function generateArtifact(opts: {
  prompt: string;
  object: ObjectRow;
  fields: FieldRow[];
}): Promise<Artifact> {
  const env = loadEnv();
  if (!env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is not configured');
  }
  const result = await generateObject({
    model: anthropic(env.ANTHROPIC_MODEL),
    system: buildSystemPrompt(opts.object, opts.fields),
    prompt: opts.prompt,
    schema: ArtifactSchema,
  });
  return result.object;
}
