// send_email — interpolated to/subject/body through the generic automation
// email template. Org-level rate ceiling (100/h) via Redis fixed window; the
// window is a cost guard that fails open on Redis loss, so a hard outage
// degrades to unlimited-but-logged rather than blocking runs.

import { type FlowNodeOfType, interpolate } from '@northbeam/core';
import { send } from '../../email/index.js';
import { fixedWindow } from '../../lib/rate-limit.js';
import type { RunContext } from '../context.js';
import { type ExecResult, type ExecServices, execScope, fail, ok } from './types.js';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const EMAILS_PER_ORG_PER_HOUR = 100;

export async function executeSendEmail(
  node: FlowNodeOfType<'send_email'>,
  ctx: RunContext,
  services: ExecServices,
): Promise<ExecResult> {
  const cfg = node.config;
  const scopes = execScope(ctx, services);
  const to = cfg.to
    .map((t) => String(interpolate(t, scopes) ?? '').trim())
    .filter((addr) => EMAIL_RE.test(addr));
  if (to.length === 0) return fail('no recipient resolved to a valid email address');
  const subject = String(interpolate(cfg.subject, scopes) ?? '').slice(0, 200);
  const body = String(interpolate(cfg.body, scopes) ?? '').slice(0, 10_000);

  if (services.dryRun) return ok({ simulated: true, to, subject });

  // Lazy: the Redis connection must never open for dry-runs or pure tests.
  const { redis } = await import('../../queue/connection.js');
  const window = await fixedWindow(
    redis(),
    `flow:email:${services.orgId}`,
    EMAILS_PER_ORG_PER_HOUR,
    3600,
  );
  if (!window.ok) {
    return fail(
      `org email rate limit exceeded (${EMAILS_PER_ORG_PER_HOUR}/h) — retry after ${window.resetSec}s`,
    );
  }
  for (const addr of to) {
    await send(addr, 'automation', { subject, body, flowName: services.flow.name });
  }
  return ok({ to, subject });
}
