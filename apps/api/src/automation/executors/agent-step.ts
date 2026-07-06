// agent_step — "pass to agent": a bounded, HEADLESS tool-use loop (the
// composer's research pattern without the approval channel — there is no user
// mid-run, so the node's explicit toolIds allowlist IS the consent, granted
// by the flow author behind 'automation.manage'). Tools execute in system
// context like every other executor: reads skip per-user ACL, and every write
// goes through the flow record pipeline (validation rules enforced, audit
// meta.source 'automation', child-flow dispatch at depth + 1) — an agent can
// never do what a flow couldn't. Inert without ANTHROPIC_API_KEY; shares the
// per-org daily AI budget with ai_step. Dry-runs never call the model.

import { anthropic } from '@ai-sdk/anthropic';
import { loadEnv } from '@northbeam/config';
import { type FlowNodeOfType, interpolate } from '@northbeam/core';
import {
  type DbExecutor,
  aggregateRecords,
  getObjectByKey,
  getRecord,
  listAiAgents,
  listRecords,
} from '@northbeam/db';
import { type Tool, generateText, stepCountIs, tool } from 'ai';
import { z } from 'zod';
import { resolveReportSpec } from '../../trpc/report-config.js';
import { FilterEntrySchema } from '../../trpc/schemas.js';
import type { RunContext } from '../context.js';
import { deleteRecordViaPipeline, writeRecordViaPipeline } from '../record-service.js';
import { assignOutput } from './ai-step.js';
import { pipelineErrorMessage } from './create-record.js';
import { type ExecResult, type ExecServices, execScope, fail, ok, preview } from './types.js';

const MAX_OUTPUT_TOKENS = 1500;
const CALLS_PER_ORG_PER_DAY = 200; // shared window key with ai_step
const RESULT_CHAR_CAP = 2_000;
const RECORD_CONTEXT_CAP = 2_000;
const REPORT_CHAR_CAP = 4_000;

type TraceEntry = { tool: string; input: string; result: string; error?: boolean };

function compact(value: unknown): string {
  const s = JSON.stringify(value) ?? '';
  return s.length > RESULT_CHAR_CAP ? `${s.slice(0, RESULT_CHAR_CAP)}…(truncated)` : s;
}

/** Build the headless AI SDK tool set for the allowlisted ids. Each call runs
 *  in its own RLS-scoped tx (services.tx); tool errors return as text so the
 *  loop continues — a broken query shouldn't kill the mission. */
function buildAgentTools(
  toolIds: readonly string[],
  services: ExecServices,
  trace: TraceEntry[],
): Record<string, Tool> {
  const traced =
    (name: string, run: (input: unknown) => Promise<unknown>) =>
    async (input: unknown): Promise<string> => {
      try {
        const result = await run(input);
        const summary = compact(result);
        trace.push({ tool: name, input: preview(input), result: preview(summary) });
        return summary;
      } catch (err) {
        const message = pipelineErrorMessage(err);
        trace.push({ tool: name, input: preview(input), result: message, error: true });
        return `Tool error: ${message}. Adjust your approach or report the blocker.`;
      }
    };

  const requireObject = async (tx: DbExecutor, key: string) => {
    const owf = await getObjectByKey(tx, services.orgId, key);
    if (!owf) throw new Error(`object '${key}' not found`);
    return owf;
  };

  const pipelineActor = (tx: DbExecutor) => ({
    tx,
    orgId: services.orgId,
    now: services.now(),
    depth: services.depth + 1,
    triggeredByRunId: services.runId,
    flowId: services.flow.id,
  });

  const tools: Record<string, Tool> = {};

  if (toolIds.includes('search_records')) {
    tools.search_records = tool({
      description:
        'List records of one object with filters and text search. Returns id, name, and field values.',
      inputSchema: z.object({
        objectKey: z.string(),
        search: z.string().optional(),
        filters: z.array(FilterEntrySchema).default([]),
        limit: z.number().int().min(1).max(20).default(10),
      }),
      execute: traced('search_records', async (raw) => {
        const input = raw as {
          objectKey: string;
          search?: string;
          filters: never[];
          limit: number;
        };
        return services.tx(async (tx) => {
          const owf = await requireObject(tx, input.objectKey);
          const rows = await listRecords(tx, {
            orgId: services.orgId,
            object: owf.object,
            fields: owf.fields,
            search: input.search,
            filters: input.filters,
            sort: [],
            limit: input.limit,
          });
          return rows.map((r) => ({ id: r.id, name: r.name, ...r.data }));
        });
      }),
    });
  }

  if (toolIds.includes('aggregate_records')) {
    tools.aggregate_records = tool({
      description:
        'Group-by aggregation over one object (count/sum/avg/min/max, optional date grain and second grouping).',
      inputSchema: z.object({
        objectKey: z.string(),
        groupBy: z.string().nullish(),
        groupByGrain: z.enum(['day', 'week', 'month', 'quarter', 'year']).optional(),
        groupBy2: z.string().nullish(),
        measure: z.object({
          agg: z.enum(['count', 'sum', 'avg', 'min', 'max']),
          fieldKey: z.string().optional(),
        }),
        filters: z.array(FilterEntrySchema).default([]),
        limit: z.number().int().min(1).max(50).default(25),
      }),
      execute: traced('aggregate_records', async (raw) => {
        const input = raw as {
          objectKey: string;
          groupBy?: string | null;
          groupByGrain?: 'day' | 'week' | 'month' | 'quarter' | 'year';
          groupBy2?: string | null;
          measure: { agg: 'count' | 'sum' | 'avg' | 'min' | 'max'; fieldKey?: string };
          filters: never[];
          limit: number;
        };
        return services.tx(async (tx) => {
          const owf = await requireObject(tx, input.objectKey);
          const spec = resolveReportSpec(owf.fields, {
            groupBy: input.groupBy,
            groupByGrain: input.groupByGrain,
            groupBy2: input.groupBy2,
            measure: input.measure,
          });
          if (!spec.ok) throw new Error(spec.message);
          return aggregateRecords(tx, {
            orgId: services.orgId,
            object: owf.object,
            fields: owf.fields,
            groups: spec.value.groups,
            measure: { fn: input.measure.agg, field: spec.value.measureField },
            filters: input.filters,
            limit: input.limit,
          });
        });
      }),
    });
  }

  if (toolIds.includes('get_record')) {
    tools.get_record = tool({
      description: 'Fetch one record by id with all its field values.',
      inputSchema: z.object({ objectKey: z.string(), id: z.string() }),
      execute: traced('get_record', async (raw) => {
        const input = raw as { objectKey: string; id: string };
        return services.tx(async (tx) => {
          const owf = await requireObject(tx, input.objectKey);
          const row = await getRecord(tx, {
            orgId: services.orgId,
            object: owf.object,
            fields: owf.fields,
            id: input.id,
          });
          if (!row) throw new Error(`record '${input.id}' not found on '${input.objectKey}'`);
          return { id: row.id, name: row.name, ownerId: row.ownerId, ...row.data };
        });
      }),
    });
  }

  if (toolIds.includes('inspect_metadata')) {
    tools.inspect_metadata = tool({
      description:
        'Field definitions for an object — keys, types, required flags, picklist options.',
      inputSchema: z.object({ objectKey: z.string() }),
      execute: traced('inspect_metadata', async (raw) => {
        const input = raw as { objectKey: string };
        return services.tx(async (tx) => {
          const owf = await requireObject(tx, input.objectKey);
          return owf.fields.map((f) => ({
            key: f.key,
            label: f.label,
            type: f.type,
            required: f.required,
          }));
        });
      }),
    });
  }

  if (toolIds.includes('create_record')) {
    tools.create_record = tool({
      description:
        'Create one record. Full validation applies; the write is audited and may trigger other flows.',
      inputSchema: z.object({
        objectKey: z.string(),
        fields: z.record(z.string(), z.unknown()),
      }),
      execute: traced('create_record', async (raw) => {
        const input = raw as { objectKey: string; fields: Record<string, unknown> };
        const result = await services.tx((tx) =>
          writeRecordViaPipeline(pipelineActor(tx), {
            objectKey: input.objectKey,
            fields: input.fields,
            ownerId: null,
          }),
        );
        await result.enqueue();
        return { created: result.id, objectKey: input.objectKey };
      }),
    });
  }

  if (toolIds.includes('update_record')) {
    tools.update_record = tool({
      description:
        'Patch fields on one existing record by id. Validation runs on the merged result.',
      inputSchema: z.object({
        objectKey: z.string(),
        id: z.string(),
        fields: z.record(z.string(), z.unknown()),
      }),
      execute: traced('update_record', async (raw) => {
        const input = raw as { objectKey: string; id: string; fields: Record<string, unknown> };
        const result = await services.tx((tx) =>
          writeRecordViaPipeline(pipelineActor(tx), {
            objectKey: input.objectKey,
            recordId: input.id,
            fields: input.fields,
          }),
        );
        await result.enqueue();
        return { updated: result.id, changedKeys: result.changedKeys };
      }),
    });
  }

  if (toolIds.includes('delete_record')) {
    tools.delete_record = tool({
      description: 'Permanently delete one record by id. Irreversible.',
      inputSchema: z.object({ objectKey: z.string(), id: z.string() }),
      execute: traced('delete_record', async (raw) => {
        const input = raw as { objectKey: string; id: string };
        const result = await services.tx((tx) =>
          deleteRecordViaPipeline(pipelineActor(tx), {
            objectKey: input.objectKey,
            recordId: input.id,
          }),
        );
        await result.enqueue();
        return { deleted: input.id };
      }),
    });
  }

  return tools;
}

export async function executeAgentStep(
  node: FlowNodeOfType<'agent_step'>,
  ctx: RunContext,
  services: ExecServices,
): Promise<ExecResult> {
  const cfg = node.config;
  const scopes = execScope(ctx, services);
  const mission = String(interpolate(cfg.mission, scopes) ?? '').slice(0, 4000);

  if (services.dryRun) {
    const target = cfg.output ? assignOutput(ctx, cfg.output, '(dry-run)') : null;
    return ok({
      simulated: true,
      agentKey: cfg.agentKey ?? null,
      toolIds: cfg.toolIds,
      output: target,
    });
  }

  const env = loadEnv();
  if (!env.ANTHROPIC_API_KEY) return fail('ai_not_configured');

  const { redis } = await import('../../queue/connection.js');
  const { fixedWindow } = await import('../../lib/rate-limit.js');
  const day = services.now().toISOString().slice(0, 10);
  const window = await fixedWindow(
    redis(),
    `flow:ai:${services.orgId}:${day}`,
    CALLS_PER_ORG_PER_DAY,
    86_400,
  );
  if (!window.ok) return fail(`org AI budget exceeded (${CALLS_PER_ORG_PER_DAY}/day)`);

  // Preset narrows the step: its systemPrompt prepends, its toolIds (when
  // non-null) intersect the node's allowlist.
  let systemPrefix = '';
  let toolIds: readonly string[] = cfg.toolIds;
  if (cfg.agentKey) {
    const agents = await services.tx((tx) => listAiAgents(tx, services.orgId));
    const preset = agents.find((a) => a.key === cfg.agentKey);
    if (!preset) return fail(`agent preset '${cfg.agentKey}' not found`);
    systemPrefix = preset.systemPrompt ? `${preset.systemPrompt.trim()}\n\n` : '';
    if (preset.toolIds !== null) {
      toolIds = cfg.toolIds.filter((id) => (preset.toolIds as string[]).includes(id));
    }
  }
  if (toolIds.length === 0) return fail('no tools remain after the agent preset intersection');

  const trace: TraceEntry[] = [];
  const tools = buildAgentTools(toolIds, services, trace);
  const maxToolCalls = Math.min(Math.max(cfg.maxToolCalls ?? 5, 1), 10);
  const recordContext = ctx.record
    ? `\n\nTriggering record (id ${services.recordId ?? 'n/a'}):\n${compact(ctx.record).slice(0, RECORD_CONTEXT_CAP)}`
    : '';

  try {
    const result = await generateText({
      model: anthropic(env.ANTHROPIC_MODEL),
      system: `${systemPrefix}You are an automation agent inside Northbeam (a CRM), executing one step of the flow "${services.flow.name}". You have UP TO ${maxToolCalls} tool calls to complete the mission below, then you MUST reply with a short report (≤ 12 lines): what you found, what you changed (record ids, old → new where known), and anything that blocked you. Writes are real and audited — make them only when the mission calls for them, never speculatively. If the mission is ambiguous, do the safe read-only part and report the ambiguity.${recordContext}`,
      prompt: mission,
      tools,
      stopWhen: stepCountIs(maxToolCalls + 1),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    });
    const report = result.text.trim().slice(0, REPORT_CHAR_CAP);
    const target = cfg.output ? assignOutput(ctx, cfg.output, report) : null;
    return ok({
      agentKey: cfg.agentKey ?? null,
      toolCalls: trace.slice(0, 10),
      report: preview(report, 500),
      output: target,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return fail(`agent step failed: ${message}`, { toolCalls: trace.slice(0, 10) });
  }
}
