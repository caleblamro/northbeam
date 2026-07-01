'use client';

// Steps 3–4: review the auto-mapping for each picked object, run the import,
// then watch live progress and land on a completion/failure summary.

import { ObjectMappingCard } from '@/components/northbeam/migrate-object-mapping-card';
import { StatsRow } from '@/components/northbeam/migrate-stats-row';
import { SectionCard } from '@/components/northbeam/section-card';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { LoadingScreen } from '@/components/ui/loading-screen';
import { Progress } from '@/components/ui/progress';
import { trpc } from '@/lib/api';
import { AlertCircle, ArrowRight, Loader2, RefreshCw } from 'lucide-react';
import Link from 'next/link';

export function RunScreen({ runId, onStartOver }: { runId: string; onStartOver: () => void }) {
  const run = trpc.salesforce.getRun.useQuery(
    { runId },
    { refetchInterval: (q) => (q.state.data?.run.status === 'running' ? 1500 : false) },
  );
  const utils = trpc.useUtils();
  const execute = trpc.salesforce.execute.useMutation({
    onSuccess: () => utils.salesforce.getRun.invalidate({ runId }),
  });
  const setField = trpc.salesforce.setFieldStatus.useMutation({
    onSuccess: () => utils.salesforce.getRun.invalidate({ runId }),
  });

  if (run.isLoading || !run.data) return <LoadingScreen size="lg" />;
  const { run: r, objects } = run.data;
  const stats = r.stats ?? {};

  if (r.status === 'running') {
    const imported = typeof stats.imported === 'number' ? stats.imported : 0;
    const records = typeof stats.records === 'number' ? stats.records : 0;
    const pct = records > 0 ? Math.min(100, Math.round((imported / records) * 100)) : null;
    return (
      <SectionCard
        title={`Importing${stats.currentObject ? ` — ${stats.currentObject}` : '…'}`}
        className="reveal max-w-3xl"
      >
        <div className="mb-5 flex items-center gap-3">
          <Progress value={pct ?? 0} className="flex-1" />
          <span className="w-10 text-right text-muted-foreground text-xs tabular-nums">
            {pct == null ? '…' : `${pct}%`}
          </span>
        </div>
        <StatsRow stats={stats} />
      </SectionCard>
    );
  }

  if (r.status === 'completed' || r.status === 'failed') {
    return (
      <SectionCard
        title={r.status === 'completed' ? 'Migration complete' : 'Migration failed'}
        className="reveal max-w-3xl"
      >
        {r.status === 'failed' && stats.error && (
          <Callout variant="danger" icon={AlertCircle} className="mb-4">
            {String(stats.error)}
          </Callout>
        )}
        <StatsRow stats={stats} />
        <div className="mt-5 flex flex-wrap gap-2">
          {r.status === 'completed' &&
            objects
              .filter((o) => o.action !== 'skip')
              .map((o) => {
                const meta = o.meta as { targetKey?: string; labelPlural?: string };
                return (
                  <Link key={o.id} href={`/${meta.targetKey ?? o.sfObject}`}>
                    <Button variant="outline">
                      View {meta.labelPlural ?? o.sfLabel ?? o.sfObject}
                      <ArrowRight />
                    </Button>
                  </Link>
                );
              })}
          {r.status === 'failed' && (
            <Button disabled={execute.isPending} onClick={() => execute.mutate({ runId })}>
              {execute.isPending && <Loader2 className="animate-spin" />}
              Retry import
            </Button>
          )}
          <Button variant="ghost" onClick={onStartOver}>
            Start a new run
          </Button>
        </div>
      </SectionCard>
    );
  }

  // status: mapping / ready → review
  const totals = objects.reduce(
    (acc, o) => {
      for (const f of o.fields) {
        if (f.status === 'mapped') acc.mapped++;
        else if (f.status === 'review') acc.review++;
        else acc.skip++;
      }
      return acc;
    },
    { mapped: 0, review: 0, skip: 0 },
  );

  return (
    <div className="reveal flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <p className="text-muted-foreground text-sm">
          {objects.length} objects · {totals.mapped} fields mapped · {totals.review} need review ·{' '}
          {totals.skip} skipped
        </p>
        <div className="flex-1" />
        <Button variant="ghost" onClick={onStartOver}>
          Re-pick objects
        </Button>
        <Button disabled={execute.isPending} onClick={() => execute.mutate({ runId })}>
          {execute.isPending ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          Run import
        </Button>
      </div>
      {objects.map((o) => (
        <ObjectMappingCard
          key={o.id}
          object={o}
          onToggleField={(id, current) =>
            setField.mutate({ id, status: current === 'skip' ? 'mapped' : 'skip' })
          }
        />
      ))}
    </div>
  );
}
