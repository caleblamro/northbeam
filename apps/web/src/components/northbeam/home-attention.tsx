'use client';

// Needs-attention inbox for the home page — my overdue / due-soon activities
// and open deals closing within two weeks, grouped into severity tabs. Rows
// carry a semantic-tone edge bar, a kind icon chip, a relative due time, and
// quick actions (Complete for activities, Open for everything).

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { type RouterOutputs, trpc } from '@/lib/api';
import {
  AlarmClock,
  ArrowRight,
  CalendarClock,
  Check,
  CircleDollarSign,
  Flag,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { EmptyState } from './empty-state';
import { EyebrowLabel } from './eyebrow-label';

type AttentionItem = RouterOutputs['home']['attention']['items'][number];
type Severity = AttentionItem['severity'];

const KIND_ICONS: Record<AttentionItem['kind'], LucideIcon> = {
  activity_overdue: AlarmClock,
  activity_due_soon: CalendarClock,
  activity_high_priority: Flag,
  deal_closing: CircleDollarSign,
};

// Semantic tone per severity — CSS vars so light/dark both resolve.
const SEVERITY_TONE: Record<Severity, string> = {
  critical: 'var(--danger)',
  today: 'var(--warning)',
  week: 'var(--info)',
};

const TABS: Array<{ value: string; label: string; severity: Severity | null; empty: string }> = [
  { value: 'all', label: 'All', severity: null, empty: 'Nothing needs your attention.' },
  { value: 'critical', label: 'Critical', severity: 'critical', empty: 'No overdue work.' },
  { value: 'today', label: 'Today', severity: 'today', empty: 'Nothing due today.' },
  { value: 'week', label: 'Upcoming', severity: 'week', empty: 'Nothing coming up this week.' },
];

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

export function HomeAttention() {
  const utils = trpc.useUtils();
  const attention = trpc.home.attention.useQuery();
  const items = attention.data?.items ?? [];

  const complete = trpc.record.update.useMutation({
    meta: { context: "Couldn't complete activity" },
    onSuccess: () => {
      utils.home.attention.invalidate();
      utils.record.list.invalidate();
    },
  });

  return (
    <Card className="p-5">
      <div className="mb-3">
        <EyebrowLabel>Needs attention</EyebrowLabel>
      </div>
      {attention.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-5/6" />
        </div>
      ) : (
        <Tabs defaultValue="all" className="gap-3">
          <TabsList className="w-full gap-4">
            {TABS.map((tab) => {
              const count = tab.severity
                ? items.filter((i) => i.severity === tab.severity).length
                : items.length;
              return (
                <TabsTrigger key={tab.value} value={tab.value} className="text-xs">
                  {tab.label}
                  {count > 0 && (
                    <Badge size="sm" variant="default" className="tabular-nums">
                      {count}
                    </Badge>
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>
          {TABS.map((tab) => {
            const list = tab.severity ? items.filter((i) => i.severity === tab.severity) : items;
            return (
              <TabsContent key={tab.value} value={tab.value}>
                {list.length === 0 ? (
                  <EmptyState icon={Check} size="sm" title="You're clear ✦" body={tab.empty} />
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {list.map((item) => (
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
                )}
              </TabsContent>
            );
          })}
        </Tabs>
      )}
    </Card>
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
  const Icon = KIND_ICONS[item.kind];
  const due = relativeDue(item.dueAt);
  const href = `/${item.objectKey}/${item.recordId}`;
  const isActivity = item.kind !== 'deal_closing';

  return (
    <li
      className="group flex items-center gap-2.5 rounded-md border border-border bg-card py-2 pr-2 pl-3"
      style={{ boxShadow: `inset 2px 0 0 ${SEVERITY_TONE[item.severity]}` }}
    >
      <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
        <Icon className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <Link
          href={href}
          className="block truncate font-medium text-foreground text-sm underline-offset-4 hover:underline"
        >
          {item.title}
        </Link>
        <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
          <span className="truncate">{item.sub}</span>
          {due && (
            <>
              <span className="text-muted-foreground/40">·</span>
              <span
                className="shrink-0 tabular-nums"
                style={due.overdue ? { color: 'var(--danger)' } : undefined}
              >
                {due.label}
              </span>
            </>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {isActivity && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Mark complete"
            title="Mark complete"
            disabled={completing}
            onClick={onComplete}
          >
            <Check className="size-3.5" />
          </Button>
        )}
        <Button variant="ghost" size="icon-sm" aria-label={`Open ${item.title}`} asChild>
          <Link href={href}>
            <ArrowRight className="size-3.5" />
          </Link>
        </Button>
      </div>
    </li>
  );
}
