// Shared executor contract. Lives apart from index.ts so individual executor
// modules can type-import it without creating a runtime cycle with the
// registry (verbatimModuleSyntax keeps these imports type-only).

import type { FlowTrigger, TemplateScopes } from '@northbeam/core';
import type { DbExecutor } from '@northbeam/db';
import type { ConditionField } from '../condition.js';
import { type RunContext, buildScope } from '../context.js';

/** The slice of the flow row executors need — dry-runs synthesize it. */
export type FlowFacts = { id: string; name: string; objectId: string | null };

export type ExecServices = {
  orgId: string;
  flow: FlowFacts;
  /** Parsed trigger of the executing version — wait `relative_to_field`
   *  re-checks its entry condition at fire time. */
  trigger: FlowTrigger | null;
  /** Null in dry-run mode (nothing persists, no run row exists). */
  runId: string | null;
  /** Trigger record id (record-triggered runs only). */
  recordId: string | null;
  /** THIS run's recursion depth. Executors dispatch record events at
   *  depth + 1 — computed here once so no executor can forget. */
  depth: number;
  /** Dry-run: real reads, simulated side effects, waits short-circuit. */
  dryRun: boolean;
  now: () => Date;
  /** `{{user}}` template scope value (engine-injected actor snapshot). */
  user: unknown;
  /** key+type of the trigger object's fields — exact condition semantics. */
  fields: ConditionField[];
  /** Every executor's db work runs through here — one RLS-scoped transaction
   *  per node in durable mode; the host's existing tx in dry-run mode. */
  tx: <T>(fn: (tx: DbExecutor) => Promise<T>) => Promise<T>;
};

export type ExecSummary = Record<string, unknown>;

export type ExecResult =
  /** Node finished; follow the linear edge. */
  | { kind: 'ok'; summary: ExecSummary }
  /** Wait: persist state and go dormant until `resumeAt` (durable only). */
  | { kind: 'park'; summary: ExecSummary; resumeAt: Date }
  /** The run should end early but successfully (e.g. the record a wait was
   *  anchored to was deleted) — recorded as a skipped step, run completes. */
  | { kind: 'end'; summary: ExecSummary; reason: string }
  /** Fail-fast: the run fails with partial steps preserved. */
  | { kind: 'fail'; summary?: ExecSummary; error: string };

export const ok = (summary: ExecSummary): ExecResult => ({ kind: 'ok', summary });
export const fail = (error: string, summary?: ExecSummary): ExecResult =>
  summary === undefined ? { kind: 'fail', error } : { kind: 'fail', error, summary };

/** Template scope for this instant. Rebuild after every ctx mutation — the
 *  record scope is captured by reference-at-build, not live. */
export function execScope(ctx: RunContext, services: ExecServices): TemplateScopes {
  return buildScope(ctx, {
    now: services.now(),
    ...(services.user !== undefined && services.user !== null ? { user: services.user } : {}),
  });
}

/** Interpolate + clamp a template string for a summary/limit-bound field. */
export function interpolatedString(value: unknown, max: number): string {
  const s = typeof value === 'string' ? value : String(value ?? '');
  return s.length > max ? s.slice(0, max) : s;
}

/** Trim free-form text for step summaries so the jsonb stays small. */
export function preview(value: unknown, max = 200): string {
  const s = typeof value === 'string' ? value : (JSON.stringify(value) ?? '');
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
