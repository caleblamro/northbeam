'use client';

// Audit log — every mutating action across the workspace, newest first.
// Writes are wired inline from the corresponding mutations (view.*,
// ai.generate, object.updateLayout, etc.); read access is gated to admin+
// by the API. Empty state when nothing has been recorded yet.

import { EmptyState } from '@/components/northbeam/empty-state';
import { Avatar } from '@/components/northbeam/primitives';
import { SectionCard } from '@/components/northbeam/section-card';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadingScreen } from '@/components/ui/loading-screen';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { trpc } from '@/lib/api';
import { ChevronLeft, ChevronRight, FileClock } from 'lucide-react';
import { useState } from 'react';

const PAGE_SIZE = 50;

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

export default function AuditSetupPage() {
  const [page, setPage] = useState(0);
  const events = trpc.audit.list.useQuery({
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  });
  const rows = events.data ?? [];
  const hasNext = rows.length === PAGE_SIZE;

  return (
    <SectionCard
      icon={FileClock}
      title="Audit log"
      action={
        <span className="text-muted-foreground text-xs">
          Every create / update / delete across the workspace
        </span>
      }
      padding="none"
    >
      {events.isLoading ? (
        <LoadingScreen size="md" />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={FileClock}
          title="Nothing recorded yet"
          body="Audit events show up here the moment someone changes a record, edits a view, or runs AI generation."
          size="sm"
        />
      ) : (
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
                      <Avatar
                        name={row.actorName || row.actorEmail || 'System'}
                        className="size-6"
                      />
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
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                <ChevronLeft />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Next page"
                disabled={!hasNext}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight />
              </Button>
            </div>
          </div>
        </>
      )}
    </SectionCard>
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
