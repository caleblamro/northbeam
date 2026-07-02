'use client';

// Generic create/edit drawer for a record of ANY object — the form is built
// from the object's field defs, grouped into the object's `layout` sections
// (multi-column grid). All field types (including the async-loaded
// reference combobox) flow through the FieldInput switch via RHF's
// Controller so error display, dirty tracking, and submit gating come for
// free from a single source of truth.

import { Button } from '@/components/ui/button';
import { trpc } from '@/lib/api';
import { notifyError } from '@/lib/api/errors';
import { zodResolver } from '@hookform/resolvers/zod';
import { type LayoutSection, recordValueSchema } from '@northbeam/db/field-types';
import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { RecordDrawer } from './app-bits';
import { Field } from './field';
import { type FieldDefLite, FieldInput, READONLY_FIELD_TYPES } from './field-render';
import type { Option } from './select-legacy';

const FULL_WIDTH = new Set(['textarea', 'multipicklist', 'address']);

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
  const editable = useMemo(() => fields.filter((f) => !READONLY_FIELD_TYPES.has(f.type)), [fields]);
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

  // Reference fields need the option object (id + label) for the Combobox to
  // render the selection, but the form value is just the id. We track the
  // label map locally and feed it to the Combobox on render.
  const [refOptions, setRefOptions] = useState<Record<string, Option | null>>({});

  const schema = useMemo(() => recordValueSchema(editable), [editable]);
  type FormValues = Record<string, unknown>;
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    mode: 'onBlur',
    defaultValues: {},
  });

  useEffect(() => {
    if (!open) return;
    const d = (record?.data ?? {}) as FormValues;
    form.reset(d);
    const ro: Record<string, Option | null> = {};
    for (const f of editable) {
      if (f.type === 'reference' && d[f.key]) {
        const id = String(d[f.key]);
        ro[f.key] = { value: id, label: refLabels?.[id] ?? id };
      }
    }
    setRefOptions(ro);
  }, [open, record, editable, refLabels, form]);

  const create = trpc.record.create.useMutation({ meta: { silent: true } });
  const update = trpc.record.update.useMutation({ meta: { silent: true } });
  const saving = create.isPending || update.isPending;

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      if (record) await update.mutateAsync({ objectKey, id: record.id, data: values });
      else await create.mutateAsync({ objectKey, data: values });
      await utils.record.list.invalidate();
      if (record) await utils.record.get.invalidate({ objectKey, id: record.id });
      onClose();
    } catch (err) {
      // Surface the server error as a toast (we silenced the global one
      // because the form has its own context). Field-level server errors
      // would route through setError per key when the API grows them.
      notifyError(err, record ? "Couldn't save changes" : "Couldn't create record");
    }
  });

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
          <Button disabled={saving || !form.formState.isDirty} onClick={onSubmit}>
            {saving && <Loader2 className="animate-spin" />}
            {record ? 'Save changes' : 'Create'}
          </Button>
        </>
      }
    >
      <form onSubmit={onSubmit}>
        {groups.map((g) => (
          <div key={g.id} className="form-section">
            {g.label && <div className="form-section__label">{g.label}</div>}
            <div
              className="form-grid"
              style={{ gridTemplateColumns: `repeat(${g.cols}, minmax(0,1fr))` }}
            >
              {g.fields.map((f) => (
                <Controller
                  key={f.key}
                  name={f.key}
                  control={form.control}
                  render={({ field: rhfField, fieldState }) => (
                    <Field
                      label={f.label}
                      required={f.required}
                      description={f.config?.description}
                      helpText={f.config?.helpText}
                      error={fieldState.error?.message}
                      className={g.cols > 1 && FULL_WIDTH.has(f.type) ? 'col-span-full' : undefined}
                    >
                      <FieldInput
                        field={f}
                        value={rhfField.value}
                        onChange={(v) => rhfField.onChange(v)}
                        referenceValue={refOptions[f.key] ?? null}
                        onReferenceChange={(o) => {
                          setRefOptions((s) => ({ ...s, [f.key]: o }));
                          rhfField.onChange(o?.value ?? null);
                        }}
                        loadReference={
                          f.type === 'reference'
                            ? (query) =>
                                utils.record.searchRefs.fetch({
                                  objectKey: f.config?.targetObject ?? '',
                                  q: query,
                                })
                            : undefined
                        }
                      />
                    </Field>
                  )}
                />
              ))}
            </div>
          </div>
        ))}
      </form>
    </RecordDrawer>
  );
}
