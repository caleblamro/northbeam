'use client';

// The single live migration screen. A freshly mapped run auto-executes here —
// no confirmation gate — then shows overall progress, per-object rows, and an
// optional "review mapping" disclosure per object (ObjectMappingCard) that
// stays available while the import runs and after it lands. Completed/failed
// runs render a summary with a "Run again" action.

import {
  MAX_RECORDS_PER_OBJECT,
  ObjectMappingCard,
} from '@/components/northbeam/migrate-object-mapping-card';
import { StatsRow } from '@/components/northbeam/migrate-stats-row';
import { SectionCard } from '@/components/northbeam/section-card';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { LoadingScreen } from '@/components/ui/loading-screen';
import { Progress } from '@/components/ui/progress';
import { trpc } from '@/lib/api';
import { useCurrentRole } from '@/lib/can';
import { can } from '@northbeam/core/roles';
import { AlertCircle, AlertTriangle, ArrowRight, Loader2, RefreshCw } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef } from 'react';

export function RunScreen({ runId, onStartOver }: { runId: string; onStartOver: () => void }) {
  const run = trpc.salesforce.getRun.useQuery(
    { runId },
    {
      refetchInterval: (q) => {
        const s = q.state.data?.run.status;
        if (s === 'running') return 1500;
        // Pre-execute states: keep polling so the screen advances once the
        // worker picks the job up (or an admin starts it from another session).
        if (s === 'mapping' || s === 'ready') return 2500;
        return false;
      },
    },
  );
  const utils = trpc.useUtils();
  const execute = trpc.salesforce.execute.useMutation({
    onSuccess: () => utils.salesforce.getRun.invalidate({ runId }),
    onError: (err) => {
      // CONFLICT = someone already started it — that's our goal state.
      if (err.data?.code === 'CONFLICT') utils.salesforce.getRun.invalidate({ runId });
    },
  });
  const setField = trpc.salesforce.setFieldStatus.useMutation({
    onSuccess: () => utils.salesforce.getRun.invalidate({ runId }),
  });

  const role = useCurrentRole();
  const mayRun = role != null && can(role, 'migration.run');
  const { mutate: executeMutate } = execute;
  const autoExecuted = useRef(false);

  const status = run.data?.run.status;
  useEffect(() => {
    // Auto-execute exactly once per run id, and only from a pre-run status —
    // never re-fire for a run that is already running/completed/failed.
    if (status !== 'ready' && status !== 'mapping') return;
    if (!mayRun || autoExecuted.current) return;
    autoExecuted.current = true;
    executeMutate({ runId });
  }, [status, mayRun, executeMutate, runId]);

  if (run.isLoading || !run.data) return <LoadingScreen size="lg" />;
  const { run: r, objects } = run.data;
  const stats = r.stats ?? {};

  const activeObjects = objects.filter((o) => o.action !== 'skip');
  const sfTotal = activeObjects.reduce((n, o) => n + o.recordCount, 0);
  const cappedTotal = activeObjects.reduce(
    (n, o) => n + Math.min(o.recordCount, MAX_RECORDS_PER_OBJECT),
    0,
  );
  const capNote =
    sfTotal > cappedTotal ? (
      <p className="mt-3 text-muted-foreground text-xs">
        Imports are capped at {MAX_RECORDS_PER_OBJECT} records per object —{' '}
        {sfTotal.toLocaleString()} records exist in Salesforce.
      </p>
    ) : null;

  const mappingCards = (
    <div className="flex flex-col gap-3">
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

  if (r.status === 'completed' || r.status === 'failed') {
    return (
      <div className="reveal flex flex-col gap-4">
        <SectionCard title={r.status === 'completed' ? 'Migration complete' : 'Migration failed'}>
          {r.status === 'failed' && stats.error != null && (
            <Callout variant="danger" icon={AlertCircle} className="mb-4">
              {String(stats.error)}
            </Callout>
          )}
          <StatsRow stats={stats} />
          {capNote}
          {Array.isArray(stats.skippedViews) && stats.skippedViews.length > 0 && (
            <p className="mt-3 text-muted-foreground text-sm">
              {stats.skippedViews.length} report
              {stats.skippedViews.length === 1 ? '' : 's'} couldn&apos;t be translated (
              {(stats.skippedViews as Array<{ label: string; reason: string }>)
                .slice(0, 3)
                .map((s) => s.label)
                .join(', ')}
              {stats.skippedViews.length > 3 ? ', …' : ''}).
            </p>
          )}
          <div className="mt-5 flex flex-wrap gap-2">
            {r.status === 'completed' &&
              activeObjects.map((o) => {
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
              <Button disabled={execute.isPending} onClick={() => executeMutate({ runId })}>
                {execute.isPending && <Loader2 className="animate-spin" />}
                Retry import
              </Button>
            )}
            <Button variant="ghost" onClick={onStartOver}>
              <RefreshCw />
              Run again
            </Button>
            <Link href="/setup/integrations">
              <Button variant="ghost">Manage connection</Button>
            </Link>
          </div>
        </SectionCard>
        {mappingCards}
      </div>
    );
  }

  // Live: mapping / ready (about to auto-execute or waiting for an admin) and
  // running (worker streaming records, polled every 1.5s).
  const imported = typeof stats.imported === 'number' ? stats.imported : 0;
  const records = typeof stats.records === 'number' ? stats.records : 0;
  const pct =
    r.status === 'running' && records > 0
      ? Math.min(100, Math.round((imported / records) * 100))
      : null;
  const unmapped = activeObjects.filter((o) => !o.fields.some((f) => f.status === 'mapped'));
  const executeCode = execute.error?.data?.code;
  const waitingForAdmin =
    r.status !== 'running' && ((role != null && !mayRun) || executeCode === 'FORBIDDEN');

  return (
    <div className="reveal flex flex-col gap-4">
      <SectionCard
        title={`Migrating your Salesforce${
          r.status === 'running' && typeof stats.currentObject === 'string'
            ? ` — ${stats.currentObject}`
            : ''
        }`}
        action={
          !waitingForAdmin ? (
            <span className="flex items-center gap-2 text-muted-foreground text-xs">
              <Loader2 className="size-3.5 animate-spin" />
              {r.status === 'running' ? 'Importing…' : 'Starting import…'}
            </span>
          ) : undefined
        }
      >
        {waitingForAdmin && (
          <Callout variant="info" icon={AlertCircle} title="Waiting for an admin" className="mb-5">
            Your Salesforce data is mapped and ready, but starting an import needs an admin. When an
            admin opens this page the run kicks off automatically.
          </Callout>
        )}
        {execute.isError && executeCode !== 'FORBIDDEN' && executeCode !== 'CONFLICT' && (
          <Callout variant="danger" icon={AlertCircle} className="mb-5">
            {execute.error.message}
          </Callout>
        )}
        {(unmapped.length > 0 || r.status === 'mapping') && (
          <Callout variant="warning" icon={AlertTriangle} className="mb-5">
            {unmapped.length > 0 && (
              <>
                No fields mapped for {unmapped.map((o) => o.sfLabel ?? o.sfObject).join(', ')} —
                those records import with names only unless you map fields below.{' '}
              </>
            )}
            {r.status === 'mapping' &&
              'The mapping analysis for this run never finished; results may be incomplete.'}
          </Callout>
        )}
        <div className="mb-5 flex items-center gap-3">
          <Progress value={pct ?? 0} className="flex-1" />
          <span className="w-10 text-right text-muted-foreground text-xs tabular-nums">
            {pct == null ? '…' : `${pct}%`}
          </span>
        </div>
        <StatsRow stats={stats} />
        {capNote}
      </SectionCard>
      <p className="text-muted-foreground text-sm">
        Curious what maps where? Review each object below — adjusting the mapping never pauses the
        import.
      </p>
      {mappingCards}
    </div>
  );
}
