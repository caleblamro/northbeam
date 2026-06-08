'use client';

import { HealthDot, MetricStrip, StageTag } from '@/components/northbeam/app-bits';
import { PageActions } from '@/components/northbeam/app-shell';
import { Icon } from '@/components/northbeam/icons';
import { Button, MenuButton } from '@/components/ui/button';
import { ACCOUNTS, ACTIVITIES, DEALS, STAGE_ORDER, accountById, fmtMoney } from '@/lib/mock-crm';
import { DEAL_STAGE_TONE } from '@/lib/tones';

const ACT_ICON = {
  call: 'phone',
  email: 'envelope-simple',
  note: 'note-pencil',
  stage: 'arrows-clockwise',
  migration: 'upload-simple',
} as const;

export default function HomePage() {
  const open = DEALS.filter((d) => d.stage !== 'won' && d.stage !== 'lost');
  const pipelineValue = open.reduce((s, d) => s + d.amount, 0);
  const byStage = STAGE_ORDER.filter((s) => s !== 'won' && s !== 'lost').map((stage) => {
    const ds = open.filter((d) => d.stage === stage);
    return { stage, count: ds.length, sum: ds.reduce((s, d) => s + d.amount, 0) };
  });
  const maxSum = Math.max(...byStage.map((b) => b.sum), 1);
  const topDeals = [...open].sort((a, b) => b.amount - a.amount).slice(0, 5);

  return (
    <>
      <PageActions>
        <Button variant="secondary" icon="arrows-clockwise">
          Run migration
        </Button>
        <MenuButton
          variant="primary"
          icon="plus"
          items={[
            { heading: 'Create' },
            { icon: 'user-plus', label: 'Contact' },
            { icon: 'buildings', label: 'Account' },
            { icon: 'currency-circle-dollar', label: 'Deal' },
          ]}
        >
          New
        </MenuButton>
      </PageActions>

      <MetricStrip
        items={[
          {
            label: 'Open deals',
            value: open.length,
            delta: { text: '+6 this week', tone: 'success' },
          },
          {
            label: 'Pipeline value',
            value: fmtMoney(pipelineValue),
            delta: { text: '+12%', tone: 'success' },
          },
          {
            label: 'Contacts',
            value: '2,418',
            delta: { text: `${ACCOUNTS.length} accounts`, tone: 'brand' },
          },
          {
            label: 'Closing this month',
            value: '$320K',
            delta: { text: '9 deals', tone: 'warning' },
          },
        ]}
      />

      <div className="rep-grid" style={{ marginTop: 22 }}>
        {/* Recent activity */}
        <div className="panel">
          <div className="panel__h">
            <Icon name="lightning" size={17} />
            <h3>Recent activity</h3>
            <span className="right">
              <Button variant="link" iconRight="arrow-right">
                View all
              </Button>
            </span>
          </div>
          <div className="panel__body">
            <div className="tl">
              {ACTIVITIES.map((a) => (
                <div className="tl-item" key={a.id}>
                  <span className="tl-item__dot">
                    <Icon name={ACT_ICON[a.kind]} />
                  </span>
                  <div className="tl-item__head">
                    <b>{a.actor}</b>
                    <span style={{ color: 'var(--ink-secondary)' }}>{a.summary}</span>
                    <span className="tl-item__time">{a.time}</span>
                  </div>
                  {a.detail && <p>{a.detail}</p>}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div className="panel">
            <div className="panel__h">
              <Icon name="funnel" size={17} />
              <h3>Pipeline by stage</h3>
            </div>
            <div
              className="panel__body"
              style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
            >
              {byStage.map((b) => (
                <div key={b.stage}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
                    <StageTag stage={b.stage} />
                    <span
                      style={{
                        marginLeft: 'auto',
                        fontWeight: 600,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {fmtMoney(b.sum)}
                    </span>
                    <span style={{ color: 'var(--ink-muted)', fontSize: 'var(--text-sm)' }}>
                      {b.count} deals
                    </span>
                  </div>
                  <div
                    style={{
                      height: 6,
                      borderRadius: 99,
                      background: 'var(--surface-active)',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${(b.sum / maxSum) * 100}%`,
                        height: '100%',
                        borderRadius: 99,
                        background: DEAL_STAGE_TONE[b.stage].fg,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="panel">
            <div className="panel__h">
              <Icon name="currency-circle-dollar" size={17} />
              <h3>Top open deals</h3>
            </div>
            <div className="panel__body" style={{ paddingTop: 4, paddingBottom: 4 }}>
              {topDeals.map((d) => (
                <div className="rep-list-item" key={d.id}>
                  <span className="rep-list-item__ic">
                    <HealthDot health={accountById(d.accountId)?.health ?? 'good'} />
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div
                      className="rep-name"
                      style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >
                      {d.name}
                    </div>
                    <div className="rep-meta">{accountById(d.accountId)?.name}</div>
                  </div>
                  <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
                    {fmtMoney(d.amount)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
