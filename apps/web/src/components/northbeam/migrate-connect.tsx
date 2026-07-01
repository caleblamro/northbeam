// Step 1 of the migration wizard: connect a Salesforce org via OAuth, or fall
// back to the dev CLI token flow when no Connected App is configured.

import { InsightCard } from '@/components/northbeam/insight-card';
import { SectionCard } from '@/components/northbeam/section-card';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { AlertCircle, Plug, RefreshCw } from 'lucide-react';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

export function ConnectScreen({
  oauthConfigured,
  status,
}: {
  oauthConfigured: boolean;
  status: string | null;
}) {
  return (
    <div className="reveal flex max-w-2xl flex-col gap-4">
      <InsightCard
        icon={Plug}
        tone="accent"
        title="Bring your Salesforce data across"
        body="Northbeam reads your objects, fields, record types, and records through the Salesforce API, maps them onto native objects, and imports everything in one run."
      />
      <SectionCard title="Connect your Salesforce org">
        {status === 'error' && (
          <Callout variant="danger" icon={AlertCircle} className="mb-4">
            The stored connection token expired or was revoked — reconnect to continue.
          </Callout>
        )}
        {oauthConfigured ? (
          <a href={`${API_URL}/api/salesforce/oauth/start`} className="inline-block">
            <Button>
              <RefreshCw />
              Connect Salesforce
            </Button>
          </a>
        ) : (
          <div className="rounded-md border border-border bg-muted/40 px-4 py-3 text-foreground text-sm">
            <span className="font-medium">Dev setup:</span> no Connected App configured. Seed a
            connection from your sf CLI session instead:
            <pre className="mt-2 font-mono text-muted-foreground text-xs">
              pnpm --filter @northbeam/api sf:dev-connect &lt;orgId&gt; testOrg
            </pre>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
