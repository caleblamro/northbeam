// assign_owner — repoints a record's owner_id system column. The owner is a
// literal member or a `{{merge}}` resolving to a member's user id; non-member
// resolutions fail the node instead of FK-aborting the transaction. The column
// write goes through the dynamic-layer helper `updateRecordOwner` (raw SQL is
// forbidden outside packages/db/src/dynamic; updateRecord skips system columns).

import { type FlowNodeOfType, interpolate } from '@northbeam/core';
import { getObjectByKey, updateRecordOwner, writeAuditEvent } from '@northbeam/db';
import type { RunContext } from '../context.js';
import { memberUserIds, resolveRecordTargets } from './targets.js';
import { type ExecResult, type ExecServices, execScope, fail, ok } from './types.js';

export async function executeAssignOwner(
  node: FlowNodeOfType<'assign_owner'>,
  ctx: RunContext,
  services: ExecServices,
): Promise<ExecResult> {
  const cfg = node.config;
  const scopes = execScope(ctx, services);
  const rawOwner =
    cfg.owner.kind === 'user'
      ? cfg.owner.userId
      : String(interpolate(cfg.owner.value, scopes) ?? '');
  if (rawOwner.trim().length === 0) return fail('owner resolved to an empty value');
  const ownerId = rawOwner.trim();

  if (services.dryRun) {
    const refs = await services.tx((tx) =>
      resolveRecordTargets(tx, cfg.target, ctx, services, scopes),
    );
    return ok({ simulated: true, ownerId, targets: refs });
  }

  const outcome = await services.tx(
    async (tx): Promise<{ error: string } | { updated: number }> => {
      const members = await memberUserIds(tx, services.orgId, [ownerId]);
      if (!members.has(ownerId)) {
        return { error: `'${ownerId}' is not a member of this organization` };
      }
      const refs = await resolveRecordTargets(tx, cfg.target, ctx, services, scopes);
      for (const ref of refs) {
        const owf = await getObjectByKey(tx, services.orgId, ref.objectKey);
        if (!owf) return { error: `object '${ref.objectKey}' not found` };
        const updated = await updateRecordOwner(tx, {
          orgId: services.orgId,
          object: owf.object,
          id: ref.recordId,
          ownerId,
        });
        if (!updated) return { error: `record '${ref.recordId}' no longer exists` };
        await writeAuditEvent(tx, {
          organizationId: services.orgId,
          userId: null,
          action: 'record.updated',
          targetType: 'record',
          targetId: ref.recordId,
          meta: {
            source: 'automation',
            flowId: services.flow.id,
            objectKey: ref.objectKey,
            changed: ['owner'],
            ownerId,
          },
        });
      }
      return { updated: refs.length };
    },
  );
  if ('error' in outcome) return fail(outcome.error);
  return ok({ ownerId, updated: outcome.updated });
}
