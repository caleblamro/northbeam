// ai_step — classify / extract / draft via the existing @ai-sdk/anthropic
// setup. Bounded: prompt ≤8k chars (schema), output ≤1000 tokens, per-org
// daily call budget on Redis. Without ANTHROPIC_API_KEY the node fails with
// the literal 'ai_not_configured' (the UI keys off it). Dry-runs never call
// the model — external spend is a side effect too.

import { anthropic } from '@ai-sdk/anthropic';
import { loadEnv } from '@northbeam/config';
import { type FlowAssignTarget, type FlowNodeOfType, interpolate } from '@northbeam/core';
import { generateObject, generateText } from 'ai';
import { fixedWindow } from '../../lib/rate-limit.js';
import { type RunContext, setVar } from '../context.js';
import { type ExecResult, type ExecServices, execScope, fail, ok, preview } from './types.js';

const MAX_OUTPUT_TOKENS = 1000;
const CALLS_PER_ORG_PER_DAY = 200;

/** Land an AI output on its target; returns the scope path for the summary.
 *  Shared with agent_step (same output contract). */
export function assignOutput(ctx: RunContext, target: FlowAssignTarget, value: unknown): string {
  if (target.scope === 'vars') {
    setVar(ctx, target.name, value);
    return `vars.${target.name}`;
  }
  if (!ctx.record) ctx.record = {};
  ctx.record[target.fieldKey] = value;
  return `record.${target.fieldKey}`;
}

export async function executeAiStep(
  node: FlowNodeOfType<'ai_step'>,
  ctx: RunContext,
  services: ExecServices,
): Promise<ExecResult> {
  const cfg = node.config;
  const scopes = execScope(ctx, services);
  const prompt = String(interpolate(cfg.prompt, scopes) ?? '').slice(0, 8000);

  if (services.dryRun) {
    const target = assignOutput(ctx, cfg.output, '(dry-run)');
    return ok({ simulated: true, mode: cfg.mode, output: target });
  }

  const env = loadEnv();
  if (!env.ANTHROPIC_API_KEY) return fail('ai_not_configured');

  const { redis } = await import('../../queue/connection.js');
  const day = services.now().toISOString().slice(0, 10);
  const window = await fixedWindow(
    redis(),
    `flow:ai:${services.orgId}:${day}`,
    CALLS_PER_ORG_PER_DAY,
    86_400,
  );
  if (!window.ok) {
    return fail(`org AI budget exceeded (${CALLS_PER_ORG_PER_DAY}/day)`);
  }

  const model = anthropic(env.ANTHROPIC_MODEL);
  try {
    let value: unknown;
    if (cfg.mode === 'classify') {
      const result = await generateObject({
        model,
        output: 'enum',
        enum: [...cfg.options],
        prompt,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      });
      value = result.object;
    } else if (cfg.mode === 'extract') {
      const result = await generateObject({
        model,
        output: 'no-schema',
        prompt: `${prompt}\n\nRespond with the extracted data as a single JSON value.`,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      });
      value = result.object;
    } else {
      const result = await generateText({ model, prompt, maxOutputTokens: MAX_OUTPUT_TOKENS });
      value = result.text;
    }
    const target = assignOutput(ctx, cfg.output, value);
    return ok({ mode: cfg.mode, output: target, preview: preview(value) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return fail(`ai step failed: ${message}`);
  }
}
