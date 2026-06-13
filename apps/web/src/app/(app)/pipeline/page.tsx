'use client';

import { PageActions } from '@/components/northbeam/app-shell';
import { Spinner } from '@/components/northbeam/primitives';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { trpc } from '@/lib/api';
import { fmtMoney } from '@/lib/mock-crm';
import { DEAL_STAGE_TONE, type DealStage } from '@/lib/tones';
import { Plus } from 'lucide-react';

const STAGE_ORDER: DealStage[] = ['new', 'qualified', 'negotiation', 'won', 'lost'];

export default function PipelinePage() {
  const list = trpc.record.list.useQuery({ objectKey: 'deal', limit: 200 });

  if (list.isLoading) {
    return (
      <div className="grid place-items-center p-12">
        <Spinner style={{ color: 'var(--brand)' }} />
      </div>
    );
  }

  const rows = list.data?.rows ?? [];
  const refLabels = list.data?.refLabels ?? {};

  const grouped = STAGE_ORDER.map((stage) => {
    const deals = rows.filter((r) => (r.data.stage as string | undefined) === stage);
    const sum = deals.reduce((s, d) => s + (Number(d.data.amount ?? 0) || 0), 0);
    return { stage, deals, sum };
  });

  return (
    <>
      <PageActions>
        <Button>
          <Plus />
          New deal
        </Button>
      </PageActions>

      <div className="flex gap-3.5 overflow-x-auto pb-2">
        {grouped.map(({ stage, deals, sum }) => {
          const tone = DEAL_STAGE_TONE[stage];
          return (
            <Card key={stage} className="w-72 shrink-0 gap-0 bg-muted/30 py-0">
              <CardHeader className="border-b px-3.5 py-3">
                <div className="flex items-center gap-2">
                  <span
                    className="size-2 rounded-full"
                    style={{ background: tone.fg }}
                    aria-hidden="true"
                  />
                  <span className="font-semibold text-sm">{tone.label}</span>
                  <span className="ml-auto rounded-full bg-secondary px-2 py-0.5 font-semibold text-xs">
                    {deals.length}
                  </span>
                </div>
                <p className="text-muted-foreground text-sm tabular-nums">{fmtMoney(sum * 100)}</p>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 px-2 py-2.5">
                {deals.map((d) => {
                  const accountId = d.data.account as string | undefined;
                  const accountLabel = accountId
                    ? (refLabels[accountId] ?? 'Unknown account')
                    : null;
                  const amount = Number(d.data.amount ?? 0) || 0;
                  return (
                    <Card key={d.id} className="cursor-grab gap-1 py-3 shadow-xs hover:shadow-sm">
                      <div className="px-3 font-semibold text-foreground text-sm">{d.name}</div>
                      {accountLabel && (
                        <div className="px-3 text-muted-foreground text-xs">{accountLabel}</div>
                      )}
                      <div className="mt-1 px-3 font-semibold text-foreground tabular-nums">
                        {fmtMoney(amount * 100)}
                      </div>
                    </Card>
                  );
                })}
                {deals.length === 0 && (
                  <p className="py-4 text-center text-muted-foreground text-sm">None</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}
