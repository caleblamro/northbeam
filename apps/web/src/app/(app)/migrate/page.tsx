'use client';

// Salesforce migration wizard, wired to the real pipeline:
// connect (OAuth or dev token) → pick objects → review the auto-mapping →
// execute → live progress → summary.

import { ObjChip } from '@/components/northbeam/app-bits';
import { EmptyState } from '@/components/northbeam/empty-state';
import { SectionCard } from '@/components/northbeam/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { LoadingScreen } from '@/components/ui/loading-screen';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { trpc } from '@/lib/api';
import {
  AlertCircle,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

export default function MigratePage() {
  const status = trpc.salesforce.status.useQuery();
  const latest = trpc.salesforce.latestRun.useQuery(undefined, {
    enabled: Boolean(status.data?.connected),
  });
  const [override, setOverride] = useState<string | null>(null);
  const runId = override === 'new' ? null : (override ?? latest.data?.id ?? null);

  if (status.isLoading || (status.data?.connected && latest.isLoading)) {
    return <Centered spinner />;
  }
  if (!status.data?.connected) {
    return (
      <ConnectScreen
        oauthConfigured={status.data?.oauthConfigured ?? false}
        status={status.data?.status ?? null}
      />
    );
  }
  if (!runId) return <DiscoverScreen onCreated={setOverride} />;
  return <RunScreen key={runId} runId={runId} onStartOver={() => setOverride('new')} />;
}

function ConnectScreen({
  oauthConfigured,
  status,
}: {
  oauthConfigured: boolean;
  status: string | null;
}) {
  return (
    <SectionCard title="Connect your Salesforce org" className="max-w-2xl">
      <p className="text-muted-foreground text-sm leading-relaxed">
        Northbeam reads your objects, fields, record types, and records through the Salesforce
        API, maps them onto native objects, and imports everything in one run.
      </p>
      {status === 'error' && (
        <p className="mt-3 text-destructive text-sm">
          The stored connection token expired or was revoked — reconnect to continue.
        </p>
      )}
      {oauthConfigured ? (
        <a href={`${API_URL}/api/salesforce/oauth/start`} className="mt-5 inline-block">
          <Button>
            <RefreshCw />
            Connect Salesforce
          </Button>
        </a>
      ) : (
        <div className="mt-5 rounded-md border border-border bg-muted/40 px-4 py-3 text-foreground text-sm">
          <span className="font-medium">Dev setup:</span> no Connected App configured. Seed a
          connection from your sf CLI session instead:
          <pre className="mt-2 font-mono text-muted-foreground text-xs">
            pnpm --filter @northbeam/api sf:dev-connect &lt;orgId&gt; testOrg
          </pre>
        </div>
      )}
    </SectionCard>
  );
}

function DiscoverScreen({ onCreated }: { onCreated: (runId: string) => void }) {
  const discover = trpc.salesforce.discover.useQuery();
  const createRun = trpc.salesforce.createRun.useMutation({
    onSuccess: (r) => onCreated(r.runId),
  });
  const [picked, setPicked] = useState<Set<string>>(new Set());

  if (discover.isError) {
    return (
      <EmptyState
        icon={AlertCircle}
        title="Couldn't reach Salesforce"
        body={discover.error.message}
      />
    );
  }
  if (!discover.data) return <Centered spinner label="Reading your org's objects…" />;

  const toggle = (name: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(name)) n.delete(name);
      else n.add(name);
      return n;
    });

  return (
    <div className="flex flex-col gap-4">
      <div className="mb-1 flex items-center gap-3">
        <p className="text-muted-foreground text-sm">
          {discover.data.length} importable objects · {picked.size} selected
        </p>
        <div className="flex-1" />
        <Button
          disabled={picked.size === 0 || createRun.isPending}
          onClick={() => createRun.mutate({ objects: [...picked] })}
        >
          {createRun.isPending ? <Loader2 className="animate-spin" /> : <ArrowRight />}
          Analyze {picked.size || ''} object{picked.size === 1 ? '' : 's'}
        </Button>
      </div>
      {createRun.isPending && (
        <Centered spinner label="Describing objects and sampling records — this takes a moment…" />
      )}
      <Card className="gap-0 overflow-hidden py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Object</TableHead>
              <TableHead>API name</TableHead>
              <TableHead>Maps to</TableHead>
              <TableHead className="text-right">Records</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {discover.data.map((o) => (
              <TableRow key={o.name} className="cursor-pointer" onClick={() => toggle(o.name)}>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Checkbox checked={picked.has(o.name)} onCheckedChange={() => toggle(o.name)} />
                </TableCell>
                <TableCell className="font-medium text-foreground">{o.labelPlural}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{o.name}</TableCell>
                <TableCell>
                  <Badge tone={o.standardTarget ? 'relation' : 'neutral'} size="sm">
                    {o.standardTarget ? `→ ${o.standardTarget}` : 'new object'}
                  </Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {o.count?.toLocaleString() ?? '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function RunScreen({ runId, onStartOver }: { runId: string; onStartOver: () => void }) {
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

  if (run.isLoading || !run.data) return <Centered spinner />;
  const { run: r, objects } = run.data;
  const stats = r.stats ?? {};

  if (r.status === 'running') {
    return (
      <SectionCard
        title={`Importing${stats.currentObject ? ` — ${stats.currentObject}` : '…'}`}
        className="max-w-3xl"
      >
        <StatsRow stats={stats} />
      </SectionCard>
    );
  }

  if (r.status === 'completed' || r.status === 'failed') {
    return (
      <SectionCard
        title={r.status === 'completed' ? 'Migration complete' : 'Migration failed'}
        className="max-w-3xl"
      >
        {r.status === 'failed' && stats.error && (
          <p className="mb-3 text-destructive text-sm">{stats.error}</p>
        )}
        <StatsRow stats={stats} />
        <div className="mt-4 flex flex-wrap gap-2">
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
    <div className="flex flex-col gap-4">
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

type RunObject = {
  id: string;
  sfObject: string;
  sfLabel: string | null;
  action: string;
  recordCount: number;
  meta: Record<string, unknown>;
  fields: Array<{
    id: string;
    sfField: string;
    sfType: string | null;
    status: string;
    confidence: number;
    meta: Record<string, unknown>;
  }>;
};

function ObjectMappingCard({
  object: o,
  onToggleField,
}: {
  object: RunObject;
  onToggleField: (id: string, current: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const meta = o.meta as { targetKey?: string };
  const counts = useMemo(
    () => ({
      mapped: o.fields.filter((f) => f.status === 'mapped').length,
      review: o.fields.filter((f) => f.status === 'review').length,
      skip: o.fields.filter((f) => f.status === 'skip').length,
    }),
    [o.fields],
  );

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <button
        type="button"
        className="flex w-full items-center gap-3 border-b bg-muted/40 px-5 py-3 text-left transition-colors hover:bg-muted/60"
        onClick={() => setOpen((v) => !v)}
      >
        <ObjChip label={o.sfLabel ?? o.sfObject} size={22} />
        <span className="font-medium text-foreground text-sm">
          {o.sfObject} → {meta.targetKey ?? '?'}
        </span>
        <Badge tone="neutral" size="sm">
          {o.recordCount.toLocaleString()} records
        </Badge>
        <span className="ml-auto text-muted-foreground text-xs tabular-nums">
          {counts.mapped} mapped · {counts.review} review · {counts.skip} skip
        </span>
        {open ? (
          <ChevronUp className="size-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="size-4 text-muted-foreground" />
        )}
      </button>
      {open && (
        <div className="max-h-[420px] overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Salesforce field</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Northbeam field</TableHead>
                <TableHead className="text-right">Populated</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {o.fields.map((f) => {
                const m = f.meta as {
                  key?: string;
                  type?: string;
                  reason?: string;
                  populatedPct?: number | null;
                };
                return (
                  <TableRow key={f.id}>
                    <TableCell className="font-mono text-xs">{f.sfField}</TableCell>
                    <TableCell>
                      <Badge tone="neutral" size="sm">
                        {f.sfType}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {f.status === 'skip' ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span>
                          {m.key}{' '}
                          <span className="text-muted-foreground">({m.type})</span>
                        </span>
                      )}
                      {m.reason && (
                        <div className="text-muted-foreground text-xs">{m.reason}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {m.populatedPct == null ? '—' : `${m.populatedPct}%`}
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        size="sm"
                        variant={f.status === 'mapped' ? 'default' : f.status === 'review' ? 'outline' : 'ghost'}
                        onClick={() => onToggleField(f.id, f.status)}
                      >
                        {f.status}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}

function StatsRow({ stats }: { stats: Record<string, unknown> }) {
  const items: Array<[string, unknown]> = [
    ['Objects', stats.objects],
    ['Fields', stats.fields],
    ['Records read', stats.records],
    ['Imported', stats.imported],
    ['References linked', stats.refsResolved],
  ];
  return (
    <div className="flex flex-wrap gap-x-8 gap-y-4">
      {items.map(([label, v]) => (
        <div key={label}>
          <div className="font-medium text-[0.6875rem] text-muted-foreground uppercase tracking-[0.14em]">
            {label}
          </div>
          <div className="mt-1 font-medium text-foreground text-xl tabular-nums tracking-[-0.02em]">
            {typeof v === 'number' ? v.toLocaleString() : '—'}
          </div>
        </div>
      ))}
    </div>
  );
}

function Centered({ spinner, label }: { spinner?: boolean; label?: string }) {
  if (spinner && !label) return <LoadingScreen size="lg" />;
  return (
    <div className="grid place-items-center gap-3 p-16 text-center">
      {spinner && <Loader2 className="size-5 animate-spin text-muted-foreground" />}
      {label && <span className="text-muted-foreground text-sm">{label}</span>}
    </div>
  );
}
