// webhook_out — outbound HTTP through the SSRF guard (webhook-guard.ts).
// The url re-validates AFTER interpolation (the schema's https check can be
// deferred by a leading {{merge}}). Non-2xx responses fail the node —
// fail-fast, partial steps preserved; the guard already retried 5xx.

import { type FlowNodeOfType, interpolate } from '@northbeam/core';
import type { RunContext } from '../context.js';
import { WebhookGuardError, guardedFetch } from '../webhook-guard.js';
import { type ExecResult, type ExecServices, execScope, fail, ok, preview } from './types.js';

export async function executeWebhookOut(
  node: FlowNodeOfType<'webhook_out'>,
  ctx: RunContext,
  services: ExecServices,
): Promise<ExecResult> {
  const cfg = node.config;
  const scopes = execScope(ctx, services);
  const url = String(interpolate(cfg.url, scopes) ?? '');
  if (!url.startsWith('https://')) {
    return fail(`webhook url must start with https:// (resolved to '${preview(url, 100)}')`);
  }
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(cfg.headers ?? {})) {
    headers[key] = String(interpolate(value, scopes) ?? '');
  }
  const body = cfg.body !== undefined ? String(interpolate(cfg.body, scopes) ?? '') : undefined;

  if (services.dryRun) {
    return ok({ simulated: true, method: cfg.method, url, hasBody: body !== undefined });
  }

  try {
    const res = await guardedFetch(url, {
      method: cfg.method,
      headers,
      ...(body !== undefined ? { body } : {}),
    });
    const summary = {
      method: cfg.method,
      url: res.url,
      status: res.status,
      attempts: res.attempts,
      redirects: res.redirects,
      response: preview(res.body, 500),
    };
    if (!res.ok) return fail(`webhook responded ${res.status}`, summary);
    return ok(summary);
  } catch (err) {
    if (err instanceof WebhookGuardError) return fail(err.message, { method: cfg.method, url });
    const message = err instanceof Error ? err.message : String(err);
    return fail(`webhook request failed: ${message}`, { method: cfg.method, url });
  }
}
