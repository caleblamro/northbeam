'use client';

// Global picklist sets — Salesforce Global Value Sets equivalent. Shared
// value sets that picklist fields across objects can draw from; editing a set
// updates every assigned field (reference-at-read). Managing requires
// object.manage; everyone else gets a read-only card grid.

import { ListToolbar } from '@/components/northbeam/list-toolbar';
import { MetricGroup } from '@/components/northbeam/metric-group';
import { PicklistSetsGrid } from '@/components/northbeam/picklist-set-card';
import { PicklistSetDialog } from '@/components/northbeam/picklist-set-dialog';
import { Button } from '@/components/ui/button';
import { trpc } from '@/lib/api';
import { useCan } from '@/lib/can';
import { Plus } from 'lucide-react';
import { useState } from 'react';

export default function PicklistsPage() {
  const canManage = useCan('object.manage');
  const sets = trpc.picklist.list.useQuery();
  const [search, setSearch] = useState('');
  // Which set the dialog targets: a set id, 'new', or closed.
  const [editing, setEditing] = useState<string | 'new' | null>(null);

  const rows = sets.data ?? [];
  const q = search.trim().toLowerCase();
  const filtered = q
    ? rows.filter((s) => `${s.name} ${s.description ?? ''}`.toLowerCase().includes(q))
    : rows;
  const newSetButton = canManage ? (
    <Button onClick={() => setEditing('new')}>
      <Plus />
      New set
    </Button>
  ) : undefined;

  return (
    <>
      <MetricGroup
        columns={3}
        loading={sets.isLoading}
        items={[
          { label: 'Value sets', value: rows.length },
          { label: 'Total values', value: rows.reduce((n, s) => n + s.values.length, 0) },
          { label: 'Field assignments', value: rows.reduce((n, s) => n + s.usedByCount, 0) },
        ]}
      />
      <div>
        <ListToolbar
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search value sets…"
          actions={newSetButton}
        />
        <PicklistSetsGrid
          sets={filtered}
          total={rows.length}
          loaded={sets.isSuccess}
          onManage={canManage ? setEditing : undefined}
          emptyAction={newSetButton}
        />
      </div>
      <PicklistSetDialog
        open={editing !== null}
        setId={editing === 'new' ? null : editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      />
    </>
  );
}
