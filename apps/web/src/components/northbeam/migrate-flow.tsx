'use client';

// One-step migration orchestrator ("the CRM that migrates itself"): once the
// org is connected this chains discover → createRun with every discovered
// object → RunScreen, which auto-executes and shows live progress with
// optional mapping review. A previous run found on load is resumed (running)
// or summarized (completed/failed) instead of auto-starting a fresh import on
// every page visit.

import { EmptyState } from '@/components/northbeam/empty-state';
import { RunScreen } from '@/components/northbeam/migrate-run';
import { SectionCard } from '@/components/northbeam/section-card';
import { Button } from '@/components/ui/button';
import { LoadingScreen } from '@/components/ui/loading-screen';
import { trpc } from '@/lib/api';
import { useCan } from '@/lib/can';
import { AlertCircle, Loader2, ShieldAlert } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

// createRun caps a run at 25 objects; discover returns them sorted by record
// count descending, so the biggest objects make the cut.
const MAX_RUN_OBJECTS = 25;

/** Discover the org's objects and immediately analyze ALL of them into a new
 *  run — no picking, no confirmation. Hands the run id up when ready. */
function AutoStart({ onCreated }: { onCreated: (runId: string) => void }) {
  const discover = trpc.salesforce.discover.useQuery();
  const createRun = trpc.salesforce.createRun.useMutation({
    onSuccess: (r) => onCreated(r.runId),
  });
  const { mutate: createRunMutate } = createRun;
  const startedRef = useRef(false);

  const found = discover.data;
  useEffect(() => {
    if (!found || found.length === 0 || startedRef.current) return;
    startedRef.current = true;
    createRunMutate({ objects: found.slice(0, MAX_RUN_OBJECTS).map((o) => o.name) });
  }, [found, createRunMutate]);

  if (discover.isError) {
    return (
      <EmptyState
        icon={AlertCircle}
        title="Couldn't reach Salesforce"
        body={discover.error.message}
      />
    );
  }
  if (createRun.isError) {
    return (
      <EmptyState
        icon={AlertCircle}
        title="Couldn't analyze your Salesforce org"
        body={createRun.error.message}
        action={
          <Button
            onClick={() => {
              if (found)
                createRunMutate({ objects: found.slice(0, MAX_RUN_OBJECTS).map((o) => o.name) });
            }}
          >
            Try again
          </Button>
        }
      />
    );
  }
  if (found && found.length === 0) {
    return (
      <EmptyState
        icon={AlertCircle}
        title="Nothing to import"
        body="No importable objects were found in the connected Salesforce org."
      />
    );
  }
  return (
    <SectionCard title="Migrating your Salesforce" className="reveal max-w-3xl">
      <div className="flex items-center gap-3 text-muted-foreground text-sm">
        <Loader2 className="size-4 animate-spin" />
        {!found
          ? 'Reading the objects in your org…'
          : `Analyzing ${Math.min(found.length, MAX_RUN_OBJECTS)} objects and mapping their fields — this takes a moment…`}
      </div>
    </SectionCard>
  );
}

export function MigrateFlow() {
  const latest = trpc.salesforce.latestRun.useQuery();
  const mayRun = useCan('migration.run');
  const [override, setOverride] = useState<string | null>(null);
  const runId = override === 'new' ? null : (override ?? latest.data?.id ?? null);

  if (latest.isLoading) return <LoadingScreen size="lg" />;
  if (!runId) {
    // Starting a run (discover + createRun) is admin+ — don't auto-fire live
    // Salesforce calls for roles the backend will reject anyway.
    if (!mayRun) {
      return (
        <EmptyState
          icon={ShieldAlert}
          title="Waiting for an admin"
          body="Analyzing and importing a Salesforce org is limited to workspace admins. Ask an admin to start the migration — progress will show up here."
        />
      );
    }
    return <AutoStart onCreated={setOverride} />;
  }
  return <RunScreen key={runId} runId={runId} onStartOver={() => setOverride('new')} />;
}
