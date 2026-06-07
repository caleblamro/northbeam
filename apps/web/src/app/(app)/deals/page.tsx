'use client';

import { PageActions } from '@/components/northbeam/app-shell';

import {
  KVList,
  type Metric,
  MetricStrip,
  RecordDrawer,
  SegTabs,
  StageTag,
  Toolbar,
  ToolbarSearch,
  ToolbarSpacer,
} from '@/components/northbeam/app-bits';
import { type Column, DataTable } from '@/components/northbeam/data-table';
import { EmptyState } from '@/components/northbeam/page-head';
import { Avatar } from '@/components/northbeam/primitives';
import { Button } from '@/components/ui/button';
import { DEALS, type Deal, accountById, fmtMoney, fmtMoneyFull } from '@/lib/mock-crm';
import { useMemo, useState } from 'react';

type Filter = 'open' | 'all' | 'won' | 'lost';

export default function DealsPage() {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('open');
  const [selected, setSelected] = useState<Deal | null>(null);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return DEALS.filter((d) => {
      if (filter === 'open' && (d.stage === 'won' || d.stage === 'lost')) return false;
      if (filter === 'won' && d.stage !== 'won') return false;
      if (filter === 'lost' && d.stage !== 'lost') return false;
      if (!s) return true;
      const acct = accountById(d.accountId)?.name ?? '';
      return `${d.name} ${acct}`.toLowerCase().includes(s);
    });
  }, [q, filter]);

  const open = DEALS.filter((d) => d.stage !== 'won' && d.stage !== 'lost');
  const pipeline = open.reduce((s, d) => s + d.amount, 0);
  const weighted = open.reduce((s, d) => s + (d.amount * d.probability) / 100, 0);
  const metrics: Metric[] = [
    { label: 'Open deals', value: open.length },
    { label: 'Pipeline value', value: fmtMoney(pipeline) },
    {
      label: 'Weighted',
      value: fmtMoney(weighted),
      delta: { text: 'by probability', tone: 'brand' },
    },
    { label: 'Avg deal size', value: fmtMoney(pipeline / (open.length || 1)) },
  ];

  const columns: Column<Deal>[] = [
    {
      key: 'name',
      header: 'Deal',
      render: (d) => <b style={{ color: 'var(--ink)', fontWeight: 600 }}>{d.name}</b>,
    },
    { key: 'account', header: 'Account', render: (d) => accountById(d.accountId)?.name ?? '—' },
    { key: 'stage', header: 'Stage', render: (d) => <StageTag stage={d.stage} /> },
    {
      key: 'amount',
      header: 'Amount',
      align: 'right',
      render: (d) => (
        <span className="num" style={{ fontWeight: 600, color: 'var(--ink)' }}>
          {fmtMoney(d.amount)}
        </span>
      ),
    },
    {
      key: 'close',
      header: 'Close date',
      render: (d) => <span style={{ color: 'var(--ink-muted)' }}>{d.closeDate}</span>,
    },
    {
      key: 'owner',
      header: 'Owner',
      align: 'right',
      render: (d) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Avatar
            name={d.owner.name}
            className="cmdk__avatar"
            style={{ width: 22, height: 22, fontSize: 9 }}
          />
          {d.owner.name}
        </span>
      ),
    },
  ];

  const acct = selected ? accountById(selected.accountId) : undefined;

  return (
    <>
      <PageActions>
        <>
          <Button variant="secondary" icon="funnel" onClick={() => undefined}>
            Pipeline view
          </Button>
          <Button variant="primary" icon="plus">
            New deal
          </Button>
        </>
      </PageActions>

      <MetricStrip items={metrics} />

      <Toolbar>
        <ToolbarSearch value={q} onChange={setQ} placeholder="Search deals…" />
        <SegTabs
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'open', label: 'Open', count: open.length },
            { value: 'all', label: 'All', count: DEALS.length },
            { value: 'won', label: 'Won' },
            { value: 'lost', label: 'Lost' },
          ]}
        />
        <ToolbarSpacer />
      </Toolbar>

      <DataTable
        columns={columns}
        rows={rows}
        onRowClick={setSelected}
        empty={<EmptyState icon="currency-circle-dollar" title="No deals match" />}
      />

      <RecordDrawer
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.name ?? ''}
        subtitle={acct?.name}
        footer={
          <>
            <Button variant="secondary" icon="note-pencil">
              Log activity
            </Button>
            <span className="spacer" />
            <Button variant="primary" icon="pencil-simple">
              Edit
            </Button>
          </>
        }
      >
        {selected && (
          <>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <StageTag stage={selected.stage} />
              <span
                style={{
                  marginLeft: 'auto',
                  fontSize: 'var(--text-2xl)',
                  fontWeight: 600,
                  letterSpacing: '-0.02em',
                }}
              >
                {fmtMoneyFull(selected.amount)}
              </span>
            </div>
            <KVList
              items={[
                { k: 'Account', v: acct?.name ?? '—' },
                { k: 'Close date', v: selected.closeDate },
                { k: 'Probability', v: `${selected.probability}%` },
                { k: 'Owner', v: selected.owner.name },
              ]}
            />
          </>
        )}
      </RecordDrawer>
    </>
  );
}
