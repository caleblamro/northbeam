'use client';

import { PageActions } from '@/components/northbeam/app-shell';

import { Icon } from '@/components/northbeam/icons';
import { Badge } from '@/components/northbeam/primitives';
import { Button } from '@/components/ui/button';
import { DEAL_STAGE_TONE } from '@/lib/tones';

type Status = 'mapped' | 'review' | 'merge';
type Row = {
  sfObject: string;
  sfField: string;
  nbObject: string;
  nbField: string;
  confidence: number;
  status: Status;
};

const ROWS: Row[] = [
  {
    sfObject: 'Account',
    sfField: 'Name',
    nbObject: 'Account',
    nbField: 'name',
    confidence: 100,
    status: 'mapped',
  },
  {
    sfObject: 'Account',
    sfField: 'AnnualRevenue',
    nbObject: 'Account',
    nbField: 'arr',
    confidence: 96,
    status: 'mapped',
  },
  {
    sfObject: 'Contact',
    sfField: 'Email',
    nbObject: 'Contact',
    nbField: 'email',
    confidence: 100,
    status: 'mapped',
  },
  {
    sfObject: 'Contact',
    sfField: 'Title',
    nbObject: 'Contact',
    nbField: 'title',
    confidence: 92,
    status: 'mapped',
  },
  {
    sfObject: 'Opportunity',
    sfField: 'StageName',
    nbObject: 'Deal',
    nbField: 'stage',
    confidence: 88,
    status: 'review',
  },
  {
    sfObject: 'Opportunity',
    sfField: 'Amount',
    nbObject: 'Deal',
    nbField: 'amount',
    confidence: 99,
    status: 'mapped',
  },
  {
    sfObject: 'Lead',
    sfField: 'Company',
    nbObject: 'Account',
    nbField: 'name',
    confidence: 64,
    status: 'merge',
  },
  {
    sfObject: 'Task',
    sfField: 'Subject',
    nbObject: 'Activity',
    nbField: 'summary',
    confidence: 71,
    status: 'review',
  },
];

const STATUS: Record<Status, { label: string; variant?: 'success' | 'warning' | 'brand' }> = {
  mapped: { label: 'Auto-mapped', variant: 'success' },
  review: { label: 'Needs review', variant: 'warning' },
  merge: { label: 'Merge field', variant: 'brand' },
};

function confColor(c: number) {
  return c >= 90
    ? DEAL_STAGE_TONE.won.fg
    : c >= 75
      ? DEAL_STAGE_TONE.negotiation.fg
      : DEAL_STAGE_TONE.lost.fg;
}

export default function MigratePage() {
  return (
    <>
      <PageActions>
        <>
          <Button variant="secondary" icon="arrow-square-out">
            View source org
          </Button>
          <Button variant="primary" icon="arrows-clockwise">
            Run migration
          </Button>
        </>
      </PageActions>

      <div className="mig-banner">
        <span className="mig-banner__ic">
          <Icon name="command" size={22} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2>AI auto-mapper</h2>
          <p>
            Analyzed your Salesforce org — mapped 38 objects and 412 fields. 6 low-confidence
            matches need a quick look.
          </p>
        </div>
        <Badge variant="brand" dot>
          94% confidence
        </Badge>
      </div>

      <div className="mig-stats">
        <div className="mig-stat">
          <b>38</b>
          <span>Objects mapped</span>
        </div>
        <div className="mig-stat">
          <b>412</b>
          <span>Fields mapped</span>
        </div>
        <div className="mig-stat mig-stat--ai">
          <b>6</b>
          <span>Needs review</span>
        </div>
        <div className="mig-stat">
          <b>12,480</b>
          <span>Records to import</span>
        </div>
      </div>

      <div className="subhead">Field mapping</div>
      <div className="tbl-card">
        <div className="map-head">
          <span>Salesforce</span>
          <span />
          <span>Northbeam</span>
          <span>Confidence</span>
          <span>Status</span>
        </div>
        <div className="tbl-scroll">
          {ROWS.map((r) => (
            <div className="map-row" key={`${r.sfObject}.${r.sfField}`}>
              <div className="map-side">
                <span className="map-sf-ic">
                  <Icon name="buildings" size={15} />
                </span>
                <div style={{ minWidth: 0 }}>
                  <b>{r.sfField}</b>
                  <small>{r.sfObject}</small>
                </div>
              </div>
              <div className="map-arrow">
                <Icon name="arrow-right" size={18} />
              </div>
              <div className="map-side">
                <div style={{ minWidth: 0 }}>
                  <b>{r.nbField}</b>
                  <small>{r.nbObject}</small>
                </div>
              </div>
              <div className="map-conf">
                <div className="map-bar">
                  <span
                    style={{ width: `${r.confidence}%`, background: confColor(r.confidence) }}
                  />
                </div>
                <b>{r.confidence}%</b>
              </div>
              <div>
                <Badge variant={STATUS[r.status].variant}>{STATUS[r.status].label}</Badge>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
