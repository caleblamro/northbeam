'use client';

// Controlled React Flow canvas over the pure FlowGraph doc. The doc is the
// single source of truth: nodes/edges (and the dagre layout) are derived per
// render via buildFlowCanvas, React Flow's own change events are ignored
// except clicks-as-selection. No dragging, no connecting, no library chrome —
// custom nodes/edges, dots background, and our own zoom/fit cluster.
//
// This module is the ONLY importer of React Flow's stylesheet: base.css has
// zero visual opinions (no node/edge chrome); the --xy-* token mapping lives
// in globals.css under "Flow canvas".

import '@xyflow/react/dist/base.css';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';
import type { FlowGraph, FlowIssue, FlowNodeType } from '@northbeam/core/flow';
import {
  Background,
  BackgroundVariant,
  Panel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react';
import { Maximize, ZoomIn, ZoomOut } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { FlowCanvasContext, type FlowCanvasInteractions } from './canvas-context';
import { flowEdgeTypes } from './edges/flow-edge';
import { FLOW_NODE_HEIGHT, FLOW_NODE_WIDTH, buildFlowCanvas } from './flow-graph';
import type { NodeSummaryContext } from './node-catalog';
import { flowNodeTypes } from './nodes/flow-node';
import type { FlowRunOverlay } from './run-overlay';

/** Imperative "center this node" request — bump `nonce` to re-trigger for the
 *  same node (issues popover click-to-center). */
export type FlowCanvasFocus = { nodeId: string; nonce: number };

export type FlowCanvasProps = {
  graph: FlowGraph;
  /** Validation issues to badge onto nodes (client mirror or server result). */
  issues?: FlowIssue[];
  selectedNodeId?: string | null;
  onSelectNode?: (nodeId: string | null) => void;
  /** Absent handlers (or readOnly) hide all insert affordances. */
  onInsertNode?: (edgeId: string, type: FlowNodeType) => void;
  onAppendNode?: (afterNodeId: string, type: FlowNodeType, sourceHandle?: string) => void;
  readOnly?: boolean;
  /** Field/object label lookups for node summary lines. */
  summaryCtx?: NodeSummaryContext;
  /** Run-trace annotation: taken path in accent, untaken dimmed. */
  overlay?: FlowRunOverlay | null;
  /** Pan/zoom to a node (validation issues, step-timeline clicks). */
  focus?: FlowCanvasFocus | null;
  className?: string;
};

function ZoomCluster() {
  const { zoomIn, zoomOut, fitView } = useReactFlow();
  return (
    <Panel position="bottom-left">
      <div className="flex flex-col gap-0.5 rounded-md border bg-card p-0.5 shadow-sm">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Zoom in"
          onClick={() => zoomIn({ duration: 150 })}
        >
          <ZoomIn />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Zoom out"
          onClick={() => zoomOut({ duration: 150 })}
        >
          <ZoomOut />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Fit view"
          onClick={() => fitView({ padding: 0.2, duration: 200 })}
        >
          <Maximize />
        </Button>
      </div>
    </Panel>
  );
}

function FlowCanvasInner({
  graph,
  issues,
  selectedNodeId = null,
  onSelectNode,
  onInsertNode,
  onAppendNode,
  readOnly = false,
  summaryCtx,
  overlay,
  focus,
  className,
}: FlowCanvasProps) {
  const { nodes, edges } = useMemo(
    () => buildFlowCanvas(graph, { issues, summaryCtx, overlay }),
    [graph, issues, summaryCtx, overlay],
  );

  const selectableNodes = useMemo(
    () => nodes.map((node) => ({ ...node, selected: node.id === selectedNodeId })),
    [nodes, selectedNodeId],
  );

  // Positions are derived per render, so resolve the focus target from the
  // freshest layout via a ref (the effect keys on the focus request only).
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const { setCenter } = useReactFlow();
  useEffect(() => {
    if (!focus) return;
    const node = nodesRef.current.find((n) => n.id === focus.nodeId);
    if (!node) return;
    setCenter(node.position.x + FLOW_NODE_WIDTH / 2, node.position.y + FLOW_NODE_HEIGHT / 2, {
      zoom: 1,
      duration: 300,
    });
  }, [focus, setCenter]);

  const interactions = useMemo<FlowCanvasInteractions>(
    () => ({ readOnly, onInsertNode, onAppendNode }),
    [readOnly, onInsertNode, onAppendNode],
  );

  return (
    <FlowCanvasContext.Provider value={interactions}>
      <ReactFlow
        nodes={selectableNodes}
        edges={edges}
        nodeTypes={flowNodeTypes}
        edgeTypes={flowEdgeTypes}
        className={cn('h-full w-full', className)}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        minZoom={0.25}
        maxZoom={1.5}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        selectNodesOnDrag={false}
        panOnScroll
        zoomOnDoubleClick={false}
        deleteKeyCode={null}
        proOptions={{ hideAttribution: true }}
        onNodeClick={(_, node) => onSelectNode?.(node.id)}
        onPaneClick={() => onSelectNode?.(null)}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.25} />
        <ZoomCluster />
      </ReactFlow>
    </FlowCanvasContext.Provider>
  );
}

export function FlowCanvas(props: FlowCanvasProps) {
  // Provider gives ZoomCluster (and future overlays) useReactFlow access even
  // when the host page renders multiple canvases.
  return (
    <ReactFlowProvider>
      <FlowCanvasInner {...props} />
    </ReactFlowProvider>
  );
}
