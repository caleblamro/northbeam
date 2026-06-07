'use client';

import { PageActions } from '@/components/northbeam/app-shell';

import {
  KVList,
  RecordDrawer,
  SegTabs,
  StageTag,
  Toolbar,
  ToolbarSearch,
  ToolbarSpacer,
} from '@/components/northbeam/app-bits';
import { type Column, DataTable } from '@/components/northbeam/data-table';
import { EmptyState } from '@/components/northbeam/page-head';
import { Avatar, Badge } from '@/components/northbeam/primitives';
import { Button } from '@/components/ui/button';
import { CONTACTS, type Contact, accountById } from '@/lib/mock-crm';
import { useMemo, useState } from 'react';

type Filter = 'all' | 'active' | 'won' | 'lost';
const ACTIVE = new Set(['new', 'qualified', 'negotiation']);

export default function ContactsPage() {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [selected, setSelected] = useState<Contact | null>(null);

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return CONTACTS.filter((c) => {
      if (filter === 'active' && !ACTIVE.has(c.stage)) return false;
      if (filter === 'won' && c.stage !== 'won') return false;
      if (filter === 'lost' && c.stage !== 'lost') return false;
      if (!s) return true;
      const acct = accountById(c.accountId)?.name ?? '';
      return `${c.name} ${c.email} ${c.title} ${acct}`.toLowerCase().includes(s);
    });
  }, [q, filter]);

  const columns: Column<Contact>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (c) => (
        <div className="tbl__name">
          <Avatar name={c.name} className="cmdk__avatar" style={{ width: 32, height: 32 }} />
          <div className="tbl__two">
            <b>{c.name}</b>
            <small>{c.email}</small>
          </div>
        </div>
      ),
    },
    { key: 'account', header: 'Account', render: (c) => accountById(c.accountId)?.name ?? '—' },
    { key: 'title', header: 'Title', render: (c) => c.title },
    { key: 'stage', header: 'Stage', render: (c) => <StageTag stage={c.stage} /> },
    {
      key: 'owner',
      header: 'Owner',
      render: (c) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <Avatar
            name={c.owner.name}
            className="cmdk__avatar"
            style={{ width: 22, height: 22, fontSize: 9 }}
          />
          {c.owner.name}
        </span>
      ),
    },
    {
      key: 'last',
      header: 'Last activity',
      align: 'right',
      render: (c) => <span style={{ color: 'var(--ink-muted)' }}>{c.lastActivity}</span>,
    },
  ];

  const acct = selected ? accountById(selected.accountId) : undefined;

  return (
    <>
      <PageActions>
        <Button variant="primary" icon="user-plus">
          New contact
        </Button>
      </PageActions>

      <Toolbar>
        <ToolbarSearch value={q} onChange={setQ} placeholder="Search contacts…" />
        <SegTabs
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all', label: 'All', count: CONTACTS.length },
            { value: 'active', label: 'Active' },
            { value: 'won', label: 'Won' },
            { value: 'lost', label: 'Lost' },
          ]}
        />
        <ToolbarSpacer />
        <Button variant="secondary" icon="funnel">
          Filter
        </Button>
      </Toolbar>

      <DataTable
        columns={columns}
        rows={rows}
        onRowClick={setSelected}
        empty={
          <EmptyState
            icon="users-three"
            title="No contacts match"
            body="Try a different search or filter."
          />
        }
      />

      <RecordDrawer
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.name ?? ''}
        subtitle={selected?.title}
        avatar={
          selected ? (
            <Avatar
              name={selected.name}
              className="cmdk__avatar"
              style={{ width: 44, height: 44, fontSize: 16 }}
            />
          ) : undefined
        }
        footer={
          <>
            <Button variant="secondary" icon="envelope-simple">
              Email
            </Button>
            <Button variant="secondary" icon="phone">
              Call
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
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <StageTag stage={selected.stage} />
              {acct && <Badge variant="brand">{acct.plan}</Badge>}
            </div>
            <KVList
              items={[
                { k: 'Email', v: selected.email },
                { k: 'Phone', v: selected.phone },
                { k: 'Account', v: acct?.name ?? '—' },
                { k: 'Owner', v: selected.owner.name },
                { k: 'Last activity', v: selected.lastActivity },
              ]}
            />
          </>
        )}
      </RecordDrawer>
    </>
  );
}
