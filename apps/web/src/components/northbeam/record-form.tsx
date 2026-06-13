'use client';

// Generic create/edit drawer for a record of ANY object — the form is built from
// the object's field defs, grouped into the object's `layout` sections (multi-
// column grid). Reference fields use an async combobox that searches the target
// object's records. Masked inputs come from the shared FieldInput renderer.

import { Button } from '@/components/ui/button';
import { trpc } from '@/lib/api';
import type { LayoutSection } from '@northbeam/db/field-types';
import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { RecordDrawer } from './app-bits';
import { Field } from './field';
import { type FieldDefLite, FieldInput } from './field-render';
import { Combobox, type Option } from './select-legacy';

const READONLY = new Set(['formula', 'rollup', 'ai', 'autonumber']);
const FULL_WIDTH = new Set(['textarea', 'multipicklist']);

export function RecordFormDrawer({
  open,
  onClose,
  objectKey,
  objectLabel,
  fields,
  sections,
  record,
  refLabels,
}: {
  open: boolean;
  onClose: () => void;
  objectKey: string;
  objectLabel: string;
  fields: FieldDefLite[];
  /** Object layout sections; when absent, all fields fall into one section. */
  sections?: LayoutSection[];
  record?: { id: string; data: Record<string, unknown> } | null;
  refLabels?: Record<string, string>;
}) {
  const utils = trpc.useUtils();
  const editable = useMemo(() => fields.filter((f) => !READONLY.has(f.type)), [fields]);
  const byKey = useMemo(() => new Map(editable.map((f) => [f.key, f])), [editable]);

  // Build the sections actually shown: layout sections (editable fields only) +
  // any leftover editable fields not referenced by the layout.
  const groups = useMemo<
    { id: string; label: string; cols: number; fields: FieldDefLite[] }[]
  >(() => {
    if (!sections?.length) {
      return [{ id: 'all', label: '', cols: 2, fields: editable }];
    }
    const used = new Set<string>();
    const built = sections
      .map((s) => {
        const fs = s.fields.map((k) => byKey.get(k)).filter(Boolean) as FieldDefLite[];
        for (const f of fs) used.add(f.key);
        return { id: s.id, label: s.label, cols: s.cols ?? 2, fields: fs };
      })
      .filter((s) => s.fields.length);
    const leftover = editable.filter((f) => !used.has(f.key));
    if (leftover.length) built.push({ id: '_more', label: 'More', cols: 2, fields: leftover });
    return built;
  }, [sections, editable, byKey]);

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
    if (record) await utils.record.get.invalidate({ objectKey, id: record.id });
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
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={save}>
            {saving && <Loader2 className="animate-spin" />}
            {record ? 'Save changes' : 'Create'}
          </Button>
        </>
      }
    >
      {groups.map((g) => (
        <div key={g.id} className="form-section">
          {g.label && <div className="form-section__label">{g.label}</div>}
          <div
            className="form-grid"
            style={{ gridTemplateColumns: `repeat(${g.cols}, minmax(0,1fr))` }}
          >
            {g.fields.map((f) => (
              <Field
                key={f.key}
                label={f.label}
                required={f.required}
                description={f.config?.description}
                helpText={f.config?.helpText}
                className={g.cols > 1 && FULL_WIDTH.has(f.type) ? 'col-span-full' : undefined}
              >
                {f.type === 'reference' ? (
                  <Combobox
                    value={refSel[f.key] ?? null}
                    onChange={(o) => {
                      setRefSel((s) => ({ ...s, [f.key]: o }));
                      setData((d) => ({ ...d, [f.key]: o?.value ?? null }));
                    }}
                    loadOptions={(query) =>
                      utils.record.searchRefs.fetch({
                        objectKey: f.config?.targetObject ?? '',
                        q: query,
                      })
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
          </div>
        </div>
      ))}
    </RecordDrawer>
  );
}
