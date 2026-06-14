'use client';

import { SectionCard } from '@/components/northbeam/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { trpc } from '@/lib/api';
import { ArrowRight, CloudUpload, Plug } from 'lucide-react';
import Link from 'next/link';

export default function IntegrationsSetupPage() {
  const status = trpc.salesforce.status.useQuery();
  const connected = status.data?.connected ?? false;

  return (
    <SectionCard title="Integrations">
      <div className="divide-y rounded-md border bg-card">
        <IntegrationRow
          icon={CloudUpload}
          name="Salesforce"
          body="One-click migration. Map objects + fields, then import."
          status={connected ? 'connected' : 'available'}
          cta={
            <Button asChild variant={connected ? 'outline' : 'default'}>
              <Link href="/migrate">
                {connected ? 'Open migration' : 'Connect Salesforce'}
                <ArrowRight className="size-4" />
              </Link>
            </Button>
          }
        />
      </div>
    </SectionCard>
  );
}

function IntegrationRow({
  icon: Icon,
  name,
  body,
  status,
  cta,
}: {
  icon: typeof Plug;
  name: string;
  body: string;
  status: 'connected' | 'available';
  cta: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 px-4 py-3.5">
      <div className="flex size-10 items-center justify-center rounded-md bg-muted">
        <Icon className="size-5 text-muted-foreground" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <div className="font-semibold text-foreground text-sm">{name}</div>
          {status === 'connected' && (
            <Badge tone="success" size="sm">
              Connected
            </Badge>
          )}
        </div>
        <div className="text-muted-foreground text-xs">{body}</div>
      </div>
      {cta}
    </div>
  );
}
