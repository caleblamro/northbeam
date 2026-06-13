'use client';

// Generic list view for any object — search + sectioned-aware columns (from the
// object's layout.listColumns) + row→record-page navigation + create/edit drawer
// + delete. One component backs Contacts/Accounts/Deals/Activities on real data.

import { ObjChip } from '@/components/northbeam/app-bits';
import { HidePageHead, PageActions } from '@/components/northbeam/app-shell';
import { type FieldDefLite, FieldValue } from '@/components/northbeam/field-render';
import { Icon } from '@/components/northbeam/icons';
import { EmptyState } from '@/components/northbeam/page-head';
import { Spinner } from '@/components/northbeam/primitives';
import { RecordFormDrawer } from '@/components/northbeam/record-form';
import { Button, MenuButton, type MenuItem } from '@/components/ui/button';
import { trpc } from '@/lib/api';
import type { ObjectLayout } from '@northbeam/db/field-types';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

const NUMERIC = new Set(['currency', 'number', 'percent']);

export function RecordListView({
  objectKey,
  newLabel,
  showImport = true,
  standalone = false,
}: {
  objectKey: string;
  /** e.g. "New contact"; defaults to "New {object}". */
  newLabel?: string;
  showImport?: boolean;
  /** For dynamic (imported/custom) objects without a static page: render our own
   *  header instead of using the layout-owned page-head + PageActions. */
  standalone?: boolean;
}) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<
    { id: string; data: Record<string, unknown> } | 'new' | null
  >(null);

  const utils = trpc.useUtils();
  const list = trpc.record.list.useQuery({ objectKey, search: q || undefined });
  const remove = trpc.record.remove.useMutation({
    onSuccess: () => utils.record.list.invalidate(),
  });

  const fields = (list.data?.fields ?? []) as FieldDefLite[];
  const rows = list.data?.rows ?? [];
  const refLabels = list.data?.refLabels ?? {};
  const object = list.data?.object;
  const objectLabel = object?.label ?? '';
  const objectPlural = object?.labelPlural ?? '';
  const layout = (object?.layout ?? {}) as ObjectLayout;

  const colKeys = layout.listColumns?.length
    ? layout.listColumns
    : fields.slice(0, 4).map((f) => f.key);
  const columns = colKeys
    .map((k) => fields.find((f) => f.key === k))
    .filter((f): f is FieldDefLite => !!f);

  const createBtn = (
    <Button variant="primary" icon="user-plus" onClick={() => setEditing('new')}>
      {newLabel ?? `New ${objectLabel.toLowerCase() || 'record'}`}
    </Button>
  );

  if (list.isError) {
    return (
      <>
        {standalone && <HidePageHead />}
        <EmptyState
          icon="warning-circle"
          title="Unknown object"
          body={`No object '${objectKey}' exists in this workspace.`}
        />
      </>
    );
  }

  return (
    <>
      {standalone ? (
        <>
          <HidePageHead />
          <div className="page-head">
            <ObjChip label={objectLabel || objectKey} color={object?.color} size={46} />
            <div className="page-head__text" style={{ minWidth: 0 }}>
              <h1>{objectPlural || objectKey}</h1>
              {!list.isLoading && <p>{rows.length} records</p>}
            </div>
            <div className="page-head__actions">{createBtn}</div>
          </div>
        </>
      ) : (
        <PageActions>
          {showImport && (
            <Button variant="secondary" icon="upload-simple">
              Import
            </Button>
          )}
          {createBtn}
        </PageActions>
      )}

      <div className="toolbar">
        <div className="toolbar-search" style={{ width: 280 }}>
          <Icon name="magnifying-glass" size={16} />
          <input
            placeholder={`Search ${objectPlural.toLowerCase() || 'records'}…`}
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
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
                  <th key={c.key} className={NUMERIC.has(c.type) ? 'right' : undefined}>
                    {c.label}
                  </th>
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
                    onSelect: () => remove.mutate({ objectKey, id: r.id }),
                  },
                ];
                return (
                  <tr
                    key={r.id}
                    data-clickable="true"
                    onClick={() => router.push(`/${objectKey}/${r.id}`)}
                  >
                    <td>
                      <b style={{ color: 'var(--ink)', fontWeight: 600 }}>{r.name}</b>
                    </td>
                    {columns.map((c) => (
                      <td key={c.key} className={NUMERIC.has(c.type) ? 'right' : undefined}>
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
            title={
              q ? `No ${objectPlural.toLowerCase()} match` : `No ${objectPlural.toLowerCase()} yet`
            }
            body={
              q
                ? 'Try a different search.'
                : `Create your first ${objectLabel.toLowerCase()}, or run a Salesforce migration to import them.`
            }
            action={!q && createBtn}
          />
        )}
      </div>

      {editing && object && (
        <RecordFormDrawer
          open
          onClose={() => setEditing(null)}
          objectKey={objectKey}
          objectLabel={objectLabel}
          fields={fields}
          sections={layout.sections}
          record={editing === 'new' ? null : editing}
          refLabels={refLabels}
        />
      )}
    </>
  );
}
