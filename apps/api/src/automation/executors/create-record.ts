// create_record — full write pipeline (validation rules enforced, audit,
// child-flow dispatch at depth + 1). The created record is optionally stored
// in a var, carrying id/objectKey/ownerId like get_records items so it can be
// targeted by later nodes.

import { type FlowNodeOfType, interpolate } from '@northbeam/core';
import { ValidationFailedError } from '@northbeam/core';
import { type RunContext, setVar } from '../context.js';
import { writeRecordViaPipeline } from '../record-service.js';
import { type ExecResult, type ExecServices, execScope, ok } from './types.js';

export function pipelineErrorMessage(err: unknown): string {
  if (err instanceof ValidationFailedError) {
    return `validation failed: ${err.issues.map((i) => i.message).join('; ')}`;
  }
  return err instanceof Error ? err.message : String(err);
}

export async function executeCreateRecord(
  node: FlowNodeOfType<'create_record'>,
  ctx: RunContext,
  services: ExecServices,
): Promise<ExecResult> {
  const cfg = node.config;
  const scopes = execScope(ctx, services);
  const fields = interpolate(cfg.fields, scopes) as Record<string, unknown>;

  if (services.dryRun) {
    if (cfg.assignTo) {
      setVar(ctx, cfg.assignTo, { id: 'dry-run', objectKey: cfg.objectKey, ...fields });
    }
    return ok({ simulated: true, objectKey: cfg.objectKey, fields });
  }

  const result = await services.tx((tx) =>
    writeRecordViaPipeline(
      {
        tx,
        orgId: services.orgId,
        now: services.now(),
        depth: services.depth + 1,
        triggeredByRunId: services.runId,
        flowId: services.flow.id,
      },
      { objectKey: cfg.objectKey, fields, ownerId: null },
    ),
  );
  // Post-commit half of the dispatch — the executor's tx has resolved.
  await result.enqueue();
  if (cfg.assignTo) {
    setVar(ctx, cfg.assignTo, {
      id: result.id,
      objectKey: cfg.objectKey,
      ownerId: null,
      ...result.data,
    });
  }
  return ok({ objectKey: cfg.objectKey, recordId: result.id, assignedTo: cfg.assignTo ?? null });
}
