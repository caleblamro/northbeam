'use client';

// The single live migration screen. A freshly mapped run auto-executes here —
// no confirmation gate — then shows overall progress, per-object rows, and an
// optional "review mapping" disclosure per object (ObjectMappingCard) that
// stays available while the import runs and after it lands. Completed/failed
// runs render a summary with a "Run again" action.

import { ObjChip } from '@/components/northbeam/app-bits';
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
import { useCan, useCurrentRole } from '@/lib/can';
import { cn } from '@/lib/cn';
import { AlertCircle, AlertTriangle, ArrowRight, Check, Loader2, RefreshCw } from 'lucide-react';
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

  // `role` gates the "is the role loaded yet" check below; `mayRun` is the
  // grant-based permission (works for custom roles, unlike the old rank-based
  // can()).
  const role = useCurrentRole();
  const mayRun = useCan('migration.run');
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
          onToggleField={
            mayRun
              ? (id, current) =>
                  setField.mutate({ id, status: current === 'skip' ? 'mapped' : 'skip' })
              : undefined
          }
        />
      ))}
    </div>
  );

  if (r.status === 'failed') {
    return (
      <div className="reveal flex flex-col gap-4">
        <SectionCard title="Migration failed">
          {stats.error != null && (
            <Callout variant="danger" icon={AlertCircle} className="mb-4">
              {String(stats.error)}
            </Callout>
          )}
          <StatsRow stats={stats} />
          {capNote}
          <div className="mt-5 flex flex-wrap gap-2">
            {mayRun && (
              <Button disabled={execute.isPending} onClick={() => executeMutate({ runId })}>
                {execute.isPending && <Loader2 className="animate-spin" />}
                Retry import
              </Button>
            )}
            {mayRun && (
              <Button variant="ghost" onClick={onStartOver}>
                <RefreshCw />
                Run again
              </Button>
            )}
            <Link href="/setup/integrations">
              <Button variant="ghost">Manage connection</Button>
            </Link>
          </div>
        </SectionCard>
        {mappingCards}
      </div>
    );
  }

  if (r.status === 'completed') {
    // ── The arrival (M3): headline backed by an audit-grade sync report. All
    // numbers below come from the run itself — nothing invented.
    const allFields = activeObjects.flatMap((o) => o.fields);
    const mappedCount = allFields.filter((f) => f.status === 'mapped').length;
    const reviewCount = allFields.filter((f) => f.status === 'review').length;
    const skipCount = allFields.filter((f) => f.status === 'skip').length;
    const mappedConf = allFields.filter((f) => f.status !== 'skip').map((f) => f.confidence);
    const avgConf =
      mappedConf.length > 0
        ? Math.round(mappedConf.reduce((a, b) => a + b, 0) / mappedConf.length)
        : null;
    const recordsRead = stats.records ?? null;
    const importedN = stats.imported ?? null;
    const referencesN = stats.refsResolved ?? null;
    const reportsN = stats.reportsImported ?? null;
    const dashboardsN = stats.dashboardsImported ?? null;
    const capOverflow = sfTotal - cappedTotal;
    const skippedViews = Array.isArray(stats.skippedViews)
      ? (stats.skippedViews as Array<{ label: string; reason: string }>)
      : [];

    const steps: Array<{
      name: string;
      state: 'ok' | 'warn';
      big: string;
      of?: string;
      detail: string;
      pct: number;
    }> = [
      {
        name: 'Discover',
        state: 'ok',
        big: String(stats.fields ?? allFields.length),
        of: 'fields',
        detail: `${stats.objects ?? activeObjects.length} objects read over the describe API`,
        pct: 100,
      },
      {
        name: 'Map',
        state: reviewCount > 0 ? 'warn' : 'ok',
        big: String(mappedCount),
        of: `/ ${allFields.length}`,
        detail: `${avgConf != null ? `avg ${avgConf}% confidence · ` : ''}${
          reviewCount > 0 ? `${reviewCount} flagged · ` : ''
        }${skipCount} skipped`,
        pct: allFields.length > 0 ? Math.round((mappedCount / allFields.length) * 100) : 100,
      },
      {
        name: 'Build',
        state: 'ok',
        big: String(activeObjects.length),
        of: activeObjects.length === 1 ? 'table' : 'tables',
        detail: 'typed columns + indexes in your org’s schema',
        pct: 100,
      },
      {
        name: 'Import',
        state: capOverflow > 0 ? 'warn' : 'ok',
        big: String(importedN ?? 0),
        of: recordsRead != null ? `/ ${recordsRead}` : undefined,
        detail:
          capOverflow > 0
            ? `${MAX_RECORDS_PER_OBJECT}-record cap per object — ${capOverflow.toLocaleString()} remain in Salesforce`
            : 'every discovered record imported',
        pct:
          recordsRead && recordsRead > 0
            ? Math.min(100, Math.round(((importedN ?? 0) / recordsRead) * 100))
            : 100,
      },
      {
        name: 'Link',
        state: 'ok',
        big: String(referencesN ?? 0),
        of: 'references',
        detail: 'resolved to native references by Salesforce Id',
        pct: 100,
      },
      {
        name: 'Rebuild',
        state: skippedViews.length > 0 ? 'warn' : 'ok',
        big: String(reportsN ?? 0),
        of: reportsN === 1 ? 'report' : 'reports',
        detail: `${dashboardsN ?? 0} dashboard${dashboardsN === 1 ? '' : 's'}${
          skippedViews.length > 0 ? ` · ${skippedViews.length} couldn’t translate` : ''
        }`,
        pct: 100,
      },
    ];

    const gaps: Array<{ text: string; anchor?: string }> = [];
    if (reviewCount > 0) {
      gaps.push({
        text: `${reviewCount} field${reviewCount === 1 ? ' needs' : 's need'} a mapping decision.`,
        anchor: '#mapping',
      });
    }
    if (skippedViews.length > 0) {
      gaps.push({
        text: `${skippedViews.length} Salesforce report${
          skippedViews.length === 1 ? '' : 's'
        } couldn't be translated (${skippedViews
          .slice(0, 3)
          .map((s) => s.label)
          .join(', ')}${skippedViews.length > 3 ? ', …' : ''}).`,
      });
    }
    if (capOverflow > 0) {
      gaps.push({
        text: `${capOverflow.toLocaleString()} records sit beyond the ${MAX_RECORDS_PER_OBJECT}-per-object cap.`,
      });
    }

    return (
      <div className="reveal flex flex-col gap-6">
        <div>
          <h1 className="font-semibold text-3xl tracking-[-0.025em]">Your CRM has arrived.</h1>
          <p className="mt-2 text-[0.9375rem] text-muted-foreground tabular-nums">
            {recordsRead != null && (
              <>
                <span className="font-medium text-foreground">{recordsRead.toLocaleString()}</span>{' '}
                records read ·{' '}
              </>
            )}
            <span className="font-medium text-foreground">{(importedN ?? 0).toLocaleString()}</span>{' '}
            imported ·{' '}
            <span className="font-medium text-foreground">
              {(referencesN ?? 0).toLocaleString()}
            </span>{' '}
            references linked
          </p>
        </div>

        <StatsRow stats={stats} />

        {/* Sync report — one instrument card per pipeline stage. */}
        <div>
          <p className="mb-2 font-semibold text-[10.5px] text-muted-foreground uppercase tracking-[0.12em]">
            Sync report
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {steps.map((s) => (
              <div
                key={s.name}
                className="flex flex-col gap-1.5 rounded-lg border border-border bg-card p-4 shadow-xs"
              >
                <div className="flex items-center gap-2">
                  {s.state === 'ok' ? (
                    <Check className="size-3.5 text-[var(--success)]" />
                  ) : (
                    <AlertTriangle className="size-3.5 text-[var(--warning)]" />
                  )}
                  <span className="font-semibold text-sm">{s.name}</span>
                </div>
                <div className="font-medium text-xl tabular-nums tracking-[-0.01em]">
                  {s.big}{' '}
                  {s.of && (
                    <span className="font-normal text-base text-muted-foreground">{s.of}</span>
                  )}
                </div>
                <p className="text-muted-foreground text-xs leading-snug">{s.detail}</p>
                <span className="mt-auto block h-1 overflow-hidden rounded-full bg-muted">
                  <span
                    className={cn(
                      'block h-full rounded-full',
                      s.state === 'ok' ? 'bg-[var(--accent)]' : 'bg-[var(--warning)]',
                    )}
                    style={{ width: `${s.pct}%` }}
                  />
                </span>
              </div>
            ))}
          </div>
        </div>

        {gaps.length > 0 && (
          <div className="rounded-lg border border-[var(--warning-border)] bg-[var(--warning-bg)] px-5 py-4">
            <p className="flex items-center gap-2 font-semibold text-[var(--warning)] text-sm">
              <AlertTriangle className="size-3.5" />
              What didn't come across
            </p>
            <ul className="mt-2 flex flex-col gap-1 text-sm">
              {gaps.map((g) => (
                <li key={g.text} className="text-foreground/80 tabular-nums">
                  {g.text}{' '}
                  {g.anchor && (
                    <a href={g.anchor} className="font-medium text-link">
                      Review mapping →
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Per-object arrival cards. */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {activeObjects.map((o) => {
            const meta = o.meta as { targetKey?: string; labelPlural?: string };
            // recordCount is what Salesforce HOLDS (capped) — per-object
            // import success isn't tracked, so say "records", not "imported".
            const recordsRead = Math.min(o.recordCount, MAX_RECORDS_PER_OBJECT);
            return (
              <Link
                key={o.id}
                href={`/${meta.targetKey ?? o.sfObject}`}
                className="group flex flex-col rounded-lg border border-border bg-card p-4 shadow-xs transition-colors hover:border-[var(--border-strong)] hover:bg-muted/40"
              >
                <ObjChip label={meta.labelPlural ?? o.sfLabel ?? o.sfObject} size={26} />
                <span className="mt-3 font-medium text-sm">
                  {meta.labelPlural ?? o.sfLabel ?? o.sfObject}
                </span>
                <span className="text-muted-foreground text-xs tabular-nums">
                  {recordsRead.toLocaleString()} {recordsRead === 1 ? 'record' : 'records'}
                </span>
                <span className="mt-3 inline-flex items-center gap-1 font-medium text-link text-sm">
                  Browse
                  <ArrowRight className="size-3 transition-transform group-hover:translate-x-0.5" />
                </span>
              </Link>
            );
          })}
        </div>

        <div className="migrate-beamline" />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {mayRun && (
              <Button variant="outline" onClick={onStartOver}>
                <RefreshCw />
                Run again
              </Button>
            )}
            <Link href="/setup/integrations">
              <Button variant="ghost">Manage connection</Button>
            </Link>
          </div>
          <Link href="/pipeline">
            <Button>
              Go to your pipeline
              <ArrowRight />
            </Button>
          </Link>
        </div>

        <div id="mapping">{mappingCards}</div>
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
