// The pure heart of the flow engine: graph + serializable WalkState in,
// next-node decision out. No I/O, no clock, no db — the engine (engine.ts)
// evaluates conditions / loads collections and tells the walker WHAT happened
// at the current node; the walker decides WHERE to go and owns every budget
// that can be enforced structurally (step budget, per-loop iteration cap,
// runtime loop-nesting depth).
//
// WalkState is persisted verbatim in flowRun.context (loopFrames + stepCount
// alongside cursorNodeId), so every shape here must stay JSON-serializable and
// backward-tolerant. advance() never mutates its inputs — it returns a fresh
// state so a failed step can be retried from the persisted one.

import { FLOW_LIMITS, type FlowGraph, type FlowNode, isFlowTriggerNode } from '@northbeam/core';

/** One live loop. `sourceVar` is copied from the loop node's config so
 *  context.buildScope can derive `loopItem` without the graph in hand.
 *  `total` snapshots the collection length at loop entry — mutating the var
 *  inside the body does not change the iteration count (SF semantics). */
export type LoopFrame = {
  loopNodeId: string;
  sourceVar: string;
  index: number;
  total: number;
};

export type WalkState = {
  loopFrames: LoopFrame[];
  /** Advances consumed so far — resumed runs carry it across parks. */
  stepCount: number;
};

export function initialWalkState(): WalkState {
  return { loopFrames: [], stepCount: 0 };
}

/** Innermost live loop, or null outside any loop body. */
export function activeLoopFrame(state: WalkState): LoopFrame | null {
  return state.loopFrames[state.loopFrames.length - 1] ?? null;
}

export function triggerNodeOf(graph: FlowGraph): FlowNode | null {
  return graph.nodes.find(isFlowTriggerNode) ?? null;
}

/** What just happened at `fromNodeId`, as observed by the engine:
 *  - 'linear'   — a trigger, action, assignment, get_records, or resumed wait
 *                 finished; follow the single unlabeled edge.
 *  - 'decision' — the engine evaluated outcomes in order; `outcomeId` is the
 *                 first truthy outcome's id, or null (take the default edge).
 *  - 'loop'     — arrival at a loop node (first entry via an inbound edge OR
 *                 return via the body back-edge; the walker tells them apart
 *                 by the frame stack). `itemCount` is the collection length,
 *                 used only on first entry — iteration uses the frame's
 *                 snapshotted total. */
export type WalkInput =
  | { kind: 'linear' }
  | { kind: 'decision'; outcomeId: string | null }
  | { kind: 'loop'; itemCount: number };

export type WalkStep =
  | { kind: 'next'; nodeId: string; state: WalkState }
  | { kind: 'done'; state: WalkState }
  | { kind: 'error'; message: string; nodeId?: string };

const err = (message: string, nodeId?: string): WalkStep =>
  nodeId === undefined ? { kind: 'error', message } : { kind: 'error', message, nodeId };

/** Decide the next node after `fromNodeId`. Every call consumes one step of
 *  the run budget. Structural violations (unknown nodes, missing branch
 *  edges, input/node kind mismatches) come back as errors — validateFlowGraph
 *  prevents them at activate time, but a walker executing a hostile or
 *  hand-edited graph must fail loudly, not walk off the map. */
export function advance(
  graph: FlowGraph,
  state: WalkState,
  fromNodeId: string,
  input: WalkInput,
): WalkStep {
  const node = graph.nodes.find((n) => n.id === fromNodeId);
  if (!node) return err(`unknown node '${fromNodeId}'`);

  if (state.stepCount + 1 > FLOW_LIMITS.maxSteps) {
    return err(`step budget exceeded (${FLOW_LIMITS.maxSteps} steps)`, fromNodeId);
  }
  const next: WalkState = { loopFrames: [...state.loopFrames], stepCount: state.stepCount + 1 };

  const outs = graph.edges.filter((e) => e.source === fromNodeId);
  const follow = (handle: string | undefined): WalkStep => {
    const edge = outs.find((e) => e.sourceHandle === handle);
    return edge
      ? { kind: 'next', nodeId: edge.target, state: next }
      : { kind: 'done', state: next };
  };

  if (input.kind === 'decision') {
    if (node.type !== 'decision') {
      return err(`decision input on non-decision node '${fromNodeId}'`, fromNodeId);
    }
    if (input.outcomeId === null) {
      // No outcome matched: take the default edge; absent default = the run
      // ends here (validateFlowGraph downgraded that to a warning).
      return follow('default');
    }
    if (!node.config.outcomes.some((o) => o.id === input.outcomeId)) {
      return err(`unknown decision outcome '${input.outcomeId}'`, fromNodeId);
    }
    const edge = outs.find((e) => e.sourceHandle === input.outcomeId);
    if (!edge) return err(`decision outcome '${input.outcomeId}' has no edge`, fromNodeId);
    return { kind: 'next', nodeId: edge.target, state: next };
  }

  if (input.kind === 'loop') {
    if (node.type !== 'loop') return err(`loop input on non-loop node '${fromNodeId}'`, fromNodeId);
    const followLoop = (handle: 'body' | 'done'): WalkStep => {
      const edge = outs.find((e) => e.sourceHandle === handle);
      return edge
        ? { kind: 'next', nodeId: edge.target, state: next }
        : err(`loop is missing its '${handle}' edge`, fromNodeId);
    };

    const top = next.loopFrames[next.loopFrames.length - 1];
    if (top && top.loopNodeId === fromNodeId) {
      // Back-edge return: iterate or finish. `total` is the entry snapshot.
      const index = top.index + 1;
      if (index >= top.total) {
        next.loopFrames.pop();
        return followLoop('done');
      }
      if (index >= FLOW_LIMITS.maxLoopIterations) {
        // Unreachable when entry enforced the cap; kept as a hard backstop
        // against a corrupted persisted frame.
        return err(`loop exceeded ${FLOW_LIMITS.maxLoopIterations} iterations`, fromNodeId);
      }
      next.loopFrames[next.loopFrames.length - 1] = { ...top, index };
      return followLoop('body');
    }
    if (next.loopFrames.some((f) => f.loopNodeId === fromNodeId)) {
      // A frame for this loop exists but is not innermost — an illegal jump
      // into an outer loop from inside a nested one.
      return err(`loop '${fromNodeId}' re-entered while a nested loop is live`, fromNodeId);
    }
    // First entry.
    if (input.itemCount <= 0) return followLoop('done');
    if (input.itemCount > FLOW_LIMITS.maxLoopIterations) {
      return err(
        `loop over ${input.itemCount} items exceeds the ${FLOW_LIMITS.maxLoopIterations}-iteration cap`,
        fromNodeId,
      );
    }
    if (next.loopFrames.length + 1 > FLOW_LIMITS.maxLoopNesting) {
      return err(`loops can only nest ${FLOW_LIMITS.maxLoopNesting} deep`, fromNodeId);
    }
    next.loopFrames.push({
      loopNodeId: fromNodeId,
      sourceVar: node.config.sourceVar,
      index: 0,
      total: input.itemCount,
    });
    return followLoop('body');
  }

  // linear
  if (node.type === 'decision' || node.type === 'loop') {
    return err(`'${node.type}' node needs a ${node.type} input, not linear`, fromNodeId);
  }
  if (outs.length > 1) {
    return err(`'${node.type}' has ${outs.length} outgoing edges`, fromNodeId);
  }
  // A dead-ended branch inside a loop body terminates the whole run (the
  // explicit back-edge is the only way to iterate) — mirroring SF.
  return follow(undefined);
}
