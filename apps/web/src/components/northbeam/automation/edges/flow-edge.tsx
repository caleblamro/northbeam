'use client';

// Custom canvas edge — 1px hairline smoothstep (stroke comes from the
// --xy-edge-stroke token mapping in globals.css). The EdgeLabelRenderer
// midpoint carries the SF-style '+' inserter plus branch pills: decision
// outcomes (labeled), dashed Default, loop For-each (dashed) / After-last.
// Loop back-edges render decoratively (dashed, dimmed, no inserter) — the
// adapter already kept them out of the dagre layout.

import { cn } from '@/lib/cn';
import { BaseEdge, EdgeLabelRenderer, type EdgeProps, getSmoothStepPath } from '@xyflow/react';
import { Plus } from 'lucide-react';
import { AddNodeMenu } from '../add-node-menu';
import { useFlowCanvasInteractions } from '../canvas-context';
import type { FlowCanvasEdge, FlowEdgeVariant } from '../flow-graph';

const DASHED: ReadonlySet<FlowEdgeVariant> = new Set(['default', 'loop_body', 'back']);

function FlowEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps<FlowCanvasEdge>) {
  const { readOnly, onInsertNode } = useFlowCanvasInteractions();
  const variant = data?.variant ?? 'normal';
  const isBack = variant === 'back';
  const overlayState = data?.overlayState;

  const [path, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 10,
  });

  const insertable = !readOnly && !isBack && onInsertNode !== undefined && data !== undefined;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        style={{
          strokeDasharray: DASHED.has(variant) ? '4 4' : undefined,
          // Run overlay: the taken path pulls in the accent; everything the
          // run never traversed recedes further than back-edges do.
          stroke: overlayState === 'taken' ? 'var(--accent)' : undefined,
          strokeWidth: overlayState === 'taken' ? 1.5 : undefined,
          opacity: overlayState === 'dimmed' ? 0.3 : isBack ? 0.45 : undefined,
        }}
      />
      {(data?.label || insertable) && (
        <EdgeLabelRenderer>
          <div
            className="nodrag nopan pointer-events-auto absolute flex flex-col items-center gap-1"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              opacity: overlayState === 'dimmed' ? 0.4 : undefined,
            }}
          >
            {data?.label && (
              <span
                className={cn(
                  'rounded-full border bg-card px-2 py-px font-medium text-[11px] text-muted-foreground shadow-xs',
                  variant === 'default' && 'border-dashed',
                )}
              >
                {data.label}
              </span>
            )}
            {insertable && (
              <AddNodeMenu onPick={(type) => onInsertNode(data.doc.id, type)}>
                <button
                  type="button"
                  aria-label="Insert step"
                  className="grid size-5 place-items-center rounded-full border bg-card text-muted-foreground shadow-xs transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
                >
                  <Plus className="size-3" />
                </button>
              </AddNodeMenu>
            )}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const flowEdgeTypes = { flowEdge: FlowEdgeComponent };
