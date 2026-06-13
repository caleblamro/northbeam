'use client';

import { PageActions } from '@/components/northbeam/app-shell';

import { Icon, type IconName } from '@/components/northbeam/icons';
import { Avatar, Badge } from '@/components/northbeam/primitives';
import { Button } from '@/components/northbeam/button-legacy';

type Dash = {
  id: string;
  name: string;
  desc: string;
  icon: IconName;
  tiles: number;
  owner: string;
  shared?: boolean;
};

const DASHBOARDS: Dash[] = [
  {
    id: 'd1',
    name: 'Revenue overview',
    desc: 'Pipeline, bookings, and forecast at a glance.',
    icon: 'chart-line-up',
    tiles: 8,
    owner: 'Jordan Mills',
    shared: true,
  },
  {
    id: 'd2',
    name: 'Sales activity',
    desc: 'Calls, emails, and meetings by rep this week.',
    icon: 'lightning',
    tiles: 6,
    owner: 'Aisha Khan',
  },
  {
    id: 'd3',
    name: 'Account health',
    desc: 'At-risk accounts and renewal exposure.',
    icon: 'buildings',
    tiles: 5,
    owner: 'Ravi Teja',
    shared: true,
  },
  {
    id: 'd4',
    name: 'Migration audit',
    desc: 'Records imported and field-mapping confidence.',
    icon: 'arrows-clockwise',
    tiles: 4,
    owner: 'System',
  },
];

export default function DashboardsPage() {
  return (
    <>
      <PageActions>
        <Button variant="primary" icon="plus">
          New dashboard
        </Button>
      </PageActions>

      <div className="obj-grid">
        {DASHBOARDS.map((d) => (
          <button
            type="button"
            className="obj-card"
            key={d.id}
            style={{ textAlign: 'left', font: 'inherit' }}
          >
            <div className="obj-card__top">
              <span className="obj-card__icon" style={{ background: 'var(--ai-grad)' }}>
                <Icon name={d.icon} size={20} />
              </span>
              <div style={{ minWidth: 0 }}>
                <h3>{d.name}</h3>
                <div className="obj-card__api">{d.tiles} tiles</div>
              </div>
              {d.shared && (
                <span style={{ marginLeft: 'auto' }}>
                  <Badge variant="brand">Shared</Badge>
                </span>
              )}
            </div>
            <p
              style={{
                margin: '0 0 4px',
                fontSize: 'var(--text-sm)',
                color: 'var(--ink-muted)',
                lineHeight: 1.5,
                minHeight: 34,
              }}
            >
              {d.desc}
            </p>
            <div className="obj-card__meta">
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                <Avatar
                  name={d.owner}
                  className="cmdk__avatar"
                  style={{ width: 20, height: 20, fontSize: 8 }}
                />
                {d.owner}
              </span>
            </div>
          </button>
        ))}

        <button
          type="button"
          className="obj-card"
          style={{
            textAlign: 'left',
            font: 'inherit',
            border: '1.5px dashed var(--border-strong)',
            background: 'transparent',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            color: 'var(--ink-muted)',
            minHeight: 150,
          }}
        >
          <Icon name="plus" size={22} />
          <span style={{ fontWeight: 600, color: 'var(--ink)' }}>Create dashboard</span>
        </button>
      </div>
    </>
  );
}
