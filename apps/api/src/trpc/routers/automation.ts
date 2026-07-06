// /trpc/automation — flow CRUD, validate/activate/pause lifecycle, testRun
// (synchronous dry-run), run history. Everything is admin-gated behind the
// 'automation.manage' permission.
//
// Validation layering: core's validateFlowGraph covers pure graph shape (the
// canvas mirrors it client-side); this router adds the metadata layer that
// needs the org — fields exist, formulas parse, template refs resolve,
// delete-trigger restrictions. Activate re-runs the full set and refuses on
// any error-severity issue, returning the issues instead of throwing so the
// editor can badge them.

import { randomBytes } from 'node:crypto';
import {
  type FlowCondition,
  FlowDraftGraphSchema,
  FlowDraftTriggerSchema,
  type FlowGraph,
  FlowGraphSchema,
  type FlowIssue,
  type FlowNode,
  type FlowTrigger,
  FlowTriggerSchema,
  collectTemplateRefs,
  validateFlowGraph,
} from '@northbeam/core';
import {
  type DbExecutor,
  type FieldRow,
  type FlowRow,
  cancelRun,
  createFlow,
  createFlowVersion,
  deleteFlow,
  getFlow,
  getFlowByKey,
  getObjectById,
  getObjectByKey,
  getRecord,
  getRunWithSteps,
  keyFromLabel,
  listAiAgents,
  listFlowVersions,
  listFlows,
  listRuns,
  schema,
  setActiveVersion,
  updateFlow,
  validateFormula,
  writeAuditEvent,
} from '@northbeam/db';
import { TRPCError } from '@trpc/server';
import { and, count, eq, gte, max } from 'drizzle-orm';
import { z } from 'zod';
import { type DryRunResult, dryRunGraph } from '../../automation/engine.js';
import { removeFlowSchedule, syncFlowSchedule } from '../../automation/schedules.js';
import { enqueueFlowRun } from '../../queue/flows.js';
import { permissionProcedure, router } from '../trpc.js';

const automationProcedure = permissionProcedure('automation.manage');

const FlowStatusSchema = z.enum(['draft', 'active', 'paused', 'needs_rebuild']);
const RunStatusSchema = z.enum([
  'queued',
  'running',
  'waiting',
  'completed',
  'failed',
  'cancelled',
]);

function serializeFlow(flow: FlowRow) {
  return {
    id: flow.id,
    key: flow.key,
    name: flow.name,
    description: flow.description,
    objectId: flow.objectId,
    status: flow.status,
    source: flow.source,
    salesforceId: flow.salesforceId,
    referenceMeta: flow.referenceMeta,
    draftTrigger: flow.draftTrigger,
    draftGraph: flow.draftGraph,
    activeVersionId: flow.activeVersionId,
    activeTriggerType: flow.activeTriggerType,
    webhookSecret: flow.webhookSecret,
    createdAt: flow.createdAt,
    updatedAt: flow.updatedAt,
  };
}

async function requireFlow(tx: DbExecutor, orgId: string, id: string): Promise<FlowRow> {
  const flow = await getFlow(tx, orgId, id);
  if (!flow) throw new TRPCError({ code: 'NOT_FOUND', message: 'flow not found' });
  return flow;
}

async function freeFlowKey(tx: DbExecutor, orgId: string, name: string): Promise<string> {
  const base = keyFromLabel(name) || 'flow';
  for (let i = 0; i < 50; i += 1) {
    const key = i === 0 ? base : `${base}_${i + 1}`;
    if (!(await getFlowByKey(tx, orgId, key))) return key;
  }
  return `${base}_${randomBytes(4).toString('hex')}`;
}

/* ── Metadata validation ─────────────────────────────────────────────────── */

type FieldSet = Map<string, FieldRow>;

function checkCondition(
  issues: FlowIssue[],
  nodeId: string,
  condition: FlowCondition,
  fields: FieldSet | null,
  label: string,
): void {
  if (condition.mode === 'formula') {
    const result = validateFormula(condition.formula);
    if (!result.ok) {
      issues.push({
        nodeId,
        severity: 'error',
        message: `${label}: formula error — ${result.message}`,
      });
    }
    return;
  }
  if (!fields) return;
  for (const filter of condition.filters) {
    if (!fields.has(filter.fieldKey)) {
      issues.push({
        nodeId,
        severity: 'error',
        message: `${label}: unknown field '${filter.fieldKey}'`,
      });
    }
  }
}

function checkTemplateRefs(
  issues: FlowIssue[],
  node: FlowNode,
  trigger: FlowTrigger | null,
  fields: FieldSet | null,
): void {
  for (const ref of collectTemplateRefs(node.config)) {
    if ((ref.scope === 'record' || ref.scope === 'oldRecord') && fields) {
      const head = ref.path[0];
      if (head !== undefined && !fields.has(head)) {
        issues.push({
          nodeId: node.id,
          severity: 'warning',
          message: `'{{${ref.raw}}}' references unknown field '${head}'`,
        });
      }
    }
    if (ref.scope === 'oldRecord') {
      const ok =
        trigger?.type === 'trigger_record' &&
        (trigger.config.event === 'updated' ||
          trigger.config.event === 'created_or_updated' ||
          trigger.config.event === 'deleted');
      if (!ok) {
        issues.push({
          nodeId: node.id,
          severity: 'warning',
          message: `'{{${ref.raw}}}' — oldRecord only exists on update/delete record triggers`,
        });
      }
    }
    if (ref.scope === 'webhook' && trigger?.type !== 'trigger_webhook') {
      issues.push({
        nodeId: node.id,
        severity: 'warning',
        message: `'{{${ref.raw}}}' — the webhook scope only exists on webhook-triggered flows`,
      });
    }
  }
}

function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const DELETE_FORBIDDEN_TARGET_NODES = new Set([
  'update_records',
  'delete_record',
  'assign_owner',
  'post_timeline',
]);

/** Metadata validation — everything that needs the org: fields exist,
 *  formulas parse, referenced objects exist, template refs resolve, and the
 *  delete-trigger restriction (the trigger record no longer exists). */
async function validateFlowMetadata(
  tx: DbExecutor,
  orgId: string,
  flow: FlowRow,
  trigger: FlowTrigger | null,
  graph: FlowGraph,
): Promise<FlowIssue[]> {
  const issues: FlowIssue[] = [...validateFlowGraph(graph).issues];

  let triggerFields: FieldSet | null = null;
  if (flow.objectId) {
    const owf = await getObjectById(tx, orgId, flow.objectId);
    if (!owf) issues.push({ severity: 'error', message: "the flow's object no longer exists" });
    else triggerFields = new Map(owf.fields.map((f) => [f.key, f]));
  }
  const objectCache = new Map<string, FieldSet | null>();
  const fieldsFor = async (objectKey: string): Promise<FieldSet | null> => {
    const cached = objectCache.get(objectKey);
    if (cached !== undefined) return cached;
    const owf = await getObjectByKey(tx, orgId, objectKey);
    const set = owf ? new Map(owf.fields.map((f) => [f.key, f])) : null;
    objectCache.set(objectKey, set);
    return set;
  };

  if (trigger?.type === 'trigger_record') {
    if (!flow.objectId) {
      issues.push({
        nodeId: trigger.id,
        severity: 'error',
        message: 'record-triggered flows must be attached to an object',
      });
    }
    if (trigger.config.entryCondition) {
      checkCondition(
        issues,
        trigger.id,
        trigger.config.entryCondition,
        triggerFields,
        'entry condition',
      );
    }
    for (const key of trigger.config.watchedFieldKeys ?? []) {
      if (triggerFields && !triggerFields.has(key)) {
        issues.push({
          nodeId: trigger.id,
          severity: 'error',
          message: `watched field '${key}' does not exist`,
        });
      }
    }
  }
  if (trigger?.type === 'trigger_scheduled') {
    if (!isValidTimezone(trigger.config.timezone)) {
      issues.push({
        nodeId: trigger.id,
        severity: 'error',
        message: `unknown timezone '${trigger.config.timezone}'`,
      });
    }
    if (trigger.config.entryCondition && !flow.objectId) {
      issues.push({
        nodeId: trigger.id,
        severity: 'warning',
        message: 'entry conditions on a scheduled flow only apply when the flow targets an object',
      });
    }
    if (trigger.config.entryCondition && flow.objectId) {
      checkCondition(
        issues,
        trigger.id,
        trigger.config.entryCondition,
        triggerFields,
        'entry condition',
      );
    }
  }

  const deleteTrigger = trigger?.type === 'trigger_record' && trigger.config.event === 'deleted';

  for (const node of graph.nodes) {
    checkTemplateRefs(issues, node, trigger, triggerFields);

    if (node.type === 'decision') {
      for (const outcome of node.config.outcomes) {
        checkCondition(
          issues,
          node.id,
          outcome.condition,
          triggerFields,
          `outcome '${outcome.label}'`,
        );
      }
    } else if (node.type === 'get_records') {
      const fields = await fieldsFor(node.config.objectKey);
      if (!fields) {
        issues.push({
          nodeId: node.id,
          severity: 'error',
          message: `object '${node.config.objectKey}' does not exist`,
        });
      } else {
        for (const filter of node.config.filters ?? []) {
          if (!fields.has(filter.fieldKey)) {
            issues.push({
              nodeId: node.id,
              severity: 'error',
              message: `unknown field '${filter.fieldKey}' on '${node.config.objectKey}'`,
            });
          }
        }
        if (node.config.sort && !fields.has(node.config.sort.fieldKey)) {
          issues.push({
            nodeId: node.id,
            severity: 'error',
            message: `unknown sort field '${node.config.sort.fieldKey}' on '${node.config.objectKey}'`,
          });
        }
      }
    } else if (node.type === 'create_record') {
      const fields = await fieldsFor(node.config.objectKey);
      if (!fields) {
        issues.push({
          nodeId: node.id,
          severity: 'error',
          message: `object '${node.config.objectKey}' does not exist`,
        });
      } else {
        for (const key of Object.keys(node.config.fields)) {
          if (!fields.has(key)) {
            issues.push({
              nodeId: node.id,
              severity: 'error',
              message: `unknown field '${key}' on '${node.config.objectKey}'`,
            });
          }
        }
        for (const field of fields.values()) {
          if (field.required && !(field.key in node.config.fields)) {
            issues.push({
              nodeId: node.id,
              severity: 'warning',
              message: `required field '${field.key}' is not set — the create will fail at run time`,
            });
          }
        }
      }
    } else if (node.type === 'update_records') {
      const target = node.config.target;
      let fields: FieldSet | null = null;
      if (target.kind === 'trigger_record') fields = triggerFields;
      if (target.kind === 'query') {
        fields = await fieldsFor(target.objectKey);
        if (!fields) {
          issues.push({
            nodeId: node.id,
            severity: 'error',
            message: `object '${target.objectKey}' does not exist`,
          });
        } else {
          for (const filter of target.filters) {
            if (!fields.has(filter.fieldKey)) {
              issues.push({
                nodeId: node.id,
                severity: 'error',
                message: `unknown filter field '${filter.fieldKey}' on '${target.objectKey}'`,
              });
            }
          }
        }
      }
      if (fields) {
        for (const key of Object.keys(node.config.fields)) {
          if (!fields.has(key)) {
            issues.push({
              nodeId: node.id,
              severity: 'error',
              message: `unknown field '${key}'`,
            });
          }
        }
      }
    } else if (node.type === 'wait' && node.config.kind === 'relative_to_field') {
      const field = triggerFields?.get(node.config.fieldKey);
      if (triggerFields && !field) {
        issues.push({
          nodeId: node.id,
          severity: 'error',
          message: `unknown field '${node.config.fieldKey}'`,
        });
      } else if (field && field.type !== 'date' && field.type !== 'datetime') {
        issues.push({
          nodeId: node.id,
          severity: 'error',
          message: `'${node.config.fieldKey}' is not a date/datetime field`,
        });
      }
    }

    if (deleteTrigger && DELETE_FORBIDDEN_TARGET_NODES.has(node.type)) {
      const target = (node.config as { target?: { kind?: string } }).target;
      if (target?.kind === 'trigger_record') {
        issues.push({
          nodeId: node.id,
          severity: 'error',
          message: 'the trigger record no longer exists on a delete trigger — pick another target',
        });
      }
    }
  }

  return issues;
}

/** Parse a flow's draft into typed trigger/graph, or explain why not. */
function parseDraft(
  flow: FlowRow,
): { trigger: FlowTrigger; graph: FlowGraph } | { issues: FlowIssue[] } {
  if (!flow.draftGraph || !flow.draftTrigger) {
    return { issues: [{ severity: 'error', message: 'flow has no draft graph to validate' }] };
  }
  const graph = FlowGraphSchema.safeParse(flow.draftGraph);
  const trigger = FlowTriggerSchema.safeParse(flow.draftTrigger);
  const issues: FlowIssue[] = [];
  if (!graph.success) {
    for (const issue of graph.error.issues.slice(0, 10)) {
      issues.push({
        severity: 'error',
        message: `graph: ${issue.path.join('.')}: ${issue.message}`,
      });
    }
  }
  if (!trigger.success)
    issues.push({ severity: 'error', message: 'draft trigger failed to parse' });
  if (!graph.success || !trigger.success) return { issues };
  return { trigger: trigger.data, graph: graph.data };
}

/* ── Runs sub-router ─────────────────────────────────────────────────────── */

const runsRouter = router({
  list: automationProcedure
    .input(
      z.object({
        flowId: z.string().uuid().optional(),
        status: RunStatusSchema.optional(),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const rows = await listRuns(ctx.db, ctx.auth.organizationId, input);
      return rows.map((r) => ({
        id: r.id,
        flowId: r.flowId,
        flowVersionId: r.flowVersionId,
        triggerType: r.triggerType,
        status: r.status,
        objectId: r.objectId,
        recordId: r.recordId,
        depth: r.depth,
        triggeredByRunId: r.triggeredByRunId,
        stepCount: r.stepCount,
        error: r.error,
        resumeAt: r.resumeAt,
        startedAt: r.startedAt,
        completedAt: r.completedAt,
        createdAt: r.createdAt,
      }));
    }),

  get: automationProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const result = await getRunWithSteps(ctx.db, ctx.auth.organizationId, input.id);
      if (!result) throw new TRPCError({ code: 'NOT_FOUND', message: 'run not found' });
      return {
        run: result.run,
        steps: result.steps.map((s) => ({
          id: s.id,
          stepIndex: s.stepIndex,
          nodeId: s.nodeId,
          nodeType: s.nodeType,
          status: s.status,
          summary: s.summary,
          error: s.error,
          startedAt: s.startedAt,
          durationMs: s.durationMs,
        })),
      };
    }),

  cancel: automationProcedure
    .input(z.object({ id: z.string().uuid(), reason: z.string().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const row = await cancelRun(
        ctx.db,
        ctx.auth.organizationId,
        input.id,
        input.reason ?? `cancelled by ${ctx.auth.userEmail}`,
      );
      if (!row) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'only queued or waiting runs can be cancelled',
        });
      }
      return { ok: true as const, status: row.status };
    }),

  /** Wake a waiting run immediately (skip the remaining wait). */
  resume: automationProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const result = await getRunWithSteps(ctx.db, ctx.auth.organizationId, input.id);
      if (!result) throw new TRPCError({ code: 'NOT_FOUND', message: 'run not found' });
      if (result.run.status !== 'waiting') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'only waiting runs can be resumed' });
      }
      const orgId = ctx.auth.organizationId;
      const resumeToken = result.run.resumeToken;
      ctx.postCommit.push(() =>
        enqueueFlowRun({
          orgId,
          runId: input.id,
          ...(resumeToken !== null ? { resumeToken } : {}),
        }),
      );
      return { ok: true as const };
    }),
});

/* ── Router ──────────────────────────────────────────────────────────────── */

export const automationRouter = router({
  /** ai_agent presets for the agent_step picker — names/keys only, never the
   *  system prompts (design-time metadata, not something to leak broadly). */
  agents: automationProcedure.query(async ({ ctx }) => {
    const rows = await listAiAgents(ctx.db, ctx.auth.organizationId);
    return rows.map((a) => ({ key: a.key, name: a.name, description: a.description }));
  }),

  list: automationProcedure
    .input(
      z
        .object({
          objectId: z.string().uuid().nullish(),
          status: FlowStatusSchema.optional(),
        })
        .default({}),
    )
    .query(async ({ ctx, input }) => {
      const orgId = ctx.auth.organizationId;
      const flows = await listFlows(ctx.db, orgId, {
        ...(input.objectId !== undefined ? { objectId: input.objectId } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      });
      // Run stats in two grouped queries (typed builder — no raw SQL).
      const lastRuns = await ctx.db
        .select({ flowId: schema.flowRun.flowId, lastRunAt: max(schema.flowRun.createdAt) })
        .from(schema.flowRun)
        .where(eq(schema.flowRun.organizationId, orgId))
        .groupBy(schema.flowRun.flowId);
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const weekCounts = await ctx.db
        .select({ flowId: schema.flowRun.flowId, runs: count() })
        .from(schema.flowRun)
        .where(and(eq(schema.flowRun.organizationId, orgId), gte(schema.flowRun.createdAt, since)))
        .groupBy(schema.flowRun.flowId);
      const lastByFlow = new Map(lastRuns.map((r) => [r.flowId, r.lastRunAt]));
      const weekByFlow = new Map(weekCounts.map((r) => [r.flowId, r.runs]));
      return flows.map((flow) => ({
        ...serializeFlow(flow),
        // Trigger type shown in the list: active wins, then draft.
        triggerType:
          flow.activeTriggerType ?? (flow.draftTrigger as { type?: string } | null)?.type ?? null,
        lastRunAt: lastByFlow.get(flow.id) ?? null,
        runCount7d: weekByFlow.get(flow.id) ?? 0,
      }));
    }),

  get: automationProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const flow = await requireFlow(ctx.db, ctx.auth.organizationId, input.id);
      const versions = await listFlowVersions(ctx.db, ctx.auth.organizationId, flow.id);
      return {
        flow: serializeFlow(flow),
        versions: versions.map((v) => ({ id: v.id, version: v.version, createdAt: v.createdAt })),
      };
    }),

  create: automationProcedure
    .input(
      z.object({
        name: z.string().min(1).max(120),
        description: z.string().max(2000).optional(),
        objectId: z.string().uuid().nullish(),
        // Drafts save leniently (config-incomplete nodes allowed) — activation
        // re-parses with the strict FlowGraphSchema/FlowTriggerSchema.
        draftTrigger: FlowDraftTriggerSchema.optional(),
        draftGraph: FlowDraftGraphSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.auth.organizationId;
      if (input.objectId) {
        const owf = await getObjectById(ctx.db, orgId, input.objectId);
        if (!owf) throw new TRPCError({ code: 'BAD_REQUEST', message: 'unknown object' });
      }
      const trigger =
        input.draftTrigger ??
        (input.objectId
          ? { id: 'trigger', type: 'trigger_record', config: { event: 'created_or_updated' } }
          : { id: 'trigger', type: 'trigger_webhook', config: {} });
      const graph = input.draftGraph ?? { nodes: [trigger], edges: [] };
      const flow = await createFlow(ctx.db, {
        organizationId: orgId,
        objectId: input.objectId ?? null,
        key: await freeFlowKey(ctx.db, orgId, input.name),
        name: input.name,
        description: input.description ?? null,
        status: 'draft',
        source: 'native',
        draftTrigger: trigger,
        draftGraph: graph,
        webhookSecret: randomBytes(24).toString('hex'),
        createdById: ctx.auth.userId,
      });
      await writeAuditEvent(ctx.db, {
        organizationId: orgId,
        userId: ctx.auth.userId,
        action: 'flow.created',
        targetType: 'flow',
        targetId: flow.id,
        meta: { name: flow.name, key: flow.key },
      });
      return serializeFlow(flow);
    }),

  update: automationProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(120).optional(),
        description: z.string().max(2000).nullish(),
        objectId: z.string().uuid().nullish(),
        // Lenient on purpose — see create. Strictness lives on activate.
        draftTrigger: FlowDraftTriggerSchema.optional(),
        draftGraph: FlowDraftGraphSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.auth.organizationId;
      await requireFlow(ctx.db, orgId, input.id);
      if (input.objectId) {
        const owf = await getObjectById(ctx.db, orgId, input.objectId);
        if (!owf) throw new TRPCError({ code: 'BAD_REQUEST', message: 'unknown object' });
      }
      const updated = await updateFlow(ctx.db, orgId, input.id, {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.objectId !== undefined ? { objectId: input.objectId } : {}),
        ...(input.draftTrigger !== undefined ? { draftTrigger: input.draftTrigger } : {}),
        ...(input.draftGraph !== undefined ? { draftGraph: input.draftGraph } : {}),
      });
      if (!updated) throw new TRPCError({ code: 'NOT_FOUND' });
      await writeAuditEvent(ctx.db, {
        organizationId: orgId,
        userId: ctx.auth.userId,
        action: 'flow.updated',
        targetType: 'flow',
        targetId: updated.id,
        meta: { name: updated.name },
      });
      return serializeFlow(updated);
    }),

  remove: automationProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.auth.organizationId;
      const flow = await requireFlow(ctx.db, orgId, input.id);
      await deleteFlow(ctx.db, orgId, input.id);
      await writeAuditEvent(ctx.db, {
        organizationId: orgId,
        userId: ctx.auth.userId,
        action: 'flow.deleted',
        targetType: 'flow',
        targetId: flow.id,
        meta: { name: flow.name, key: flow.key },
      });
      ctx.postCommit.push(() => removeFlowSchedule(input.id));
      return { ok: true as const };
    }),

  /** Full validation of the draft (structural + metadata). */
  validate: automationProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const flow = await requireFlow(ctx.db, ctx.auth.organizationId, input.id);
      const parsed = parseDraft(flow);
      if ('issues' in parsed) return { ok: false as const, issues: parsed.issues };
      const issues = await validateFlowMetadata(
        ctx.db,
        ctx.auth.organizationId,
        flow,
        parsed.trigger,
        parsed.graph,
      );
      return { ok: !issues.some((i) => i.severity === 'error'), issues };
    }),

  /** Strict validate → snapshot an immutable version → set it active →
   *  sync the job scheduler post-commit. */
  activate: automationProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.auth.organizationId;
      const flow = await requireFlow(ctx.db, orgId, input.id);
      const parsed = parseDraft(flow);
      if ('issues' in parsed) return { ok: false as const, issues: parsed.issues };
      const issues = await validateFlowMetadata(ctx.db, orgId, flow, parsed.trigger, parsed.graph);
      if (issues.some((i) => i.severity === 'error')) return { ok: false as const, issues };

      const version = await createFlowVersion(ctx.db, {
        organizationId: orgId,
        flowId: flow.id,
        trigger: parsed.trigger,
        graph: parsed.graph,
        createdById: ctx.auth.userId,
      });
      const activated = await setActiveVersion(ctx.db, orgId, flow.id, version.id);
      if (!activated)
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'activation failed' });
      await writeAuditEvent(ctx.db, {
        organizationId: orgId,
        userId: ctx.auth.userId,
        action: 'flow.activated',
        targetType: 'flow',
        targetId: flow.id,
        meta: { name: flow.name, version: version.version },
      });
      // Post-commit: schedulers must only exist for committed activations.
      ctx.postCommit.push(() => syncFlowSchedule(activated));
      return { ok: true as const, issues, flow: serializeFlow(activated) };
    }),

  pause: automationProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.auth.organizationId;
      const flow = await requireFlow(ctx.db, orgId, input.id);
      if (flow.status !== 'active') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'only active flows can be paused' });
      }
      const paused = await updateFlow(ctx.db, orgId, input.id, { status: 'paused' });
      if (!paused) throw new TRPCError({ code: 'NOT_FOUND' });
      await writeAuditEvent(ctx.db, {
        organizationId: orgId,
        userId: ctx.auth.userId,
        action: 'flow.paused',
        targetType: 'flow',
        targetId: flow.id,
        meta: { name: flow.name },
      });
      ctx.postCommit.push(() => removeFlowSchedule(input.id));
      return serializeFlow(paused);
    }),

  rotateWebhookSecret: automationProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.auth.organizationId;
      const flow = await requireFlow(ctx.db, orgId, input.id);
      const secret = randomBytes(24).toString('hex');
      await updateFlow(ctx.db, orgId, input.id, { webhookSecret: secret });
      await writeAuditEvent(ctx.db, {
        organizationId: orgId,
        userId: ctx.auth.userId,
        action: 'flow.webhook_secret_rotated',
        targetType: 'flow',
        targetId: flow.id,
        meta: { name: flow.name },
      });
      return { secret };
    }),

  /** Synchronous dry-run of the DRAFT graph: real reads, simulated side
   *  effects, waits short-circuit; nothing persists. Returns the ordered
   *  step trace for the canvas overlay. */
  testRun: automationProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        recordId: z.string().uuid().optional(),
        /** Simulated inbound payload for webhook-triggered flows. */
        webhookBody: z.unknown().optional(),
      }),
    )
    .mutation(async ({ ctx, input }): Promise<DryRunResult> => {
      const orgId = ctx.auth.organizationId;
      const flow = await requireFlow(ctx.db, orgId, input.id);
      const parsed = parseDraft(flow);
      if ('issues' in parsed) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: parsed.issues.map((i) => i.message).join('; '),
        });
      }

      let record: Record<string, unknown> | undefined;
      let fields: Array<{ key: string; type: string }> = [];
      if (flow.objectId) {
        const owf = await getObjectById(ctx.db, orgId, flow.objectId);
        if (!owf)
          throw new TRPCError({ code: 'BAD_REQUEST', message: "the flow's object is gone" });
        fields = owf.fields.map((f) => ({ key: f.key, type: f.type }));
        if (input.recordId) {
          const row = await getRecord(ctx.db, {
            orgId,
            object: owf.object,
            fields: owf.fields,
            id: input.recordId,
          });
          if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'sample record not found' });
          record = row.data;
        }
      }

      const db = ctx.db;
      return dryRunGraph({
        orgId,
        flow: { id: flow.id, name: flow.name, objectId: flow.objectId },
        graph: parsed.graph,
        recordId: input.recordId ?? null,
        context: {
          ...(record !== undefined ? { record, oldRecord: record, changedKeys: [] } : {}),
          vars: {},
          actorUserId: ctx.auth.userId,
          ...(input.webhookBody !== undefined ? { webhookBody: input.webhookBody } : {}),
        },
        // The procedure already runs inside the RLS-scoped transaction —
        // executors' reads reuse it rather than opening nested transactions.
        tx: (fn) => fn(db),
        user: { id: ctx.auth.userId, email: ctx.auth.userEmail },
        fields,
      });
    }),

  runs: runsRouter,
});
