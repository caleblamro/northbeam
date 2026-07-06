// notify — in-app notifications (the topbar bell). Recipients resolve to org
// members; template resolutions that are not members are dropped (recorded in
// the summary) rather than FK-aborting the insert. Org ceiling 1000/h.

import { type FlowNodeOfType, interpolate } from '@northbeam/core';
import { getObjectById, getRecord, insertNotifications } from '@northbeam/db';
import { fixedWindow } from '../../lib/rate-limit.js';
import type { RunContext } from '../context.js';
import { memberUserIds } from './targets.js';
import { type ExecResult, type ExecServices, execScope, fail, ok } from './types.js';

const NOTIFICATIONS_PER_ORG_PER_HOUR = 1000;

async function recordOwnerId(ctx: RunContext, services: ExecServices): Promise<string | null> {
  // Inside a loop body, "record owner" means the current loop item's owner
  // (get_records items carry ownerId); otherwise it is the trigger record's.
  const frame = ctx.loopFrames?.[ctx.loopFrames.length - 1];
  if (frame) {
    const scopes = execScope(ctx, services);
    const item = scopes.loopItem;
    if (item !== null && typeof item === 'object') {
      const owner = (item as Record<string, unknown>).ownerId;
      return typeof owner === 'string' && owner.length > 0 ? owner : null;
    }
    return null;
  }
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
    return row?.ownerId ?? null;
  });
}

export async function executeNotify(
  node: FlowNodeOfType<'notify'>,
  ctx: RunContext,
  services: ExecServices,
): Promise<ExecResult> {
  const cfg = node.config;
  const scopes = execScope(ctx, services);
  const candidates: string[] = [];
  for (const recipient of cfg.recipients) {
    if (recipient.kind === 'user') candidates.push(recipient.userId);
    else if (recipient.kind === 'template') {
      candidates.push(String(interpolate(recipient.value, scopes) ?? '').trim());
    } else {
      const owner = await recordOwnerId(ctx, services);
      if (owner) candidates.push(owner);
    }
  }
  const unique = [...new Set(candidates.filter((c) => c.length > 0))];
  if (unique.length === 0) return fail('no notification recipient resolved');

  const title = String(interpolate(cfg.title, scopes) ?? '').slice(0, 140);
  const body = cfg.body !== undefined ? String(interpolate(cfg.body, scopes) ?? '') : null;
  const link = cfg.link !== undefined ? String(interpolate(cfg.link, scopes) ?? '') : null;

  const members = await services.tx((tx) => memberUserIds(tx, services.orgId, unique));
  const recipients = unique.filter((id) => members.has(id));
  const dropped = unique.filter((id) => !members.has(id));
  if (recipients.length === 0) return fail('no recipient is a member of this organization');

  if (services.dryRun) return ok({ simulated: true, recipients, dropped, title });

  const { redis } = await import('../../queue/connection.js');
  const window = await fixedWindow(
    redis(),
    `flow:notify:${services.orgId}`,
    NOTIFICATIONS_PER_ORG_PER_HOUR,
    3600,
  );
  if (!window.ok) {
    return fail(
      `org notification rate limit exceeded (${NOTIFICATIONS_PER_ORG_PER_HOUR}/h) — retry after ${window.resetSec}s`,
    );
  }
  await services.tx((tx) =>
    insertNotifications(
      tx,
      recipients.map((userId) => ({
        organizationId: services.orgId,
        userId,
        title,
        body,
        link,
      })),
    ),
  );
  return ok({ recipients: recipients.length, dropped, title });
}
