// update_records — resolves the target to concrete records, then pushes each
// through the full write pipeline (rules enforced, audit source 'automation',
// dispatch at depth + 1). All writes share one transaction — a validation
// failure on the Nth record rolls back the whole node, never a partial batch.

import { type FlowNodeOfType, interpolate } from '@northbeam/core';
import type { RunContext } from '../context.js';
import { writeRecordViaPipeline } from '../record-service.js';
import { resolveRecordTargets } from './targets.js';
import { type ExecResult, type ExecServices, execScope, ok } from './types.js';

export async function executeUpdateRecords(
  node: FlowNodeOfType<'update_records'>,
  ctx: RunContext,
  services: ExecServices,
): Promise<ExecResult> {
  const cfg = node.config;
  const scopes = execScope(ctx, services);
  const fields = interpolate(cfg.fields, scopes) as Record<string, unknown>;

  if (services.dryRun) {
    const refs = await services.tx((tx) =>
      resolveRecordTargets(tx, cfg.target, ctx, services, scopes),
    );
    return ok({
      simulated: true,
      targets: refs.slice(0, 10),
      targetCount: refs.length,
      fields,
    });
  }

  const { updated, enqueues, triggerRecordData } = await services.tx(async (tx) => {
    const refs = await resolveRecordTargets(tx, cfg.target, ctx, services, scopes);
    const hooks: Array<() => Promise<void>> = [];
    let triggerData: Record<string, unknown> | undefined;
    for (const ref of refs) {
      const result = await writeRecordViaPipeline(
        {
          tx,
          orgId: services.orgId,
          now: services.now(),
          depth: services.depth + 1,
          triggeredByRunId: services.runId,
          flowId: services.flow.id,
        },
        { objectKey: ref.objectKey, recordId: ref.recordId, fields },
      );
      hooks.push(result.enqueue);
      if (cfg.target.kind === 'trigger_record') triggerData = result.data;
    }
    return { updated: refs.length, enqueues: hooks, triggerRecordData: triggerData };
  });
  // Downstream nodes see the trigger record as it now is.
  if (triggerRecordData) ctx.record = triggerRecordData;
  for (const enqueue of enqueues) await enqueue();
  return ok({ updated, fields: Object.keys(fields) });
}
