// The composer's research phase — a short agentic loop BEFORE artifact
// composition. The model gets the caller's permitted tools and a few steps to
// look at real data (distributions, magnitudes, outliers); its findings are
// appended to the compose prompt so the artifact is grounded in what it saw.
// With no tools available (admin turned them all off) the phase is skipped
// entirely and composition behaves exactly as before.

import { anthropic } from '@ai-sdk/anthropic';
import { loadEnv } from '@northbeam/config';
import type { ObjectWithFields } from '@northbeam/db';
import { type Tool, generateText, stepCountIs } from 'ai';

const MAX_STEPS = 4;
const FINDINGS_CHAR_CAP = 4_000;

function objectLines(objects: ObjectWithFields[]): string {
  return objects
    .map((o) => {
      const fields = o.fields
        .filter((f) => !f.isSystem || f.key === 'name')
        .slice(0, 25)
        .map((f) => `${f.key}(${f.type})`)
        .join(', ');
      return `- ${o.object.label} (objectKey: ${o.object.key}): ${fields}`;
    })
    .join('\n');
}

/** Run the research loop. Resolves with a findings block for the compose
 *  prompt ('' when the model needed no tools). Never throws — research is
 *  best-effort; composition proceeds without it on any failure. */
export async function runResearch(opts: {
  prompt: string;
  objects: ObjectWithFields[];
  tools: Record<string, Tool>;
}): Promise<string> {
  if (Object.keys(opts.tools).length === 0) return '';
  const env = loadEnv();
  try {
    const result = await generateText({
      model: anthropic(env.ANTHROPIC_MODEL),
      system: `You are the research pass for Northbeam's dashboard composer. The user asked:
"${opts.prompt}"

Before a dashboard is composed, you may make UP TO ${MAX_STEPS - 1} tool calls to look at
the workspace's REAL data — distributions, magnitudes, top values, whether a
comparison the user implied actually holds. Only call a tool when its answer
would change how the dashboard should be composed; skip straight to your
summary when the request is self-evident.

Objects available (use these exact objectKeys and field keys):
${objectLines(opts.objects)}

When done, reply with a SHORT findings summary (≤ 10 bullet lines): concrete
numbers, notable skews, and which fields/groupings look most informative.
No prose introductions. If a tool call was declined, work without it.`,
      prompt: 'Research the workspace as needed, then give your findings summary.',
      tools: opts.tools,
      stopWhen: stepCountIs(MAX_STEPS),
    });
    const text = result.text.trim();
    return text.length > FINDINGS_CHAR_CAP ? `${text.slice(0, FINDINGS_CHAR_CAP)}…` : text;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[ai.research] research pass failed — composing without it', err);
    return '';
  }
}
