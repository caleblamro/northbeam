'use client';

import { PageActions } from '@/components/northbeam/app-shell';
import { Spinner } from '@/components/northbeam/primitives';
import { Button } from '@/components/northbeam/button-legacy';
import { trpc } from '@/lib/api';
import { fmtMoney } from '@/lib/mock-crm';
import { DEAL_STAGE_TONE, type DealStage } from '@/lib/tones';

const STAGE_ORDER: DealStage[] = ['new', 'qualified', 'negotiation', 'won', 'lost'];

export default function PipelinePage() {
  const list = trpc.record.list.useQuery({ objectKey: 'deal', limit: 200 });

  if (list.isLoading) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', padding: 40 }}>
        <Spinner />
      </div>
    );
  }

  const rows = list.data?.rows ?? [];
  const refLabels = list.data?.refLabels ?? {};

  // Group deals by stage. `stage` is a picklist field; values match STAGE_ORDER.
  const grouped = STAGE_ORDER.map((stage) => {
    const deals = rows.filter((r) => (r.data.stage as string | undefined) === stage);
    const sum = deals.reduce((s, d) => s + (Number(d.data.amount ?? 0) || 0), 0);
    return { stage, deals, sum };
  });

  return (
    <>
      <PageActions>
        <Button variant="primary" icon="plus">
          New deal
        </Button>
      </PageActions>

      <div className="kanban">
        {grouped.map(({ stage, deals, sum }) => {
          const tone = DEAL_STAGE_TONE[stage];
          return (
            <div className="kan-col" key={stage}>
              <div className="kan-col__h">
                <span style={{ width: 8, height: 8, borderRadius: 99, background: tone.fg }} />
                <b>{tone.label}</b>
                <span className="kan-col__count">{deals.length}</span>
              </div>
              <div className="kan-col__sum">{fmtMoney(sum * 100)}</div>
              <div className="kan-col__body">
                {deals.map((d) => {
                  const accountId = d.data.account as string | undefined;
                  const accountLabel = accountId
                    ? (refLabels[accountId] ?? 'Unknown account')
                    : null;
                  const amount = Number(d.data.amount ?? 0) || 0;
                  return (
                    <div className="kan-card" key={d.id}>
                      <div className="kan-card__name">{d.name}</div>
                      {accountLabel && <div className="kan-card__acct">{accountLabel}</div>}
                      <div className="kan-card__foot">
                        <span className="kan-card__amt">{fmtMoney(amount * 100)}</span>
                      </div>
                    </div>
                  );
                })}
                {deals.length === 0 && (
                  <div
                    style={{
                      padding: 16,
                      textAlign: 'center',
                      color: 'var(--ink-subtle)',
                      fontSize: 'var(--text-sm)',
                    }}
                  >
                    None
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
