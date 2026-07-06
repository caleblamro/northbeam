// The ONLY zod-doc → React Flow adapter. Takes the pure FlowGraph document
// (no positions persist — the graph stays semantics-only) and derives renderable
// nodes/edges with a dagre top-down layout in the same pass. Loop back-edges
// are excluded from dagre (they would collapse the vertical ranking) and come
// back as decorative 'back' variant edges instead. Pure function — no React,
// unit-testable with plain FlowGraph fixtures.

import dagre from '@dagrejs/dagre';
import type { FlowEdge, FlowGraph, FlowIssue, FlowNode, FlowNodeType } from '@northbeam/core/flow';
import { isFlowTriggerNode } from '@northbeam/core/flow';
import type { Edge, Node } from '@xyflow/react';
import { type NodeSummaryContext, nodeSummary, nodeTitle } from './node-catalog';
import type { FlowRunNodeStatus, FlowRunOverlay } from './run-overlay';

/** Fixed layout footprint fed to dagre; the node shell renders at exactly
 *  this width (height is the shell's natural ~2-line height). */
export const FLOW_NODE_WIDTH = 264;
export const FLOW_NODE_HEIGHT = 68;

export type FlowEdgeVariant =
  | 'normal'
  /** Decision outcome edge — labeled pill. */
  | 'outcome'
  /** Decision fall-through — dashed + 'Default' pill. */
  | 'default'
  /** Loop per-item path — dashed + 'For each' pill. */
  | 'loop_body'
  /** Loop exit — 'After last' pill. */
  | 'loop_done'
  /** Loop back-edge — decorative only, never part of the dagre layout. */
  | 'back';

export type FlowCanvasNodeData = {
  doc: FlowNode;
  title: string;
  summary: string;
  issues: FlowIssue[];
  /** Source handles with no outgoing edge yet (null = the single default
   *  exit) — where the node renders an append-'+' affordance. */
  openHandles: (string | null)[];
  /** Run-overlay status chip (test run / run history "Show on canvas"). */
  runStatus?: FlowRunNodeStatus;
  /** Overlay active but this node wasn't visited — render at 40% opacity. */
  dimmed?: boolean;
};

export type FlowCanvasEdgeData = {
  doc: FlowEdge;
  variant: FlowEdgeVariant;
  label?: string;
  /** Present only while a run overlay is active. */
  overlayState?: 'taken' | 'dimmed';
};

export type FlowCanvasNode = Node<FlowCanvasNodeData, FlowNodeType>;
export type FlowCanvasEdge = Edge<FlowCanvasEdgeData, 'flowEdge'>;

/** Loop nodes accept the decorative back-edge on a dedicated left-side
 *  target handle so it never overlaps the real inbound edge. */
export const LOOP_RETURN_HANDLE = 'return';

/** Edges that close a loop: target a loop node from inside its own body.
 *  Body membership = reachable from the loop's 'body' edge without passing
 *  back through the loop node (same rule as core's validateFlowGraph). */
export function findLoopBackEdgeIds(graph: FlowGraph): Set<string> {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const outbound = new Map<string, FlowEdge[]>();
  for (const edge of graph.edges) {
    const list = outbound.get(edge.source);
    if (list) list.push(edge);
    else outbound.set(edge.source, [edge]);
  }

  const backEdgeIds = new Set<string>();
  for (const loop of graph.nodes) {
    if (loop.type !== 'loop') continue;
    const bodyEdge = (outbound.get(loop.id) ?? []).find((e) => e.sourceHandle === 'body');
    if (!bodyEdge || !byId.has(bodyEdge.target)) continue;
    const body = new Set<string>();
    const stack = [bodyEdge.target];
    for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
      if (id === loop.id || body.has(id) || !byId.has(id)) continue;
      body.add(id);
      for (const edge of outbound.get(id) ?? []) stack.push(edge.target);
    }
    for (const edge of graph.edges) {
      if (edge.target === loop.id && body.has(edge.source)) backEdgeIds.add(edge.id);
    }
  }
  return backEdgeIds;
}

function edgePresentation(
  edge: FlowEdge,
  source: FlowNode | undefined,
  backEdgeIds: Set<string>,
): Pick<FlowCanvasEdgeData, 'variant' | 'label'> {
  if (backEdgeIds.has(edge.id)) return { variant: 'back' };
  if (source?.type === 'loop') {
    if (edge.sourceHandle === 'body') return { variant: 'loop_body', label: 'For each' };
    if (edge.sourceHandle === 'done') return { variant: 'loop_done', label: 'After last' };
  }
  if (source?.type === 'decision' && edge.sourceHandle) {
    if (edge.sourceHandle === 'default') return { variant: 'default', label: 'Default' };
    const outcome = source.config.outcomes.find((o) => o.id === edge.sourceHandle);
    return { variant: 'outcome', label: outcome?.label ?? edge.sourceHandle };
  }
  return { variant: 'normal' };
}

export function buildFlowCanvas(
  graph: FlowGraph,
  options: {
    issues?: FlowIssue[];
    summaryCtx?: NodeSummaryContext;
    overlay?: FlowRunOverlay | null;
  } = {},
): { nodes: FlowCanvasNode[]; edges: FlowCanvasEdge[] } {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const backEdgeIds = findLoopBackEdgeIds(graph);
  const overlay = options.overlay ?? null;

  const layout = new dagre.graphlib.Graph();
  layout.setGraph({ rankdir: 'TB', nodesep: 48, ranksep: 64, marginx: 24, marginy: 24 });
  layout.setDefaultEdgeLabel(() => ({}));
  for (const node of graph.nodes) {
    layout.setNode(node.id, { width: FLOW_NODE_WIDTH, height: FLOW_NODE_HEIGHT });
  }
  for (const edge of graph.edges) {
    if (backEdgeIds.has(edge.id)) continue;
    // Dagre needs both endpoints registered; skip dangling edges (they are
    // validation errors, not layout input).
    if (!byId.has(edge.source) || !byId.has(edge.target)) continue;
    layout.setEdge(edge.source, edge.target);
  }
  dagre.layout(layout);

  const issuesByNode = new Map<string, FlowIssue[]>();
  for (const issue of options.issues ?? []) {
    if (!issue.nodeId) continue;
    const list = issuesByNode.get(issue.nodeId);
    if (list) list.push(issue);
    else issuesByNode.set(issue.nodeId, [issue]);
  }

  const outboundHandles = new Map<string, Set<string | null>>();
  for (const edge of graph.edges) {
    const set = outboundHandles.get(edge.source) ?? new Set<string | null>();
    set.add(edge.sourceHandle ?? null);
    outboundHandles.set(edge.source, set);
  }

  const openHandlesFor = (doc: FlowNode): (string | null)[] => {
    const taken = outboundHandles.get(doc.id) ?? new Set<string | null>();
    if (doc.type === 'decision') {
      return [...doc.config.outcomes.map((o): string | null => o.id), 'default'].filter(
        (h) => !taken.has(h),
      );
    }
    if (doc.type === 'loop') {
      return (['body', 'done'] as (string | null)[]).filter((h) => !taken.has(h));
    }
    return taken.size === 0 ? [null] : [];
  };

  const nodes: FlowCanvasNode[] = graph.nodes.map((doc) => {
    const placed = layout.node(doc.id);
    return {
      id: doc.id,
      type: doc.type,
      // Dagre reports centers; React Flow positions are top-left corners.
      position: {
        x: (placed?.x ?? 0) - FLOW_NODE_WIDTH / 2,
        y: (placed?.y ?? 0) - FLOW_NODE_HEIGHT / 2,
      },
      data: {
        doc,
        title: nodeTitle(doc),
        summary: nodeSummary(doc, options.summaryCtx),
        issues: issuesByNode.get(doc.id) ?? [],
        openHandles: openHandlesFor(doc),
        ...(overlay
          ? overlay.nodeStatus.has(doc.id)
            ? { runStatus: overlay.nodeStatus.get(doc.id) }
            : { dimmed: true }
          : {}),
      },
      draggable: false,
      connectable: false,
      deletable: false,
    };
  });

  const edges: FlowCanvasEdge[] = graph.edges.map((doc) => {
    const presentation = edgePresentation(doc, byId.get(doc.source), backEdgeIds);
    const isBack = presentation.variant === 'back';
    const targetsLoop = byId.get(doc.target)?.type === 'loop';
    return {
      id: doc.id,
      source: doc.source,
      target: doc.target,
      sourceHandle: doc.sourceHandle ?? null,
      targetHandle: isBack && targetsLoop ? LOOP_RETURN_HANDLE : null,
      type: 'flowEdge',
      data: {
        doc,
        ...presentation,
        ...(overlay
          ? {
              overlayState: overlay.takenEdgeIds.has(doc.id)
                ? ('taken' as const)
                : ('dimmed' as const),
            }
          : {}),
      },
      selectable: false,
      deletable: false,
    };
  });

  return { nodes, edges };
}

/** Trigger nodes never show the midpoint '+' on their inbound side (they have
 *  none) — exported for the canvas to gate insertion affordances. */
export { isFlowTriggerNode };
