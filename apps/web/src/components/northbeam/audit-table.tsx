'use client';

// Audit log table + pager. Pure presentation: the page owns the query and
// pagination state, this renders the rows and emits prev/next intent.

import { Avatar } from '@/components/northbeam/primitives';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ChevronLeft, ChevronRight } from 'lucide-react';

const ACTION_TONE: Record<string, BadgeTone> = {
  created: 'relation',
  updated: 'choice',
  deleted: 'computed',
  pinned: 'date',
  generated: 'brand',
};

function toneForAction(action: string): BadgeTone {
  const verb = action.split('.').slice(-1)[0] ?? '';
  return ACTION_TONE[verb] ?? 'neutral';
}

function formatRelative(date: Date): string {
  const diff = Date.now() - date.getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export type AuditRow = {
  id: string;
  createdAt: string | Date;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  targetType: string;
  meta: Record<string, unknown>;
};

export function AuditTable({
  rows,
  page,
  hasNext,
  onPrev,
  onNext,
}: {
  rows: AuditRow[];
  page: number;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-44">When</TableHead>
            <TableHead className="w-48">Actor</TableHead>
            <TableHead className="w-44">Action</TableHead>
            <TableHead>Target</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="text-muted-foreground text-xs tabular-nums">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span>{formatRelative(new Date(row.createdAt))}</span>
                  </TooltipTrigger>
                  <TooltipContent>{new Date(row.createdAt).toLocaleString()}</TooltipContent>
                </Tooltip>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Avatar name={row.actorName || row.actorEmail || 'System'} className="size-6" />
                  <div className="min-w-0">
                    <div className="truncate font-medium text-foreground text-xs">
                      {row.actorName || row.actorEmail || 'System'}
                    </div>
                    {row.actorEmail && row.actorName && (
                      <div className="truncate text-[10px] text-muted-foreground">
                        {row.actorEmail}
                      </div>
                    )}
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <Badge tone={toneForAction(row.action)} size="sm" className="font-mono">
                  {row.action}
                </Badge>
              </TableCell>
              <TableCell>
                <ActionMeta action={row.action} targetType={row.targetType} meta={row.meta} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex items-center justify-between gap-3 border-t px-4 py-2.5 text-xs">
        <span className="text-muted-foreground tabular-nums">
          Page {page + 1} · {rows.length.toLocaleString()} events
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Previous page"
            disabled={page === 0}
            onClick={onPrev}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Next page"
            disabled={!hasNext}
            onClick={onNext}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>
    </>
  );
}

/** Pretty-print the most useful bits of the event's meta payload. The
 *  schema is intentionally loose — each writer puts whatever's useful
 *  ({ label, type, changed, … }), so this just picks the common keys. */
function ActionMeta({
  action,
  targetType,
  meta,
}: {
  action: string;
  targetType: string;
  meta: Record<string, unknown>;
}) {
  const label = typeof meta.label === 'string' ? meta.label : null;
  const type = typeof meta.type === 'string' ? meta.type : null;
  const objectKey = typeof meta.objectKey === 'string' ? meta.objectKey : null;
  const changed = Array.isArray(meta.changed) ? (meta.changed as string[]) : null;
  const sectionCount = typeof meta.sectionCount === 'number' ? (meta.sectionCount as number) : null;
  const nodeCount = typeof meta.nodeCount === 'number' ? (meta.nodeCount as number) : null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <Badge tone="neutral" size="sm" className="text-muted-foreground">
        {targetType}
      </Badge>
      {label && <span className="font-medium text-foreground">{label}</span>}
      {type && (
        <span className="text-muted-foreground">
          (<code className="font-mono text-[10px]">{type}</code>)
        </span>
      )}
      {objectKey && (
        <span className="text-muted-foreground">
          on <code className="font-mono text-[10px]">{objectKey}</code>
        </span>
      )}
      {changed && changed.length > 0 && (
        <span className="text-muted-foreground">
          changed {changed.length === 1 ? changed[0] : `${changed.length} fields`}
        </span>
      )}
      {sectionCount !== null && action === 'object.layout.updated' && (
        <span className="text-muted-foreground">{sectionCount} sections</span>
      )}
      {nodeCount !== null && action === 'ai.generated' && (
        <span className="text-muted-foreground">{nodeCount} nodes</span>
      )}
    </div>
  );
}
