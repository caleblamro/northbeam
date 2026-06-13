'use client';

import { MetricStrip } from '@/components/northbeam/app-bits';
import { PageActions } from '@/components/northbeam/app-shell';
import { Icon } from '@/components/northbeam/icons';
import { Spinner } from '@/components/northbeam/primitives';
import { Button, MenuButton } from '@/components/northbeam/button-legacy';
import { trpc } from '@/lib/api';
import { fmtMoney } from '@/lib/mock-crm';

// Activity subtype → icon name. The activity object has a `type` picklist
// (call/email/note/meeting/task) seeded into every workspace.
const ACT_ICON: Record<string, string> = {
  call: 'phone',
  email: 'envelope-simple',
  note: 'note-pencil',
  meeting: 'calendar-blank',
  task: 'check-circle',
};

function timeAgo(date: Date): string {
  const ms = Date.now() - new Date(date).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(date).toLocaleDateString();
}

export default function HomePage() {
  const summary = trpc.home.summary.useQuery();

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
            label: 'Accounts',
            value: summary.data ? summary.data.counts.accounts.toLocaleString() : '—',
          },
          {
            label: 'Contacts',
            value: summary.data ? summary.data.counts.contacts.toLocaleString() : '—',
          },
          {
            label: 'Open pipeline',
            value: summary.data ? fmtMoney(summary.data.pipelineValue) : '—',
            delta: summary.data
              ? { text: `${summary.data.counts.deals} deals`, tone: 'brand' }
              : undefined,
          },
          {
            label: 'Deals',
            value: summary.data ? summary.data.counts.deals.toLocaleString() : '—',
          },
        ]}
      />

      <div className="rep-grid" style={{ marginTop: 22 }}>
        <div className="panel">
          <div className="panel__h">
            <Icon name="lightning" size={17} />
            <h3>Recent activity</h3>
            <span className="right">
              <Button variant="link" iconRight="arrow-right" onClick={() => undefined}>
                View all
              </Button>
            </span>
          </div>
          <div className="panel__body">
            {summary.isLoading && (
              <div style={{ display: 'grid', placeItems: 'center', padding: 24 }}>
                <Spinner />
              </div>
            )}
            {summary.data && summary.data.recentActivities.length === 0 && (
              <div style={{ color: 'var(--ink-muted)', padding: 12 }}>
                No activities yet. Log a call, send an email, or run a Salesforce migration.
              </div>
            )}
            {summary.data && summary.data.recentActivities.length > 0 && (
              <div className="tl">
                {summary.data.recentActivities.map((a) => (
                  <div className="tl-item" key={a.id}>
                    <span className="tl-item__dot">
                      <Icon name={(a.subtype && ACT_ICON[a.subtype]) || 'lightning'} />
                    </span>
                    <div className="tl-item__head">
                      <b>{a.name}</b>
                      <span className="tl-item__time">{timeAgo(a.createdAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div className="panel">
            <div className="panel__h">
              <Icon name="funnel" size={17} />
              <h3>Pipeline value</h3>
            </div>
            <div className="panel__body">
              {summary.isLoading && <Spinner />}
              {summary.data && (
                <>
                  <div
                    style={{
                      fontSize: 'var(--text-2xl)',
                      fontWeight: 600,
                      letterSpacing: '-0.02em',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {fmtMoney(summary.data.pipelineValue)}
                  </div>
                  <div style={{ color: 'var(--ink-muted)', marginTop: 4 }}>
                    Across {summary.data.counts.deals} open deals.
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="panel">
            <div className="panel__h">
              <Icon name="users-three" size={17} />
              <h3>Workspace at a glance</h3>
            </div>
            <div className="panel__body">
              {summary.isLoading && <Spinner />}
              {summary.data && (
                <div className="kv">
                  <dt>Accounts</dt>
                  <dd>{summary.data.counts.accounts.toLocaleString()}</dd>
                  <dt>Contacts</dt>
                  <dd>{summary.data.counts.contacts.toLocaleString()}</dd>
                  <dt>Deals</dt>
                  <dd>{summary.data.counts.deals.toLocaleString()}</dd>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
