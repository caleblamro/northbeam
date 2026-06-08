'use client';

import { PageActions } from '@/components/northbeam/app-shell';
import { type FieldDefLite, FieldValue } from '@/components/northbeam/field-render';
import { Icon } from '@/components/northbeam/icons';
import { EmptyState } from '@/components/northbeam/page-head';
import { Spinner } from '@/components/northbeam/primitives';
import { RecordFormDrawer } from '@/components/northbeam/record-form';
import { Button, MenuButton, type MenuItem } from '@/components/ui/button';
import { trpc } from '@/lib/api';
import { useState } from 'react';

const OBJECT_KEY = 'contact';
// Columns surfaced in the list (besides the computed Name). Resolved against the
// object's real field defs so this stays correct as fields change.
const COLUMN_KEYS = ['email', 'account', 'title', 'stage'];

type Editing = { id: string; data: Record<string, unknown> } | 'new' | null;

export default function ContactsPage() {
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Editing>(null);

  const utils = trpc.useUtils();
  const list = trpc.record.list.useQuery({ objectKey: OBJECT_KEY, search: q || undefined });
  const remove = trpc.record.remove.useMutation({
    onSuccess: () => utils.record.list.invalidate(),
  });

  const fields = (list.data?.fields ?? []) as FieldDefLite[];
  const rows = list.data?.rows ?? [];
  const refLabels = list.data?.refLabels ?? {};
  const objectLabel = list.data?.object.label ?? 'Contact';
  const columns = COLUMN_KEYS.map((k) => fields.find((f) => f.key === k)).filter(
    (f): f is FieldDefLite => !!f,
  );

  return (
    <>
      <PageActions>
        <Button variant="secondary" icon="upload-simple">
          Import
        </Button>
        <Button variant="primary" icon="user-plus" onClick={() => setEditing('new')}>
          New contact
        </Button>
      </PageActions>

      <div className="toolbar">
        <div className="input-wrap" style={{ width: 280 }}>
          <span className="input-wrap__icon">
            <Icon name="magnifying-glass" size={16} />
          </span>
          <input placeholder="Search contacts…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <span className="toolbar__spacer" />
      </div>

      <div className="tbl-card">
        <div className="tbl-scroll">
          <table className="tbl">
            <thead>
              <tr>
                <th>Name</th>
                {columns.map((c) => (
                  <th key={c.key}>{c.label}</th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const rowMenu: MenuItem[] = [
                  {
                    icon: 'pencil-simple',
                    label: 'Edit',
                    onSelect: () => setEditing({ id: r.id, data: r.data }),
                  },
                  { separator: true },
                  {
                    icon: 'trash',
                    label: 'Delete',
                    danger: true,
                    onSelect: () => remove.mutate({ id: r.id }),
                  },
                ];
                return (
                  <tr
                    key={r.id}
                    data-clickable="true"
                    onClick={() => setEditing({ id: r.id, data: r.data })}
                  >
                    <td>
                      <b style={{ color: 'var(--ink)', fontWeight: 600 }}>{r.name}</b>
                    </td>
                    {columns.map((c) => (
                      <td key={c.key}>
                        <FieldValue
                          field={c}
                          value={r.data[c.key]}
                          referenceLabel={refLabels[String(r.data[c.key])]}
                        />
                      </td>
                    ))}
                    <td className="shrink" onClick={(e) => e.stopPropagation()}>
                      <MenuButton iconBtn="dots-three" align="right" items={rowMenu} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {list.isLoading && (
          <div style={{ display: 'grid', placeItems: 'center', padding: 48 }}>
            <Spinner style={{ color: 'var(--brand)' }} />
          </div>
        )}
        {!list.isLoading && rows.length === 0 && (
          <EmptyState
            icon="users-three"
            title={q ? 'No contacts match' : 'No contacts yet'}
            body={
              q
                ? 'Try a different search.'
                : 'Create your first contact, or run a Salesforce migration to import them.'
            }
            action={
              !q && (
                <Button variant="primary" icon="user-plus" onClick={() => setEditing('new')}>
                  New contact
                </Button>
              )
            }
          />
        )}
      </div>

      {editing && (
        <RecordFormDrawer
          open
          onClose={() => setEditing(null)}
          objectKey={OBJECT_KEY}
          objectLabel={objectLabel}
          fields={fields}
          record={editing === 'new' ? null : editing}
          refLabels={refLabels}
        />
      )}
    </>
  );
}
