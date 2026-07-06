'use client';

// Single source of truth for the flow editor: a useReducer over the pure zod
// FlowGraph document. The canvas is a projection (flow-graph.ts); React Flow's
// own change events are ignored except selection. Every mutation re-runs
// core's validateFlowGraph so issue badges track the doc with zero drift from
// the server's activate-time check.

import type {
  FlowGraph,
  FlowIssue,
  FlowNode,
  FlowNodeOfType,
  FlowNodeType,
} from '@northbeam/core/flow';
import { validateFlowGraph } from '@northbeam/core/flow';
import { useMemo, useReducer } from 'react';
import { findLoopBackEdgeIds } from './flow-graph';
import { createDefaultNode } from './node-catalog';

export type DecisionOutcome = FlowNodeOfType<'decision'>['config']['outcomes'][number];

export type FlowEditorState = {
  graph: FlowGraph;
  selectedNodeId: string | null;
  /** Unsaved-changes flag — cleared only by 'reset' / 'markSaved'. */
  dirty: boolean;
  /** Client mirror of the server's structural validation. */
  issues: FlowIssue[];
};

export type FlowEditorAction =
  | { type: 'reset'; graph: FlowGraph }
  | { type: 'markSaved' }
  | { type: 'select'; nodeId: string | null }
  /** Split an existing edge A→B into A→new→B (the midpoint '+' menu). */
  | { type: 'insertNode'; edgeId: string; nodeType: FlowNodeType }
  /** Hang a new node off a terminal node or an unconnected branch handle. */
  | { type: 'appendNode'; afterNodeId: string; nodeType: FlowNodeType; sourceHandle?: string }
  | { type: 'removeNode'; nodeId: string }
  | { type: 'updateNode'; nodeId: string; patch: { name?: string; description?: string } }
  | { type: 'updateNodeConfig'; nodeId: string; config: FlowNode['config'] }
  | { type: 'addOutcome'; nodeId: string }
  | { type: 'removeOutcome'; nodeId: string; outcomeId: string }
  | { type: 'moveOutcome'; nodeId: string; outcomeId: string; direction: 'up' | 'down' };

function nextNodeId(graph: FlowGraph, type: FlowNodeType): string {
  let max = 0;
  const prefix = `${type}_`;
  for (const node of graph.nodes) {
    if (!node.id.startsWith(prefix)) continue;
    const n = Number.parseInt(node.id.slice(prefix.length), 10);
    if (Number.isInteger(n) && n > max) max = n;
  }
  return `${prefix}${max + 1}`;
}

function nextEdgeId(graph: FlowGraph): string {
  let max = 0;
  for (const edge of graph.edges) {
    if (!edge.id.startsWith('e_')) continue;
    const n = Number.parseInt(edge.id.slice(2), 10);
    if (Number.isInteger(n) && n > max) max = n;
  }
  return `e_${max + 1}`;
}

/** The continuation handle a freshly inserted node exposes downstream:
 *  decisions route the prior path through their first outcome (keeps the
 *  graph valid — missing default is only a warning), loops through 'done'
 *  ('body' stays open until the user adds a body step). */
function continuationHandle(node: FlowNode): string | undefined {
  if (node.type === 'decision') return node.config.outcomes[0]?.id;
  if (node.type === 'loop') return 'done';
  return undefined;
}

function isTriggerType(type: FlowNodeType): boolean {
  return type === 'trigger_record' || type === 'trigger_scheduled' || type === 'trigger_webhook';
}

function withGraph(state: FlowEditorState, graph: FlowGraph): FlowEditorState {
  return { ...state, graph, dirty: true, issues: validateFlowGraph(graph).issues };
}

function updateDecision(
  state: FlowEditorState,
  nodeId: string,
  mutate: (outcomes: DecisionOutcome[]) => DecisionOutcome[] | null,
): FlowEditorState {
  const node = state.graph.nodes.find((n) => n.id === nodeId);
  if (node?.type !== 'decision') return state;
  const outcomes = mutate([...node.config.outcomes]);
  if (!outcomes) return state;
  const nodes = state.graph.nodes.map((n) =>
    n.id === nodeId && n.type === 'decision' ? { ...n, config: { outcomes } } : n,
  );
  return withGraph(state, { ...state.graph, nodes });
}

export function flowEditorReducer(
  state: FlowEditorState,
  action: FlowEditorAction,
): FlowEditorState {
  switch (action.type) {
    case 'reset':
      return {
        graph: action.graph,
        selectedNodeId: null,
        dirty: false,
        issues: validateFlowGraph(action.graph).issues,
      };

    case 'markSaved':
      return state.dirty ? { ...state, dirty: false } : state;

    case 'select':
      return state.selectedNodeId === action.nodeId
        ? state
        : { ...state, selectedNodeId: action.nodeId };

    case 'insertNode': {
      if (isTriggerType(action.nodeType)) return state;
      const edge = state.graph.edges.find((e) => e.id === action.edgeId);
      if (!edge || findLoopBackEdgeIds(state.graph).has(edge.id)) return state;
      const node = createDefaultNode(action.nodeType, nextNodeId(state.graph, action.nodeType));
      const continuation = {
        id: nextEdgeId(state.graph),
        source: node.id,
        target: edge.target,
        ...(continuationHandle(node) ? { sourceHandle: continuationHandle(node) } : {}),
      };
      const graph: FlowGraph = {
        nodes: [...state.graph.nodes, node],
        edges: [
          ...state.graph.edges.map((e) => (e.id === edge.id ? { ...e, target: node.id } : e)),
          continuation,
        ],
      };
      return { ...withGraph(state, graph), selectedNodeId: node.id };
    }

    case 'appendNode': {
      if (isTriggerType(action.nodeType)) return state;
      const source = state.graph.nodes.find((n) => n.id === action.afterNodeId);
      if (!source) return state;
      const taken = state.graph.edges.some(
        (e) =>
          e.source === action.afterNodeId && (e.sourceHandle ?? undefined) === action.sourceHandle,
      );
      if (taken) return state;
      const node = createDefaultNode(action.nodeType, nextNodeId(state.graph, action.nodeType));
      const edge = {
        id: nextEdgeId(state.graph),
        source: action.afterNodeId,
        target: node.id,
        ...(action.sourceHandle ? { sourceHandle: action.sourceHandle } : {}),
      };
      const graph: FlowGraph = {
        nodes: [...state.graph.nodes, node],
        edges: [...state.graph.edges, edge],
      };
      return { ...withGraph(state, graph), selectedNodeId: node.id };
    }

    case 'removeNode': {
      const node = state.graph.nodes.find((n) => n.id === action.nodeId);
      if (!node || isTriggerType(node.type)) return state;
      const inbound = state.graph.edges.filter((e) => e.target === node.id);
      const outbound = state.graph.edges.filter((e) => e.source === node.id);
      // Splice the gap when the removed node has a single continuation path
      // (its only exit; a loop's 'done'; a decision's 'default').
      const continuation =
        node.type === 'decision'
          ? outbound.find((e) => e.sourceHandle === 'default')
          : node.type === 'loop'
            ? outbound.find((e) => e.sourceHandle === 'done')
            : outbound[0];
      const removed = new Set([...inbound, ...outbound].map((e) => e.id));
      const backEdgeIds = findLoopBackEdgeIds(state.graph);
      const edges = state.graph.edges
        .filter((e) => !removed.has(e.id))
        .concat(
          continuation
            ? inbound
                .filter((e) => !backEdgeIds.has(e.id))
                .map((e) => ({ ...e, target: continuation.target }))
            : [],
        );
      const graph: FlowGraph = {
        nodes: state.graph.nodes.filter((n) => n.id !== node.id),
        edges,
      };
      const next = withGraph(state, graph);
      return state.selectedNodeId === node.id ? { ...next, selectedNodeId: null } : next;
    }

    case 'updateNode': {
      const nodes = state.graph.nodes.map((n) =>
        n.id === action.nodeId ? { ...n, ...action.patch } : n,
      );
      return withGraph(state, { ...state.graph, nodes });
    }

    case 'updateNodeConfig': {
      const nodes = state.graph.nodes.map((n) =>
        n.id === action.nodeId
          ? // The action carries the config union; pairing it with the node's
            // own discriminant is the caller's contract (the config panel is
            // rendered from the same node it edits).
            ({ ...n, config: action.config } as FlowNode)
          : n,
      );
      return withGraph(state, { ...state.graph, nodes });
    }

    case 'addOutcome':
      return updateDecision(state, action.nodeId, (outcomes) => {
        let max = 0;
        for (const o of outcomes) {
          const n = Number.parseInt(o.id.replace(/^outcome_/, ''), 10);
          if (Number.isInteger(n) && n > max) max = n;
        }
        outcomes.push({
          id: `outcome_${max + 1}`,
          label: `Outcome ${max + 1}`,
          condition: { mode: 'filters', logic: 'and', filters: [{ fieldKey: '', op: 'isSet' }] },
        });
        return outcomes;
      });

    case 'removeOutcome': {
      // Drop the outcome AND its edge; anything downstream of that edge stays
      // and surfaces as 'not reachable' issues for the user to clean up.
      const node = state.graph.nodes.find((n) => n.id === action.nodeId);
      if (node?.type !== 'decision') return state;
      if (node.config.outcomes.length <= 1) return state;
      if (!node.config.outcomes.some((o) => o.id === action.outcomeId)) return state;
      const nodes = state.graph.nodes.map((n) =>
        n.id === action.nodeId && n.type === 'decision'
          ? {
              ...n,
              config: { outcomes: n.config.outcomes.filter((o) => o.id !== action.outcomeId) },
            }
          : n,
      );
      const edges = state.graph.edges.filter(
        (e) => !(e.source === action.nodeId && e.sourceHandle === action.outcomeId),
      );
      return withGraph(state, { nodes, edges });
    }

    case 'moveOutcome':
      return updateDecision(state, action.nodeId, (outcomes) => {
        const from = outcomes.findIndex((o) => o.id === action.outcomeId);
        const to = action.direction === 'up' ? from - 1 : from + 1;
        if (from < 0 || to < 0 || to >= outcomes.length) return null;
        const [moved] = outcomes.splice(from, 1);
        if (!moved) return null;
        outcomes.splice(to, 0, moved);
        return outcomes;
      });
  }
}

function init(graph: FlowGraph): FlowEditorState {
  return { graph, selectedNodeId: null, dirty: false, issues: validateFlowGraph(graph).issues };
}

export function useFlowEditor(initialGraph: FlowGraph) {
  const [state, dispatch] = useReducer(flowEditorReducer, initialGraph, init);

  const actions = useMemo(
    () => ({
      reset: (graph: FlowGraph) => dispatch({ type: 'reset', graph }),
      markSaved: () => dispatch({ type: 'markSaved' }),
      select: (nodeId: string | null) => dispatch({ type: 'select', nodeId }),
      insertNode: (edgeId: string, nodeType: FlowNodeType) =>
        dispatch({ type: 'insertNode', edgeId, nodeType }),
      appendNode: (afterNodeId: string, nodeType: FlowNodeType, sourceHandle?: string) =>
        dispatch({ type: 'appendNode', afterNodeId, nodeType, sourceHandle }),
      removeNode: (nodeId: string) => dispatch({ type: 'removeNode', nodeId }),
      updateNode: (nodeId: string, patch: { name?: string; description?: string }) =>
        dispatch({ type: 'updateNode', nodeId, patch }),
      updateNodeConfig: <T extends FlowNodeType>(
        nodeId: string,
        config: FlowNodeOfType<T>['config'],
      ) => dispatch({ type: 'updateNodeConfig', nodeId, config }),
      addOutcome: (nodeId: string) => dispatch({ type: 'addOutcome', nodeId }),
      removeOutcome: (nodeId: string, outcomeId: string) =>
        dispatch({ type: 'removeOutcome', nodeId, outcomeId }),
      moveOutcome: (nodeId: string, outcomeId: string, direction: 'up' | 'down') =>
        dispatch({ type: 'moveOutcome', nodeId, outcomeId, direction }),
    }),
    [],
  );

  const selectedNode = useMemo(
    () =>
      state.selectedNodeId
        ? (state.graph.nodes.find((n) => n.id === state.selectedNodeId) ?? null)
        : null,
    [state.selectedNodeId, state.graph.nodes],
  );

  return { ...state, selectedNode, actions, dispatch };
}

export type FlowEditor = ReturnType<typeof useFlowEditor>;
export type FlowEditorActions = FlowEditor['actions'];
