'use client';

import { SegTabs, Toolbar, ToolbarSearch, ToolbarSpacer } from '@/components/northbeam/app-bits';
import { PageActions } from '@/components/northbeam/app-shell';
import { Icon } from '@/components/northbeam/icons';
import { Spinner } from '@/components/northbeam/primitives';
import { Button } from '@/components/northbeam/button-legacy';
import { trpc } from '@/lib/api';
import { useState } from 'react';

// Tasks are activities with `type === 'task'`. The activity object is seeded
// into every workspace; we filter the standard record.list result client-side.
type FilterMode = 'open' | 'done' | 'all';

export default function TasksPage() {
  const list = trpc.record.list.useQuery({ objectKey: 'activity', limit: 200 });
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<FilterMode>('open');

  const allTasks = (list.data?.rows ?? []).filter(
    (r) => (r.data.type as string | undefined) === 'task',
  );

  // No "done" field on the seeded activity object — until we add one, treat
  // every task as open. The filter is wired so the UI works once a done flag
  // ships; until then 'done' renders empty and 'open'/'all' match.
  const isDone = (_t: (typeof allTasks)[number]) => false;

  const rows = allTasks.filter((t) => {
    if (filter === 'open' && isDone(t)) return false;
    if (filter === 'done' && !isDone(t)) return false;
    return !q.trim() || t.name.toLowerCase().includes(q.trim().toLowerCase());
  });

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
          onChange={(v) => setFilter(v as FilterMode)}
          options={[
            { value: 'open', label: 'Open', count: allTasks.filter((t) => !isDone(t)).length },
            { value: 'done', label: 'Done' },
            { value: 'all', label: 'All', count: allTasks.length },
          ]}
        />
        <ToolbarSpacer />
      </Toolbar>

      <div className="tbl-card">
        {list.isLoading && (
          <div style={{ display: 'grid', placeItems: 'center', padding: 40 }}>
            <Spinner />
          </div>
        )}
        {!list.isLoading &&
          rows.map((t) => {
            const due = t.data.due_date as string | undefined;
            const done = isDone(t);
            return (
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
                  aria-label={done ? 'Mark incomplete' : 'Mark complete'}
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 6,
                    border: `1.5px solid ${done ? 'var(--brand)' : 'var(--border-strong)'}`,
                    background: done ? 'var(--brand)' : 'transparent',
                    color: '#fff',
                    display: 'grid',
                    placeItems: 'center',
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  {done && <Icon name="check" size={13} />}
                </button>
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    color: done ? 'var(--ink-muted)' : 'var(--ink)',
                    textDecoration: done ? 'line-through' : 'none',
                    fontWeight: 500,
                  }}
                >
                  {t.name}
                </span>
                {due && (
                  <span
                    style={{
                      color: 'var(--ink-muted)',
                      fontSize: 'var(--text-sm)',
                      width: 96,
                      textAlign: 'right',
                    }}
                  >
                    {new Date(due).toLocaleDateString()}
                  </span>
                )}
              </div>
            );
          })}
        {!list.isLoading && rows.length === 0 && (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--ink-muted)' }}>
            {allTasks.length === 0
              ? 'No tasks yet — create one to track follow-ups across deals and contacts.'
              : 'Nothing matches your filter.'}
          </div>
        )}
      </div>
    </>
  );
}
