'use client';

import { PageActions } from '@/components/northbeam/app-shell';

import { SegTabs, Toolbar, ToolbarSearch, ToolbarSpacer } from '@/components/northbeam/app-bits';
import { Icon } from '@/components/northbeam/icons';
import { Avatar } from '@/components/northbeam/primitives';
import { Button } from '@/components/ui/button';
import { OWNERS } from '@/lib/mock-crm';
import { useState } from 'react';

type Task = {
  id: string;
  title: string;
  due: string;
  related: string;
  owner: string;
  done: boolean;
};

const SEED: Task[] = [
  {
    id: 't1',
    title: 'Follow up with Marcus Chen on Vertex expansion',
    due: 'Today',
    related: 'Vertex Industries',
    owner: 'Jordan Mills',
    done: false,
  },
  {
    id: 't2',
    title: 'Send renewal quote to Lumen Labs',
    due: 'Today',
    related: 'Lumen Labs',
    owner: 'Aisha Khan',
    done: false,
  },
  {
    id: 't3',
    title: 'Prep deck for Meridian enterprise rollout',
    due: 'Tomorrow',
    related: 'Meridian Health',
    owner: 'Jordan Mills',
    done: false,
  },
  {
    id: 't4',
    title: 'Review needs-review fields from Salesforce import',
    due: 'Jun 9',
    related: 'Migration',
    owner: 'Ravi Teja',
    done: false,
  },
  {
    id: 't5',
    title: 'Log discovery call notes for Northwind',
    due: 'Jun 10',
    related: 'Northwind Trading',
    owner: 'Ravi Teja',
    done: true,
  },
];

export default function TasksPage() {
  const [tasks, setTasks] = useState(SEED);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'open' | 'done' | 'all'>('open');

  const rows = tasks.filter((t) => {
    if (filter === 'open' && t.done) return false;
    if (filter === 'done' && !t.done) return false;
    return !q.trim() || t.title.toLowerCase().includes(q.trim().toLowerCase());
  });
  const toggle = (id: string) =>
    setTasks((ts) => ts.map((t) => (t.id === id ? { ...t, done: !t.done } : t)));

  return (
    <>
      <PageActions>
        <Button variant="primary" icon="plus">
          New task
        </Button>
      </PageActions>

      <Toolbar>
        <ToolbarSearch value={q} onChange={setQ} placeholder="Search tasks…" />
        <SegTabs
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'open', label: 'Open', count: tasks.filter((t) => !t.done).length },
            { value: 'done', label: 'Done' },
            { value: 'all', label: 'All', count: tasks.length },
          ]}
        />
        <ToolbarSpacer />
      </Toolbar>

      <div className="tbl-card">
        {rows.map((t) => (
          <div
            key={t.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              padding: '13px 16px',
              borderBottom: '1px solid var(--divider)',
            }}
          >
            <button
              type="button"
              onClick={() => toggle(t.id)}
              aria-label={t.done ? 'Mark incomplete' : 'Mark complete'}
              style={{
                width: 20,
                height: 20,
                borderRadius: 6,
                border: `1.5px solid ${t.done ? 'var(--brand)' : 'var(--border-strong)'}`,
                background: t.done ? 'var(--brand)' : 'transparent',
                color: '#fff',
                display: 'grid',
                placeItems: 'center',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              {t.done && <Icon name="check" size={13} />}
            </button>
            <span
              style={{
                flex: 1,
                minWidth: 0,
                color: t.done ? 'var(--ink-muted)' : 'var(--ink)',
                textDecoration: t.done ? 'line-through' : 'none',
                fontWeight: 500,
              }}
            >
              {t.title}
            </span>
            <span className="stage" style={{ color: 'var(--ink-secondary)' }}>
              {t.related}
            </span>
            <span
              style={{
                color: 'var(--ink-muted)',
                fontSize: 'var(--text-sm)',
                width: 72,
                textAlign: 'right',
              }}
            >
              {t.due}
            </span>
            <Avatar
              name={t.owner}
              className="cmdk__avatar"
              style={{ width: 24, height: 24, fontSize: 9 }}
            />
          </div>
        ))}
        {rows.length === 0 && (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--ink-muted)' }}>
            Nothing here — nice work.
          </div>
        )}
      </div>

      <p className="note" style={{ marginTop: 12 }}>
        {OWNERS.length} teammates · tasks sync to each owner's queue.
      </p>
    </>
  );
}
