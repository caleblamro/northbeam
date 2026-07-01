'use client';

// Salesforce migration wizard, wired to the real pipeline:
// connect (OAuth or dev token) → pick objects → review the auto-mapping →
// execute → live progress → summary. This page is orchestration only — each
// screen lives in components/northbeam/migrate-*.

import { ConnectScreen } from '@/components/northbeam/migrate-connect';
import { DiscoverScreen } from '@/components/northbeam/migrate-discover';
import { RunScreen } from '@/components/northbeam/migrate-run';
import { LoadingScreen } from '@/components/ui/loading-screen';
import { trpc } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useState } from 'react';

const STEPS = ['Connect', 'Pick objects', 'Map & import'] as const;

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="mb-6 flex items-center gap-2 text-xs">
      {STEPS.map((label, i) => (
        <div key={label} className="flex items-center gap-2">
          <span
            className={cn(
              'flex size-5 items-center justify-center rounded-full font-medium tabular-nums transition-colors',
              i <= current
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground',
            )}
          >
            {i + 1}
          </span>
          <span
            className={cn(i === current ? 'font-medium text-foreground' : 'text-muted-foreground')}
          >
            {label}
          </span>
          {i < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-border" />}
        </div>
      ))}
    </div>
  );
}

export default function MigratePage() {
  const status = trpc.salesforce.status.useQuery();
  const latest = trpc.salesforce.latestRun.useQuery(undefined, {
    enabled: Boolean(status.data?.connected),
  });
  const [override, setOverride] = useState<string | null>(null);
  const runId = override === 'new' ? null : (override ?? latest.data?.id ?? null);

  if (status.isLoading || (status.data?.connected && latest.isLoading)) {
    return <LoadingScreen size="lg" />;
  }
  if (!status.data?.connected) {
    return (
      <div>
        <StepIndicator current={0} />
        <ConnectScreen
          oauthConfigured={status.data?.oauthConfigured ?? false}
          status={status.data?.status ?? null}
        />
      </div>
    );
  }
  if (!runId) {
    return (
      <div>
        <StepIndicator current={1} />
        <DiscoverScreen onCreated={setOverride} />
      </div>
    );
  }
  return (
    <div>
      <StepIndicator current={2} />
      <RunScreen key={runId} runId={runId} onStartOver={() => setOverride('new')} />
    </div>
  );
}
