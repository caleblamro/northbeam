'use client';

// "Your focus today" queue for the home page — the TOP overdue / due-soon
// activities and deals closing within two weeks, capped server-side (the
// procedure returns `limit` items + the true total). Matches the H3
// focus-queue design: an eyebrow header OUTSIDE the rows, then individual
// cards with a solid severity edge bar, an object chip, title + one-line
// detail, a mono urgency stamp, and a labelled action button. Overflow
// collapses into one "view all" link instead of an unbounded list.

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { type RouterOutputs, trpc } from '@/lib/api';
import { useCanObject } from '@/lib/can';
import { ArrowRight, Check } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ObjChip } from './app-bits';
import { EmptyState } from './empty-state';
import { EyebrowLabel } from './eyebrow-label';

type AttentionItem = RouterOutputs['home']['attention']['items'][number];
type Severity = AttentionItem['severity'];

// Semantic tone per severity — CSS vars so light/dark both resolve.
const SEVERITY_TONE: Record<Severity, string> = {
  critical: 'var(--danger)',
  today: 'var(--warning)',
  week: 'var(--info)',
};

function relativeDue(dueAt: Date | string | null): { label: string; overdue: boolean } | null {
  if (!dueAt) return null;
  const due = typeof dueAt === 'string' ? new Date(dueAt) : dueAt;
  const diff = due.getTime() - Date.now();
  const abs = Math.abs(diff);
  const [ms, unit] =
    abs < 3_600_000 ? [60_000, 'm'] : abs < 86_400_000 ? [3_600_000, 'h'] : [86_400_000, 'd'];
  const n = Math.max(1, Math.round(abs / ms));
  return diff < 0
    ? { label: `${n}${unit} overdue`, overdue: true }
    : { label: `due in ${n}${unit}`, overdue: false };
}

export function HomeAttention({ limit = 8 }: { limit?: number }) {
  const utils = trpc.useUtils();
  const attention = trpc.home.attention.useQuery({ limit });
  const items = attention.data?.items ?? [];
  const total = attention.data?.total ?? items.length;
  const overflow = total - items.length;

  const complete = trpc.record.update.useMutation({
    meta: { context: "Couldn't complete activity" },
    onSuccess: () => {
      utils.home.attention.invalidate();
      utils.record.list.invalidate();
    },
  });

  return (
    <section>
      <div className="flex items-baseline justify-between">
        <EyebrowLabel>Your focus today</EyebrowLabel>
        {total > 0 && (
          <span className="text-muted-foreground text-sm tabular-nums">
            {total} {total === 1 ? 'item' : 'items'}
          </span>
        )}
      </div>
      {attention.isLoading ? (
        <div className="mt-3 space-y-2.5">
          <Skeleton className="h-14 w-full rounded-lg" />
          <Skeleton className="h-14 w-full rounded-lg" />
          <Skeleton className="h-14 w-5/6 rounded-lg" />
        </div>
      ) : items.length === 0 ? (
        <div className="mt-3 rounded-lg border border-border border-dashed py-6">
          <EmptyState
            icon={Check}
            size="sm"
            title="You're clear ✦"
            body="Nothing needs your attention."
          />
        </div>
      ) : (
        <>
          <ul className="mt-3 flex flex-col gap-2.5">
            {items.map((item) => (
              <AttentionRow
                key={item.id}
                item={item}
                completing={complete.isPending && complete.variables?.id === item.recordId}
                onComplete={() =>
                  complete.mutate({
                    objectKey: item.objectKey,
                    id: item.recordId,
                    data: { status: 'completed' },
                  })
                }
              />
            ))}
          </ul>
          {overflow > 0 && (
            <Link
              href="/activities"
              className="mt-3 inline-flex items-center gap-1 font-medium text-link text-sm underline-offset-4 hover:underline"
            >
              View all {total.toLocaleString()}
              <ArrowRight className="size-3.5" />
            </Link>
          )}
        </>
      )}
    </section>
  );
}

function AttentionRow({
  item,
  completing,
  onComplete,
}: {
  item: AttentionItem;
  completing: boolean;
  onComplete: () => void;
}) {
  const router = useRouter();
  const due = relativeDue(item.dueAt);
  const href = `/${item.objectKey}/${item.recordId}`;
  const canComplete = useCanObject(item.objectKey, 'update');
  const isActivity = item.kind !== 'deal_closing';

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the row is a convenience surface; the action button + title link are the keyboard paths
    <li
      className="grid cursor-pointer grid-cols-[3px_auto_minmax(0,1fr)_auto_auto] items-center gap-3 overflow-hidden rounded-lg border border-border bg-card py-3 pr-4 shadow-xs transition-shadow hover:border-[var(--border-strong)] hover:shadow-sm"
      onClick={() => router.push(href)}
    >
      <span className="self-stretch" style={{ background: SEVERITY_TONE[item.severity] }} />
      <ObjChip label={item.objectKey} size={26} />
      <div className="min-w-0">
        <Link
          href={href}
          onClick={(e) => e.stopPropagation()}
          className="block truncate font-medium text-foreground text-sm"
        >
          {item.title}
        </Link>
        <div className="truncate text-muted-foreground text-xs">{item.sub}</div>
      </div>
      <span
        className="whitespace-nowrap font-mono text-[0.6875rem] text-muted-foreground tabular-nums"
        style={due?.overdue ? { color: 'var(--danger)' } : undefined}
      >
        {due?.label ?? '—'}
      </span>
      {isActivity && canComplete ? (
        <Button
          variant="outline"
          size="sm"
          disabled={completing}
          onClick={(e) => {
            e.stopPropagation();
            onComplete();
          }}
        >
          <Check className="size-3.5" />
          Complete
        </Button>
      ) : (
        <Button variant="outline" size="sm" asChild onClick={(e) => e.stopPropagation()}>
          <Link href={href}>
            Open
            <ArrowRight className="size-3.5" />
          </Link>
        </Button>
      )}
    </li>
  );
}
