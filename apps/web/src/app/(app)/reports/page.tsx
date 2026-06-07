'use client';

import { PageActions } from '@/components/northbeam/app-shell';

import { Icon } from '@/components/northbeam/icons';
import { Badge } from '@/components/northbeam/primitives';
import { Button } from '@/components/ui/button';
import { fmtMoney } from '@/lib/mock-crm';
import { useState } from 'react';

const SUGGESTIONS = [
  'Show me deals slipping this quarter',
  'Which accounts are at risk of churn?',
  'Pipeline created vs. closed this month',
  'Top performing owners by win rate',
];

const INSIGHTS = [
  {
    tone: 'danger' as const,
    icon: 'warning-circle' as const,
    title: 'Meridian Health is at risk',
    body: 'No activity in 18 days on a $220K open deal. Health dropped to critical.',
  },
  {
    tone: 'warning' as const,
    icon: 'arrows-clockwise' as const,
    title: '3 deals slipped their close date',
    body: 'Northwind, Atlas, and Cobalt pushed past their forecasted close this week.',
  },
  {
    tone: 'success' as const,
    icon: 'chart-line-up' as const,
    title: 'Win rate up 8 points',
    body: 'Closed-won rate climbed to 41% over the last 30 days, led by Aisha and Jordan.',
  },
];

const FORECAST = [
  { m: 'Mar', actual: 120, fc: 0 },
  { m: 'Apr', actual: 165, fc: 0 },
  { m: 'May', actual: 142, fc: 0 },
  { m: 'Jun', actual: 188, fc: 0 },
  { m: 'Jul', actual: 0, fc: 210 },
  { m: 'Aug', actual: 0, fc: 245 },
];

const SAVED = [
  {
    name: 'Quarterly pipeline review',
    meta: 'Updated 2h ago · Jordan Mills',
    icon: 'funnel' as const,
  },
  {
    name: 'Win/loss by owner',
    meta: 'Updated yesterday · Aisha Khan',
    icon: 'chart-line-up' as const,
  },
  {
    name: 'Salesforce migration audit',
    meta: 'Updated 3 days ago · System',
    icon: 'upload-simple' as const,
  },
];

export default function ReportsPage() {
  const [q, setQ] = useState('');
  const max = Math.max(...FORECAST.map((f) => Math.max(f.actual, f.fc)));

  return (
    <>
      <PageActions>
        <Button variant="secondary" icon="plus">
          New report
        </Button>
      </PageActions>

      <div className="nlq">
        <Icon name="command" size={22} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Ask anything about your pipeline…"
        />
        <Button variant="primary" icon="arrow-right">
          Ask
        </Button>
      </div>
      <div className="nlq-chips">
        {SUGGESTIONS.map((s) => (
          <button type="button" key={s} className="nlq-chip" onClick={() => setQ(s)}>
            {s}
          </button>
        ))}
      </div>

      <div className="subhead" style={{ marginTop: 4 }}>
        Insights
        <Badge variant="brand" dot>
          Auto-detected
        </Badge>
      </div>
      <div className="grid grid--3" style={{ marginBottom: 28 }}>
        {INSIGHTS.map((i) => (
          <div className="insight" key={i.title}>
            <span className={`insight__ic insight__ic--${i.tone}`}>
              <Icon name={i.icon} size={19} />
            </span>
            <div style={{ minWidth: 0 }}>
              <h4>{i.title}</h4>
              <p>{i.body}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="rep-grid">
        <div className="panel">
          <div className="panel__h">
            <Icon name="chart-line-up" size={17} />
            <h3>Revenue forecast</h3>
            <span className="right">
              <Badge variant="brand">AI projected</Badge>
            </span>
          </div>
          <div className="panel__body">
            <div className="fc">
              {FORECAST.map((f) => {
                const v = f.actual || f.fc;
                return (
                  <div className="fc-col" key={f.m}>
                    <div
                      className={`fc-bar ${f.fc ? 'fc-bar--fc' : ''}`}
                      style={{ height: `${(v / max) * 100}%` }}
                    />
                    <small>{f.m}</small>
                  </div>
                );
              })}
            </div>
            <div className="fc-legend">
              <span>
                <i style={{ background: 'var(--brand)' }} />
                Actual
              </span>
              <span>
                <i style={{ background: 'var(--ai)' }} />
                Forecast
              </span>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div className="panel">
            <div className="panel__h">
              <Icon name="lightning" size={17} />
              <h3>What changed this week</h3>
            </div>
            <div className="panel__body">
              <p className="narr">
                Pipeline grew <span className="up">+{fmtMoney(18_000_00)}</span> with 4 new deals
                created. Two deals closed won (<b>Brightpath</b>, <b>Cobalt pilot</b>), while{' '}
                <span className="down">3 slipped</span> past their close date. Net new pipeline is
                up <span className="up">12%</span> month-over-month.
              </p>
            </div>
          </div>
          <div className="panel">
            <div className="panel__h">
              <Icon name="book-open" size={17} />
              <h3>Saved reports</h3>
            </div>
            <div className="panel__body" style={{ paddingTop: 4, paddingBottom: 4 }}>
              {SAVED.map((r) => (
                <div className="rep-list-item" key={r.name}>
                  <span className="rep-list-item__ic">
                    <Icon name={r.icon} size={16} />
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="rep-name">{r.name}</div>
                    <div className="rep-meta">{r.meta}</div>
                  </div>
                  <Icon name="caret-right" size={15} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
