'use client';

// ToolCallChip — one research/write tool call rendered as a compact chip in
// an AI thread (Claude-style). Shared by the composer drawer and the full
// /ai chat surface. `awaiting` renders Allow / Deny — the server generation
// is parked on the approval broker until one is clicked (or it times out to
// deny). Persisted tool turns replay as static done-state chips via
// `sessionToolRow`.

import { Button } from '@/components/ui/button';
import { trpc } from '@/lib/api';
import { cn } from '@/lib/cn';
import { motion } from 'framer-motion';
import {
  BarChart3,
  Braces,
  Check,
  FileText,
  Layers,
  Loader2,
  type LucideIcon,
  Pencil,
  Plus,
  Search,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import { useState } from 'react';

// The shell's page-transition curve (same as the composer drawer).
const EASE = [0.16, 1, 0.3, 1] as const;

/** One tool call, rendered as a chip in the thread:
 *  awaiting = paused on the approval broker, buttons live in the chip. */
export type ToolCallRow = {
  callId: string;
  toolId: string;
  title: string;
  input: unknown;
  status: 'awaiting' | 'running' | 'done' | 'denied' | 'error';
  summary?: string;
};

export const TOOL_ICONS: Record<string, LucideIcon> = {
  search_records: Search,
  aggregate_records: BarChart3,
  run_query: Braces,
  get_record: FileText,
  inspect_metadata: Layers,
  create_record: Plus,
  update_record: Pencil,
  delete_record: Trash2,
};

/** A persisted session tool turn → a static (done-state) chip row. */
export function sessionToolRow(
  turn: {
    toolId: string;
    title: string;
    status: 'done' | 'denied' | 'error';
    inputSummary?: string;
    resultSummary?: string;
  },
  key: string,
): ToolCallRow {
  let input: unknown = turn.inputSummary;
  if (turn.inputSummary) {
    try {
      input = JSON.parse(turn.inputSummary);
    } catch {
      // keep the raw string
    }
  }
  return {
    callId: key,
    toolId: turn.toolId,
    title: turn.title,
    input,
    status: turn.status,
    summary: turn.resultSummary,
  };
}

function toolInputSummary(input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const o = input as Record<string, unknown>;
  const bits: string[] = [];
  if (typeof o.objectKey === 'string') bits.push(o.objectKey);
  if (typeof o.groupBy === 'string') bits.push(`by ${o.groupBy}`);
  if (Array.isArray(o.groupBy) && o.groupBy[0]) {
    bits.push(`by ${String((o.groupBy[0] as { fieldKey?: string }).fieldKey ?? '')}`);
  }
  if (typeof o.search === 'string' && o.search) bits.push(`"${o.search}"`);
  const s = bits.join(' · ') || JSON.stringify(o).slice(0, 56);
  return s.length > 56 ? `${s.slice(0, 56)}…` : s;
}

/** How many rows/buckets came back — the one number worth surfacing. */
function toolResultCount(summary: string | undefined): string | null {
  if (!summary?.startsWith('[')) return null;
  try {
    const parsed = JSON.parse(summary.replace(/…\(truncated\)$/, ']'));
    return Array.isArray(parsed)
      ? `${parsed.length} result${parsed.length === 1 ? '' : 's'}`
      : null;
  } catch {
    return null;
  }
}

export function ToolCallChip({ call }: { call: ToolCallRow }) {
  const resolve = trpc.ai.resolveTool.useMutation({ meta: { silent: true } });
  const [expanded, setExpanded] = useState(false);
  const summary = toolInputSummary(call.input);
  const count = call.status === 'done' ? toolResultCount(call.summary) : null;
  const ToolIcon = TOOL_ICONS[call.toolId] ?? Wrench;
  const awaiting = call.status === 'awaiting';

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: EASE }}
      className={cn(
        'overflow-hidden rounded-lg border transition-colors',
        awaiting && 'border-[var(--accent-ring)] bg-[var(--accent-soft)]',
        call.status === 'running' && 'border-[var(--accent-ring)]',
        (call.status === 'denied' || call.status === 'error') && 'opacity-65',
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2.5 px-2.5 py-2 text-left text-xs"
        aria-expanded={expanded}
      >
        <span
          className={cn(
            'grid size-6 shrink-0 place-items-center rounded-md border bg-background',
            (awaiting || call.status === 'running') && 'border-[var(--accent-ring)]',
          )}
        >
          <ToolIcon className="size-3.5 text-link" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{call.title}</span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {awaiting
              ? 'Wants to run — allow?'
              : call.status === 'running'
                ? summary || 'Running…'
                : call.status === 'denied'
                  ? 'Declined'
                  : call.status === 'error'
                    ? (call.summary ?? 'Failed')
                    : [summary, count].filter(Boolean).join(' · ')}
          </span>
        </span>
        {call.status === 'running' ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-link" />
        ) : call.status === 'done' ? (
          <Check className="size-3.5 shrink-0 text-link" />
        ) : call.status === 'denied' || call.status === 'error' ? (
          <X className="size-3.5 shrink-0 text-muted-foreground" />
        ) : null}
        {awaiting && (
          <span
            className="flex shrink-0 gap-1"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            <Button
              size="xs"
              disabled={resolve.isPending}
              onClick={() => resolve.mutate({ callId: call.callId, approved: true })}
            >
              Allow
            </Button>
            <Button
              variant="ghost"
              size="xs"
              disabled={resolve.isPending}
              onClick={() => resolve.mutate({ callId: call.callId, approved: false })}
            >
              Deny
            </Button>
          </span>
        )}
      </button>
      {expanded && (
        <div className="border-t bg-muted/30 px-2.5 py-2">
          <p className="font-medium text-[10px] text-muted-foreground uppercase tracking-[0.08em]">
            Input
          </p>
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[10px] leading-relaxed">
            {JSON.stringify(call.input, null, 1)}
          </pre>
          {call.status === 'done' && call.summary && (
            <>
              <p className="mt-2 font-medium text-[10px] text-muted-foreground uppercase tracking-[0.08em]">
                Result
              </p>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] leading-relaxed">
                {call.summary}
              </pre>
            </>
          )}
        </div>
      )}
    </motion.div>
  );
}
