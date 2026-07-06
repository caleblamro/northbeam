'use client';

// Interaction context threaded from FlowCanvas down to the custom node/edge
// components (React Flow renders them internally, so props can't reach them).
// Lives in its own module to keep flow-canvas ⇄ nodes/edges import-cycle-free.

import type { FlowNodeType } from '@northbeam/core/flow';
import { createContext, useContext } from 'react';

export type FlowCanvasInteractions = {
  /** Hides every insert affordance (run overlays, SF reference views). */
  readOnly: boolean;
  /** Midpoint '+' on an edge — split it with a new node. */
  onInsertNode?: (edgeId: string, type: FlowNodeType) => void;
  /** '+' under a terminal node / unconnected branch handle. */
  onAppendNode?: (afterNodeId: string, type: FlowNodeType, sourceHandle?: string) => void;
};

export const FlowCanvasContext = createContext<FlowCanvasInteractions>({ readOnly: true });

export function useFlowCanvasInteractions(): FlowCanvasInteractions {
  return useContext(FlowCanvasContext);
}
