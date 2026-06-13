'use client';

import { PageActions } from '@/components/northbeam/app-shell';
import { EmptyState } from '@/components/northbeam/empty-state';
import { FilterBar } from '@/components/northbeam/filter-bar';
import { ListToolbar } from '@/components/northbeam/list-toolbar';
import { Spinner } from '@/components/northbeam/primitives';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { SegTabs } from '@/components/northbeam/app-bits';
import { trpc } from '@/lib/api';
import { CheckCircle2, Plus } from 'lucide-react';
import { useState } from 'react';

type FilterMode = 'open' | 'done' | 'all';

export default function TasksPage() {
  const list = trpc.record.list.useQuery({ objectKey: 'activity', limit: 200 });
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<FilterMode>('open');

  const allTasks = (list.data?.rows ?? []).filter(
    (r) => (r.data.type as string | undefined) === 'task',
  );
  const isDone = () => false;
  const rows = allTasks.filter((t) => {
    if (filter === 'open' && isDone()) return false;
    if (filter === 'done' && !isDone()) return false;
    return !q.trim() || t.name.toLowerCase().includes(q.trim().toLowerCase());
  });

  return (
    <>
      <PageActions>
        <Button>
          <Plus />
          New task
        </Button>
      </PageActions>

      <FilterBar />
      <ListToolbar
        searchValue={q}
        onSearchChange={setQ}
        searchPlaceholder="Search tasks…"
        actions={
          <SegTabs
            value={filter}
            onChange={(v) => setFilter(v as FilterMode)}
            options={[
              { value: 'open', label: 'Open', count: allTasks.length },
              { value: 'done', label: 'Done' },
              { value: 'all', label: 'All', count: allTasks.length },
            ]}
          />
        }
      />

      <Card className="overflow-hidden">
        {list.isLoading && (
          <div className="grid place-items-center p-10">
            <Spinner style={{ color: 'var(--brand)' }} />
          </div>
        )}
        {!list.isLoading &&
          rows.map((t) => {
            const due = t.data.due_date as string | undefined;
            return (
              <div
                key={t.id}
                className="flex items-center gap-3.5 border-b px-4 py-3 last:border-b-0"
              >
                <Checkbox aria-label="Mark complete" />
                <span className="min-w-0 flex-1 font-medium text-foreground">{t.name}</span>
                {due && (
                  <span className="w-24 text-right text-muted-foreground text-sm">
                    {new Date(due).toLocaleDateString()}
                  </span>
                )}
              </div>
            );
          })}
        {!list.isLoading && rows.length === 0 && (
          <EmptyState
            icon={CheckCircle2}
            title={allTasks.length === 0 ? 'No tasks yet' : 'Nothing matches your filter'}
            body={
              allTasks.length === 0
                ? 'Create a task to track follow-ups across deals and contacts.'
                : 'Try a different search or filter.'
            }
          />
        )}
      </Card>
    </>
  );
}
