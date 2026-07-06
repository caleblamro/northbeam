// delete_record — pipeline delete (parent rollups refreshed, audit written,
// delete-trigger flows dispatched at depth + 1).

import type { FlowNodeOfType } from '@northbeam/core';
import type { RunContext } from '../context.js';
import { deleteRecordViaPipeline } from '../record-service.js';
import { resolveRecordTargets } from './targets.js';
import { type ExecResult, type ExecServices, execScope, ok } from './types.js';

export async function executeDeleteRecord(
  node: FlowNodeOfType<'delete_record'>,
  ctx: RunContext,
  services: ExecServices,
): Promise<ExecResult> {
  const scopes = execScope(ctx, services);
  if (services.dryRun) {
    const refs = await services.tx((tx) =>
      resolveRecordTargets(tx, node.config.target, ctx, services, scopes),
    );
    return ok({ simulated: true, targets: refs });
  }
  const { refs, enqueues } = await services.tx(async (tx) => {
    const resolved = await resolveRecordTargets(tx, node.config.target, ctx, services, scopes);
    const hooks: Array<() => Promise<void>> = [];
    for (const ref of resolved) {
      const result = await deleteRecordViaPipeline(
        {
          tx,
          orgId: services.orgId,
          now: services.now(),
          depth: services.depth + 1,
          triggeredByRunId: services.runId,
          flowId: services.flow.id,
        },
        { objectKey: ref.objectKey, recordId: ref.recordId },
      );
      hooks.push(result.enqueue);
    }
    return { refs: resolved, enqueues: hooks };
  });
  for (const enqueue of enqueues) await enqueue();
  return ok({ deleted: refs.length });
}
