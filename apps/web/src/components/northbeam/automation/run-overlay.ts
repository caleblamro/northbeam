// Pure trace → canvas-overlay computation, shared by the test-run panel and
// run history's "Show on canvas". Given the ordered step trace the engine
// emitted, derive per-node statuses and the set of edges the run actually
// traversed so the canvas paints the taken path (accent) and dims the rest.
// No React — unit-testable with plain FlowGraph fixtures.

import type { FlowGraph } from '@northbeam/core/flow';

export type FlowRunNodeStatus = 'completed' | 'failed' | 'skipped';

/** Minimal step shape shared by automation.testRun traces and
 *  automation.runs.get step rows (extra keys tolerated). */
export type FlowTraceStepLike = {
  nodeId: string;
  status: string;
  summary?: unknown;
};

export type FlowRunOverlay = {
  /** Last observed status per visited node. */
  nodeStatus: ReadonlyMap<string, FlowRunNodeStatus>;
  takenEdgeIds: ReadonlySet<string>;
};

function coerceStatus(status: string): FlowRunNodeStatus {
  return status === 'failed' ? 'failed' : status === 'skipped' ? 'skipped' : 'completed';
}

/** Decision steps carry `summary.outcome` (the outcome id, or 'default'). */
function stepOutcome(step: FlowTraceStepLike): string | null {
  if (typeof step.summary !== 'object' || step.summary === null) return null;
  const outcome = (step.summary as Record<string, unknown>).outcome;
  return typeof outcome === 'string' ? outcome : null;
}

export function buildRunOverlay(graph: FlowGraph, steps: FlowTraceStepLike[]): FlowRunOverlay {
  const nodeIds = new Set(graph.nodes.map((n) => n.id));
  // Synthetic forensics steps (nodeType 'dispatch') reference no graph node.
  const visited = steps.filter((s) => nodeIds.has(s.nodeId));

  const nodeStatus = new Map<string, FlowRunNodeStatus>();
  for (const step of visited) nodeStatus.set(step.nodeId, coerceStatus(step.status));

  const takenEdgeIds = new Set<string>();
  for (let i = 0; i < visited.length - 1; i += 1) {
    const from = visited[i];
    const to = visited[i + 1];
    if (!from || !to || from.nodeId === to.nodeId) continue;
    const candidates = graph.edges.filter(
      (e) => e.source === from.nodeId && e.target === to.nodeId,
    );
    if (candidates.length === 0) continue;
    const outcome = stepOutcome(from);
    const matched =
      outcome !== null ? candidates.find((e) => e.sourceHandle === outcome) : undefined;
    const taken = matched ?? candidates[0];
    if (taken) takenEdgeIds.add(taken.id);
  }

  return { nodeStatus, takenEdgeIds };
}
