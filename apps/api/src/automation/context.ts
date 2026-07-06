// Run context — the engine's working memory, persisted verbatim as
// flowRun.context (a structural superset of @northbeam/db's FlowRunContext,
// so park/complete take it without casts). Pure: this module never touches
// the clock or the db; `now`/`user` are injected by the engine so every
// evaluation is replayable.

import type { TemplateScopes } from '@northbeam/core';
import type { LoopFrame } from './walker.js';

export type RunContext = {
  /** Trigger record's data (new/merged on create/update, absent on webhook/
   *  scheduled-global runs). Delete runs carry only oldRecord. */
  record?: Record<string, unknown>;
  oldRecord?: Record<string, unknown>;
  changedKeys?: string[];
  /** Flow variables — assignment/get_records/create_record/ai_step outputs. */
  vars?: Record<string, unknown>;
  loopFrames?: LoopFrame[];
  /** Node the run parked on (wait) — the resume claim re-enters here. */
  cursorNodeId?: string;
  actorUserId?: string | null;
  webhookBody?: unknown;
  /** Mirror of the flowRun.depth column for executors dispatching at depth+1
   *  (the column stays the source of truth). */
  depth?: number;
};

/** Read a variable by dotted name ('deal.amount' walks vars.deal.amount).
 *  Missing path / walk into a scalar → null, matching template semantics. */
export function getVar(ctx: RunContext, name: string): unknown {
  let value: unknown = ctx.vars;
  for (const part of name.split('.')) {
    if (value === null || value === undefined || typeof value !== 'object') return null;
    value = (value as Record<string, unknown>)[part];
  }
  return value === undefined ? null : value;
}

/** Write a variable by dotted name, creating intermediate objects and
 *  replacing scalars/arrays along the path. Mutates ctx.vars in place — the
 *  engine owns one working context per claimed run. */
export function setVar(ctx: RunContext, name: string, value: unknown): void {
  if (ctx.vars === undefined) ctx.vars = {};
  const parts = name.split('.');
  let target: Record<string, unknown> = ctx.vars;
  for (const part of parts.slice(0, -1)) {
    const existing = target[part];
    if (existing !== null && typeof existing === 'object' && !Array.isArray(existing)) {
      target = existing as Record<string, unknown>;
    } else {
      const fresh: Record<string, unknown> = {};
      target[part] = fresh;
      target = fresh;
    }
  }
  const leaf = parts[parts.length - 1];
  if (leaf !== undefined) target[leaf] = value;
}

/** Assemble the {{template}} / condition scope object from the run context.
 *  `loopItem` is derived from the innermost loop frame (frame.sourceVar +
 *  frame.index into vars); `now` and `user` are engine-injected extras —
 *  never computed here. */
export function buildScope(
  ctx: RunContext,
  extras: { now?: Date; user?: unknown } = {},
): TemplateScopes {
  const scopes: TemplateScopes = {
    record: ctx.record,
    oldRecord: ctx.oldRecord,
    vars: ctx.vars ?? {},
  };
  const frame = ctx.loopFrames?.[ctx.loopFrames.length - 1];
  if (frame) {
    const items = getVar(ctx, frame.sourceVar);
    scopes.loopItem = Array.isArray(items) ? (items[frame.index] ?? null) : null;
  }
  if (extras.now !== undefined) scopes.now = extras.now.toISOString();
  if (extras.user !== undefined) scopes.user = extras.user;
  if (ctx.webhookBody !== undefined) scopes.webhook = ctx.webhookBody;
  return scopes;
}
