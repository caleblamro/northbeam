// post_timeline — a system note on the target record's activity timeline.
// The seeded 'activity' object relates to records via reference fields
// (contact / related_deal / related_account, plus any custom ones), so the
// note is an activity record whose reference field targeting the record's
// object is set — exactly how the Related panel discovers timeline entries.
// No reference field targeting the object = the note has nowhere to attach,
// which fails the node loudly instead of writing an orphan.

import { type FlowNodeOfType, interpolate } from '@northbeam/core';
import { getObjectByKey, narrowFieldConfig } from '@northbeam/db';
import type { RunContext } from '../context.js';
import { writeRecordViaPipeline } from '../record-service.js';
import { resolveRecordTargets } from './targets.js';
import { type ExecResult, type ExecServices, execScope, fail, ok } from './types.js';

const ACTIVITY_OBJECT_KEY = 'activity';

function subjectFrom(body: string): string {
  const firstLine = body.split('\n', 1)[0] ?? '';
  const trimmed = firstLine.trim();
  const base = trimmed.length > 0 ? trimmed : 'Automation note';
  return base.length > 80 ? `${base.slice(0, 77)}…` : base;
}

export async function executePostTimeline(
  node: FlowNodeOfType<'post_timeline'>,
  ctx: RunContext,
  services: ExecServices,
): Promise<ExecResult> {
  const scopes = execScope(ctx, services);
  const body = String(interpolate(node.config.body, scopes) ?? '').slice(0, 4000);
  if (body.trim().length === 0) return fail('timeline note body resolved to empty text');

  const outcome = await services.tx(async (tx) => {
    const refs = await resolveRecordTargets(tx, node.config.target, ctx, services, scopes);
    const ref = refs[0];
    if (!ref) return { error: 'no target record resolved' };
    const activity = await getObjectByKey(tx, services.orgId, ACTIVITY_OBJECT_KEY);
    if (!activity) return { error: `this org has no '${ACTIVITY_OBJECT_KEY}' object` };
    const refField = activity.fields.find(
      (f) =>
        f.type === 'reference' &&
        narrowFieldConfig('reference', f.config).targetObject === ref.objectKey,
    );
    if (!refField) {
      return {
        error: `the '${ACTIVITY_OBJECT_KEY}' object has no reference field targeting '${ref.objectKey}'`,
      };
    }
    const fields: Record<string, unknown> = {
      subject: subjectFrom(body),
      type: 'note',
      status: 'completed',
      notes: body,
      [refField.key]: ref.recordId,
    };
    if (services.dryRun) return { dry: { ref, fields } };
    const written = await writeRecordViaPipeline(
      {
        tx,
        orgId: services.orgId,
        now: services.now(),
        depth: services.depth + 1,
        triggeredByRunId: services.runId,
        flowId: services.flow.id,
      },
      { objectKey: ACTIVITY_OBJECT_KEY, fields, ownerId: null },
    );
    return { written: { id: written.id, ref, enqueue: written.enqueue } };
  });
  if ('error' in outcome && outcome.error) return fail(outcome.error);
  if ('dry' in outcome && outcome.dry) {
    return ok({ simulated: true, target: outcome.dry.ref, fields: outcome.dry.fields });
  }
  if ('written' in outcome && outcome.written) {
    await outcome.written.enqueue();
    return ok({ activityId: outcome.written.id, target: outcome.written.ref });
  }
  return fail('post_timeline produced no outcome');
}
