'use client';

// Generic create/edit drawer for a record of ANY object — the form is built
// from the object's field defs via the masked FieldInput renderer. Reference
// fields use an async combobox that searches the target object's records.

import { trpc } from '@/lib/api';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '../ui/button';
import { Field } from '../ui/input';
import { Combobox, type Option } from '../ui/select';
import { RecordDrawer } from './app-bits';
import { type FieldDefLite, FieldInput } from './field-render';

const READONLY = new Set(['formula', 'rollup', 'ai', 'autonumber']);

export function RecordFormDrawer({
  open,
  onClose,
  objectKey,
  objectLabel,
  fields,
  record,
  refLabels,
}: {
  open: boolean;
  onClose: () => void;
  objectKey: string;
  objectLabel: string;
  fields: FieldDefLite[];
  record?: { id: string; data: Record<string, unknown> } | null;
  refLabels?: Record<string, string>;
}) {
  const utils = trpc.useUtils();
  const editable = useMemo(() => fields.filter((f) => !READONLY.has(f.type)), [fields]);
  const [data, setData] = useState<Record<string, unknown>>({});
  const [refSel, setRefSel] = useState<Record<string, Option | null>>({});

  useEffect(() => {
    if (!open) return;
    const d = record?.data ?? {};
    setData(d);
    const rs: Record<string, Option | null> = {};
    for (const f of editable) {
      if (f.type === 'reference' && d[f.key]) {
        const id = String(d[f.key]);
        rs[f.key] = { value: id, label: refLabels?.[id] ?? id };
      }
    }
    setRefSel(rs);
  }, [open, record, editable, refLabels]);

  const create = trpc.record.create.useMutation();
  const update = trpc.record.update.useMutation();
  const saving = create.isPending || update.isPending;

  const save = async () => {
    if (record) await update.mutateAsync({ objectKey, id: record.id, data });
    else await create.mutateAsync({ objectKey, data });
    await utils.record.list.invalidate();
    onClose();
  };

  return (
    <RecordDrawer
      open={open}
      onClose={onClose}
      title={record ? `Edit ${objectLabel.toLowerCase()}` : `New ${objectLabel.toLowerCase()}`}
      footer={
        <>
          <span className="spacer" />
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={saving} onClick={save}>
            {record ? 'Save changes' : 'Create'}
          </Button>
        </>
      }
    >
      {editable.map((f) => (
        <Field key={f.key} label={f.label} required={f.required}>
          {f.type === 'reference' ? (
            <Combobox
              value={refSel[f.key] ?? null}
              onChange={(o) => {
                setRefSel((s) => ({ ...s, [f.key]: o }));
                setData((d) => ({ ...d, [f.key]: o?.value ?? null }));
              }}
              loadOptions={(query) =>
                utils.record.searchRefs.fetch({ objectKey: f.config?.targetObject ?? '', q: query })
              }
              placeholder={`Search ${f.config?.targetObject ?? 'records'}…`}
              emptyText="No matches"
            />
          ) : (
            <FieldInput
              field={f}
              value={data[f.key]}
              onChange={(v) => setData((d) => ({ ...d, [f.key]: v }))}
            />
          )}
        </Field>
      ))}
    </RecordDrawer>
  );
}
