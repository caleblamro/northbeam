'use client';

// Salesforce migration — one step. Connect an org and the product migrates
// itself: discover → auto-map → import run as one continuous chain, with
// mapping review as an optional drill-in on the live screen. Orchestration
// lives in components/northbeam/migrate-flow; this page only gates on the
// connection.

import { ConnectScreen } from '@/components/northbeam/migrate-connect';
import { MigrateFlow } from '@/components/northbeam/migrate-flow';
import { LoadingScreen } from '@/components/ui/loading-screen';
import { trpc } from '@/lib/api';

export default function MigratePage() {
  const status = trpc.salesforce.status.useQuery();

  if (status.isLoading) return <LoadingScreen size="lg" />;
  if (!status.data?.connected) {
    return (
      <ConnectScreen
        oauthConfigured={status.data?.oauthConfigured ?? false}
        status={status.data?.status ?? null}
      />
    );
  }
  return <MigrateFlow />;
}
