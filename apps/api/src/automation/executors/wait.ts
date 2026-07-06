// wait — the durable pause. Two phases the engine routes explicitly:
//   arrive  — first execution: compute the wake-up instant and ask the engine
//             to park (or continue immediately when the instant has passed).
//   resume  — the run was re-claimed at this node. duration/until just
//             proceed; relative_to_field re-reads the trigger record at fire
//             time (SF scheduled-path semantics): record gone → run ends,
//             entry condition no longer met → run ends, anchor date moved to
//             the future → re-park (lazy rescheduling — documented gap vs
//             SF's proactive cancellation).
// Dry-runs never park: arrive returns ok with the simulated wake-up.

import { type FlowNodeOfType, interpolate } from '@northbeam/core';
import { getObjectById, getRecord } from '@northbeam/db';
import { evaluateFlowCondition } from '../condition.js';
import { type RunContext, buildScope } from '../context.js';
import { type ExecResult, type ExecServices, execScope, fail, ok } from './types.js';

const UNIT_MS = { minutes: 60_000, hours: 3_600_000, days: 86_400_000 } as const;

/** Re-park instead of proceeding when the anchor still sits this far out —
 *  absorbs clock skew and early resume-job delivery without busy-looping. */
const RESUME_SLACK_MS = 30_000;

type WaitConfig = FlowNodeOfType<'wait'>['config'];

async function readTriggerRecord(
  services: ExecServices,
): Promise<{ data: Record<string, unknown> } | null> {
  if (!services.flow.objectId || !services.recordId) return null;
  return services.tx(async (tx) => {
    const owf = await getObjectById(tx, services.orgId, services.flow.objectId as string);
    if (!owf) return null;
    const row = await getRecord(tx, {
      orgId: services.orgId,
      object: owf.object,
      fields: owf.fields,
      id: services.recordId as string,
    });
    return row ? { data: row.data } : null;
  });
}

function anchorInstant(
  cfg: Extract<WaitConfig, { kind: 'relative_to_field' }>,
  data: Record<string, unknown>,
): Date | null | 'empty' {
  const raw = data[cfg.fieldKey];
  if (raw === null || raw === undefined || raw === '') return 'empty';
  const base = raw instanceof Date ? raw : new Date(String(raw));
  if (Number.isNaN(base.getTime())) return null;
  return new Date(base.getTime() + cfg.offset * UNIT_MS[cfg.unit]);
}

function resolveTarget(
  cfg: WaitConfig,
  ctx: RunContext,
  services: ExecServices,
): Promise<ExecResult | Date> {
  const now = services.now();
  if (cfg.kind === 'duration') {
    return Promise.resolve(new Date(now.getTime() + cfg.amount * UNIT_MS[cfg.unit]));
  }
  if (cfg.kind === 'until') {
    const raw = interpolate(cfg.at, execScope(ctx, services));
    const at = raw instanceof Date ? raw : new Date(String(raw ?? ''));
    if (Number.isNaN(at.getTime())) {
      return Promise.resolve(fail(`wait 'until' did not resolve to a date (got '${String(raw)}')`));
    }
    return Promise.resolve(at);
  }
  return (async (): Promise<ExecResult | Date> => {
    const record = await readTriggerRecord(services);
    if (!record) {
      return {
        kind: 'end',
        reason: 'trigger record no longer exists',
        summary: { fieldKey: cfg.fieldKey },
      };
    }
    const anchor = anchorInstant(cfg, record.data);
    if (anchor === 'empty') {
      return {
        kind: 'end',
        reason: `field '${cfg.fieldKey}' is empty — nothing to wait for`,
        summary: { fieldKey: cfg.fieldKey },
      };
    }
    if (anchor === null) return fail(`field '${cfg.fieldKey}' does not hold a valid date`);
    return anchor;
  })();
}

export async function executeWaitArrive(
  node: FlowNodeOfType<'wait'>,
  ctx: RunContext,
  services: ExecServices,
): Promise<ExecResult> {
  const resolved = await resolveTarget(node.config, ctx, services);
  if (!(resolved instanceof Date)) return resolved;
  const now = services.now();
  if (services.dryRun) {
    return ok({ simulated: true, kind: node.config.kind, wouldResumeAt: resolved.toISOString() });
  }
  if (resolved.getTime() <= now.getTime()) {
    // Past-due (SF parity: overdue scheduled paths fire immediately).
    return ok({ kind: node.config.kind, immediate: true, target: resolved.toISOString() });
  }
  return {
    kind: 'park',
    resumeAt: resolved,
    summary: { kind: node.config.kind, resumeAt: resolved.toISOString() },
  };
}

export async function executeWaitResume(
  node: FlowNodeOfType<'wait'>,
  ctx: RunContext,
  services: ExecServices,
): Promise<ExecResult> {
  const cfg = node.config;
  if (cfg.kind !== 'relative_to_field') {
    return ok({ kind: cfg.kind, resumed: true });
  }
  const record = await readTriggerRecord(services);
  if (!record) {
    return {
      kind: 'end',
      reason: 'trigger record was deleted while waiting',
      summary: { fieldKey: cfg.fieldKey },
    };
  }
  // The record is live again — refresh the working copy so downstream nodes
  // and the entry re-check see its CURRENT values, not the pre-wait snapshot.
  ctx.record = record.data;
  if (services.trigger?.type === 'trigger_record' && services.trigger.config.entryCondition) {
    const result = evaluateFlowCondition(services.trigger.config.entryCondition, {
      data: record.data,
      scopes: buildScope(ctx, { now: services.now() }),
      fields: services.fields,
      now: services.now(),
    });
    if (!result.matched) {
      return {
        kind: 'end',
        reason: 'entry condition no longer met at fire time',
        summary: { fieldKey: cfg.fieldKey, ...(result.warning ? { warning: result.warning } : {}) },
      };
    }
  }
  const anchor = anchorInstant(cfg, record.data);
  if (anchor === 'empty') {
    return {
      kind: 'end',
      reason: `field '${cfg.fieldKey}' was cleared while waiting`,
      summary: { fieldKey: cfg.fieldKey },
    };
  }
  if (anchor === null) return fail(`field '${cfg.fieldKey}' does not hold a valid date`);
  const now = services.now();
  if (anchor.getTime() > now.getTime() + RESUME_SLACK_MS) {
    // The anchor moved into the future while parked — re-park at the new
    // instant (lazy rescheduling).
    return {
      kind: 'park',
      resumeAt: anchor,
      summary: { kind: cfg.kind, reparked: true, resumeAt: anchor.toISOString() },
    };
  }
  return ok({ kind: cfg.kind, resumed: true, anchor: anchor.toISOString() });
}
