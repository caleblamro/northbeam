'use client';

import { PageActions } from '@/components/northbeam/app-shell';

import {
  HealthDot,
  KVList,
  RecordDrawer,
  Toolbar,
  ToolbarSearch,
  ToolbarSpacer,
  ViewToggle,
} from '@/components/northbeam/app-bits';
import { type Column, DataTable } from '@/components/northbeam/data-table';
import { Icon } from '@/components/northbeam/icons';
import { EmptyState } from '@/components/northbeam/page-head';
import { Badge, avatarColor } from '@/components/northbeam/primitives';
import { Button } from '@/components/ui/button';
import { ACCOUNTS, type Account, fmtMoney, fmtMoneyFull } from '@/lib/mock-crm';
import { useMemo, useState } from 'react';

function AccountIcon({ account, size = 30 }: { account: Account; size?: number }) {
  return (
    <span
      className="tbl__oicon"
      style={{ background: avatarColor(account.name), width: size, height: size }}
    >
      <Icon name="buildings" size={size > 32 ? 20 : 16} />
    </span>
  );
}

export default function AccountsPage() {
  const [q, setQ] = useState('');
  const [view, setView] = useState<'table' | 'grid'>('table');
  const [selected, setSelected] = useState<Account | null>(null);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return ACCOUNTS;
    return ACCOUNTS.filter((a) => `${a.name} ${a.domain} ${a.industry}`.toLowerCase().includes(s));
  }, [q]);

  const columns: Column<Account>[] = [
    {
      key: 'name',
      header: 'Account',
      render: (a) => (
        <div className="tbl__name">
          <AccountIcon account={a} />
          <div className="tbl__two">
            <b>{a.name}</b>
            <small>{a.domain}</small>
          </div>
        </div>
      ),
    },
    { key: 'plan', header: 'Plan', render: (a) => <Badge>{a.plan}</Badge> },
    {
      key: 'arr',
      header: 'ARR',
      align: 'right',
      render: (a) => <span className="num">{fmtMoney(a.arr)}</span>,
    },
    {
      key: 'contacts',
      header: 'Contacts',
      align: 'right',
      render: (a) => <span className="num">{a.contacts}</span>,
    },
    { key: 'health', header: 'Health', render: (a) => <HealthDot health={a.health} label /> },
    { key: 'owner', header: 'Owner', align: 'right', render: (a) => a.owner.name },
  ];

  return (
    <>
      <PageActions>
        <Button variant="primary" icon="plus">
          New account
        </Button>
      </PageActions>

      <Toolbar>
        <ToolbarSearch value={q} onChange={setQ} placeholder="Search accounts…" />
        <ToolbarSpacer />
        <ViewToggle value={view} onChange={setView} />
      </Toolbar>

      {view === 'table' ? (
        <DataTable
          columns={columns}
          rows={rows}
          onRowClick={setSelected}
          empty={<EmptyState icon="buildings" title="No accounts match" />}
        />
      ) : (
        <div className="obj-grid">
          {rows.map((a) => (
            <button
              type="button"
              className="obj-card"
              key={a.id}
              onClick={() => setSelected(a)}
              style={{ textAlign: 'left', font: 'inherit' }}
            >
              <div className="obj-card__top">
                <AccountIcon account={a} size={38} />
                <div style={{ minWidth: 0 }}>
                  <h3>{a.name}</h3>
                  <div className="obj-card__api">{a.domain}</div>
                </div>
                <span style={{ marginLeft: 'auto' }}>
                  <HealthDot health={a.health} />
                </span>
              </div>
              <Badge>{a.plan}</Badge>
              <div className="obj-card__meta">
                <span>
                  <b>{fmtMoney(a.arr)}</b> ARR
                </span>
                <span>
                  <b>{a.contacts}</b> contacts
                </span>
              </div>
            </button>
          ))}
        </div>
      )}

      <RecordDrawer
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.name ?? ''}
        subtitle={selected?.domain}
        avatar={selected ? <AccountIcon account={selected} size={44} /> : undefined}
        footer={
          <>
            <Button variant="secondary" icon="arrow-square-out">
              Open
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
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <Badge>{selected.plan}</Badge>
              <HealthDot health={selected.health} label />
            </div>
            <KVList
              items={[
                { k: 'Industry', v: selected.industry },
                { k: 'ARR', v: fmtMoneyFull(selected.arr) },
                { k: 'Contacts', v: selected.contacts },
                { k: 'Owner', v: selected.owner.name },
                { k: 'Domain', v: selected.domain },
              ]}
            />
          </>
        )}
      </RecordDrawer>
    </>
  );
}
