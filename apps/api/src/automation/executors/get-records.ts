// get_records — bounded query via listRecords (never QuerySpec), stored into
// a flow var. Stored items carry `id`, `objectKey`, and `ownerId` alongside
// the field data so loop_item / var targets and record_owner recipients can
// resolve without re-querying. Reads are REAL in dry-run mode too.
//
// System context: no per-user ACL (SF flows run as the system) — the flow
// author is gated by 'automation.manage' at design time instead.

import { FLOW_LIMITS, type FlowNodeOfType } from '@northbeam/core';
import { getObjectByKey, listRecords } from '@northbeam/db';
import { type RunContext, setVar } from '../context.js';
import { toFilterEntries } from './targets.js';
import { type ExecResult, type ExecServices, execScope, fail, ok } from './types.js';

export async function executeGetRecords(
  node: FlowNodeOfType<'get_records'>,
  ctx: RunContext,
  services: ExecServices,
): Promise<ExecResult> {
  const cfg = node.config;
  const scopes = execScope(ctx, services);
  const rows = await services.tx(async (tx) => {
    const owf = await getObjectByKey(tx, services.orgId, cfg.objectKey);
    if (!owf) return null;
    return listRecords(tx, {
      orgId: services.orgId,
      object: owf.object,
      fields: owf.fields,
      filters: toFilterEntries(cfg.filters ?? [], cfg.logic, scopes),
      sort: cfg.sort ? [cfg.sort] : [],
      limit: Math.min(cfg.limit, FLOW_LIMITS.maxGetRecords),
    });
  });
  if (rows === null) return fail(`object '${cfg.objectKey}' not found`);
  const items = rows.map((r) => ({
    id: r.id,
    objectKey: cfg.objectKey,
    ownerId: r.ownerId,
    ...r.data,
  }));
  setVar(ctx, cfg.assignTo, items);
  return ok({ objectKey: cfg.objectKey, count: items.length, assignedTo: cfg.assignTo });
}
