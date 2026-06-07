'use client';

import { PageActions } from '@/components/northbeam/app-shell';

import { Avatar } from '@/components/northbeam/primitives';
import { Button } from '@/components/ui/button';
import { DEALS, STAGE_ORDER, accountById, fmtMoney } from '@/lib/mock-crm';
import { DEAL_STAGE_TONE } from '@/lib/tones';

export default function PipelinePage() {
  return (
    <>
      <PageActions>
        <Button variant="primary" icon="plus">
          New deal
        </Button>
      </PageActions>

      <div className="kanban">
        {STAGE_ORDER.map((stage) => {
          const deals = DEALS.filter((d) => d.stage === stage);
          const sum = deals.reduce((s, d) => s + d.amount, 0);
          const tone = DEAL_STAGE_TONE[stage];
          return (
            <div className="kan-col" key={stage}>
              <div className="kan-col__h">
                <span style={{ width: 8, height: 8, borderRadius: 99, background: tone.color }} />
                <b>{tone.label}</b>
                <span className="kan-col__count">{deals.length}</span>
              </div>
              <div className="kan-col__sum">{fmtMoney(sum)}</div>
              <div className="kan-col__body">
                {deals.map((d) => (
                  <div className="kan-card" key={d.id}>
                    <div className="kan-card__name">{d.name}</div>
                    <div className="kan-card__acct">{accountById(d.accountId)?.name}</div>
                    <div className="kan-card__foot">
                      <span className="kan-card__amt">{fmtMoney(d.amount)}</span>
                      <span style={{ marginLeft: 'auto' }} title={d.owner.name}>
                        <Avatar
                          name={d.owner.name}
                          className="cmdk__avatar"
                          style={{ width: 22, height: 22, fontSize: 9 }}
                        />
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
