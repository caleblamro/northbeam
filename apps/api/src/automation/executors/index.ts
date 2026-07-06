// Executor registry — one module per node type, one entrypoint for the
// engine. decision and loop are NOT here: they are pure routing evaluated by
// the engine itself (condition.ts + walker.ts); executors exist for nodes
// with side effects or context writes. Any throw inside an executor becomes
// a failed node (fail-fast, partial steps preserved) — never an unhandled
// worker crash.

import type { FlowNode } from '@northbeam/core';
import type { RunContext } from '../context.js';
import { executeAgentStep } from './agent-step.js';
import { executeAiStep } from './ai-step.js';
import { executeAssignOwner } from './assign-owner.js';
import { executeAssignment } from './assignment.js';
import { executeCreateRecord, pipelineErrorMessage } from './create-record.js';
import { executeDeleteRecord } from './delete-record.js';
import { executeGetRecords } from './get-records.js';
import { executeNotify } from './notify.js';
import { executePostTimeline } from './post-timeline.js';
import { executeSendEmail } from './send-email.js';
import type { ExecResult, ExecServices } from './types.js';
import { executeUpdateRecords } from './update-records.js';
import { executeWaitArrive } from './wait.js';
import { executeWebhookOut } from './webhook-out.js';

export type { ExecResult, ExecServices, ExecSummary, FlowFacts } from './types.js';
export { executeWaitResume } from './wait.js';

async function route(node: FlowNode, ctx: RunContext, services: ExecServices): Promise<ExecResult> {
  switch (node.type) {
    case 'trigger_record':
    case 'trigger_scheduled':
    case 'trigger_webhook':
      // Triggers already fired (that's why the run exists) — the step is a
      // trace anchor only.
      return { kind: 'ok', summary: { trigger: node.type } };
    case 'assignment':
      return executeAssignment(node, ctx, services);
    case 'get_records':
      return executeGetRecords(node, ctx, services);
    case 'wait':
      // First arrival only — the engine routes resume claims to
      // executeWaitResume directly.
      return executeWaitArrive(node, ctx, services);
    case 'update_records':
      return executeUpdateRecords(node, ctx, services);
    case 'create_record':
      return executeCreateRecord(node, ctx, services);
    case 'delete_record':
      return executeDeleteRecord(node, ctx, services);
    case 'assign_owner':
      return executeAssignOwner(node, ctx, services);
    case 'send_email':
      return executeSendEmail(node, ctx, services);
    case 'post_timeline':
      return executePostTimeline(node, ctx, services);
    case 'notify':
      return executeNotify(node, ctx, services);
    case 'webhook_out':
      return executeWebhookOut(node, ctx, services);
    case 'ai_step':
      return executeAiStep(node, ctx, services);
    case 'agent_step':
      return executeAgentStep(node, ctx, services);
    case 'decision':
    case 'loop':
      return { kind: 'fail', error: `'${node.type}' is engine-routed, not an executor` };
  }
}

export async function executeNode(
  node: FlowNode,
  ctx: RunContext,
  services: ExecServices,
): Promise<ExecResult> {
  try {
    return await route(node, ctx, services);
  } catch (err) {
    return { kind: 'fail', error: pipelineErrorMessage(err) };
  }
}
