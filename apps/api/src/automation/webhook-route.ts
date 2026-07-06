// Inbound flow webhooks: POST /api/hooks/flows/:orgId/:flowId
//
// The orgId rides in the URL because there is no session here — the handler
// establishes its own withOrgContext (RLS) from it. Authenticity is the HMAC:
// X-Northbeam-Signature = hex(hmac-sha256(flow.webhookSecret, rawBody)),
// compared timing-safe. Unknown/paused/non-webhook flows and bad signatures
// all return the SAME 404/401 pair without distinguishing detail beyond that
// — the endpoint must not be an oracle for flow existence vs. state.
//
// Accepted requests create ONE queued run row (outbox) and enqueue it after
// the insert transaction resolves; the caller gets 202 { runId } immediately
// (execution is async — poll automation.runs.get).

import { createHmac, timingSafeEqual } from 'node:crypto';
import { logger } from '@northbeam/core';
import { createRuns, getFlow, withOrgContext } from '@northbeam/db';
import type { Hono } from 'hono';
import { fixedWindow } from '../lib/rate-limit.js';
import type { Variables } from '../middleware/session.js';
import { redis } from '../queue/connection.js';
import { enqueueFlowRun } from '../queue/flows.js';
import { rootDb } from '../trpc/context.js';

const MAX_BODY_BYTES = 256 * 1024;
const REQUESTS_PER_FLOW_PER_MINUTE = 60;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function signatureMatches(secret: string, rawBody: string, provided: string): boolean {
  const expected = createHmac('sha256', secret).update(rawBody, 'utf8').digest();
  let given: Buffer;
  try {
    given = Buffer.from(provided.trim().toLowerCase(), 'hex');
  } catch {
    return false;
  }
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function mountFlowWebhookRoutes(app: Hono<{ Variables: Variables }>): void {
  app.post('/api/hooks/flows/:orgId/:flowId', async (c) => {
    const orgId = c.req.param('orgId');
    const flowId = c.req.param('flowId');
    if (!UUID_RE.test(flowId) || orgId.length === 0 || orgId.length > 64) {
      return c.json({ error: 'not_found' }, 404);
    }

    const window = await fixedWindow(
      redis(),
      `flow:hook:${flowId}`,
      REQUESTS_PER_FLOW_PER_MINUTE,
      60,
    );
    if (!window.ok) {
      return c.json({ error: 'rate_limited', retryAfterSec: window.resetSec }, 429);
    }

    const declared = Number(c.req.header('content-length') ?? '0');
    if (declared > MAX_BODY_BYTES) return c.json({ error: 'payload_too_large' }, 413);
    const raw = await c.req.text();
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
      return c.json({ error: 'payload_too_large' }, 413);
    }

    const flow = await withOrgContext(rootDb(), orgId, (tx) => getFlow(tx, orgId, flowId));
    if (
      !flow ||
      flow.status !== 'active' ||
      flow.activeTriggerType !== 'trigger_webhook' ||
      !flow.activeVersionId ||
      !flow.webhookSecret
    ) {
      return c.json({ error: 'not_found' }, 404);
    }

    const signature = c.req.header('x-northbeam-signature');
    if (!signature || !signatureMatches(flow.webhookSecret, raw, signature)) {
      logger.warn({ orgId, flowId }, 'flow.webhook.bad_signature');
      return c.json({ error: 'invalid_signature' }, 401);
    }

    let body: unknown;
    try {
      body = raw.length > 0 ? JSON.parse(raw) : {};
    } catch {
      return c.json({ error: 'invalid_json' }, 400);
    }

    const versionId = flow.activeVersionId;
    const [run] = await withOrgContext(rootDb(), orgId, (tx) =>
      createRuns(tx, [
        {
          organizationId: orgId,
          flowId,
          flowVersionId: versionId,
          triggerType: 'webhook',
          context: { vars: {}, webhookBody: body, actorUserId: null },
        },
      ]),
    );
    if (!run) return c.json({ error: 'internal' }, 500);
    // Post-commit: the withOrgContext transaction above has resolved.
    await enqueueFlowRun({ orgId, runId: run.id });
    logger.info({ orgId, flowId, runId: run.id }, 'flow.webhook.accepted');
    return c.json({ runId: run.id }, 202);
  });
}
