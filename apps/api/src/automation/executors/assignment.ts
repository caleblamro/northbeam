// assignment — SF semantics: writes land on flow vars or the IN-MEMORY trigger
// record; persisting a record field still requires an update_records node.
// Pure in-context, identical in dry-run and durable mode.

import { type FlowNodeOfType, interpolate } from '@northbeam/core';
import { type RunContext, setVar } from '../context.js';
import { type ExecResult, type ExecServices, execScope, ok } from './types.js';

export async function executeAssignment(
  node: FlowNodeOfType<'assignment'>,
  ctx: RunContext,
  services: ExecServices,
): Promise<ExecResult> {
  const assigned: string[] = [];
  for (const { target, value } of node.config.assignments) {
    // Rebuild per assignment so each one sees the previous one's writes
    // (including a freshly created ctx.record).
    const scopes = execScope(ctx, services);
    const resolved = interpolate(value, scopes);
    if (target.scope === 'vars') {
      setVar(ctx, target.name, resolved);
      assigned.push(`vars.${target.name}`);
    } else {
      if (!ctx.record) ctx.record = {};
      ctx.record[target.fieldKey] = resolved;
      assigned.push(`record.${target.fieldKey}`);
    }
  }
  return ok({ assigned });
}
