'use client';

// Shared plumbing for the per-node config panels: the metadata bundle the
// editor threads down (FlowPanelMeta) plus the small composite editors
// (record targets, field/value maps, filter lists, var names) reused across
// the trigger/logic/action panels.

import { Field } from '@/components/northbeam/field';
import type { FieldDefLite } from '@/components/northbeam/field-render';
import { READONLY_FIELD_TYPES } from '@/components/northbeam/field-render';
import { FilterRow } from '@/components/northbeam/filter-bar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { trpc } from '@/lib/api';
import type { Filter } from '@/lib/filters';
import type {
  FlowFilter,
  FlowRecordTarget,
  FlowTrigger,
  FlowUpdateTarget,
} from '@northbeam/core/flow';
import { Plus, Trash2 } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { MergeFieldInput, type MergeFieldPath } from '../merge-field-input';

export type FlowPanelMeta = {
  flowId: string;
  /** Trigger object (null for global scheduled/webhook flows). */
  objectKey: string | null;
  objects: Array<{ id: string; key: string; label: string }>;
  /** Fields of the trigger object. */
  fields: FieldDefLite[];
  members: Array<{ userId: string; name: string | null; email: string }>;
  mergePaths: MergeFieldPath[];
  trigger: FlowTrigger | null;
  webhookSecret: string | null;
  webhookUrl: string | null;
};

const NO_FIELDS: FieldDefLite[] = [];

/** Fields of an arbitrary object, for panels that target objects other than
 *  the trigger's (get_records, create_record, update-by-query). */
export function useObjectFields(objectKey: string | null | undefined): FieldDefLite[] {
  const q = trpc.object.get.useQuery({ key: objectKey ?? '' }, { enabled: Boolean(objectKey) });
  return objectKey ? (q.data?.fields ?? NO_FIELDS) : NO_FIELDS;
}

/** Writable (non-computed) fields for create/update value maps. */
export function writableFields(fields: FieldDefLite[]): FieldDefLite[] {
  return fields.filter((f) => !READONLY_FIELD_TYPES.has(f.type));
}

export const VAR_NAME_RE = /^[a-z][a-zA-Z0-9_]{0,39}$/;

export function VarNameField({
  label,
  value,
  onChange,
  description,
}: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  description?: string;
}) {
  const id = useId();
  const invalid = value.length > 0 && !VAR_NAME_RE.test(value);
  return (
    <Field
      label={label}
      htmlFor={id}
      description={description}
      error={invalid ? 'Lowercase letter first, then letters/digits/underscores.' : undefined}
    >
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        className="font-mono text-xs"
        placeholder="my_variable"
      />
    </Field>
  );
}

export function ObjectKeySelect({
  value,
  onChange,
  objects,
  label = 'Object',
}: {
  value: string;
  onChange: (key: string) => void;
  objects: FlowPanelMeta['objects'];
  label?: string;
}) {
  const id = useId();
  return (
    <Field label={label} htmlFor={id}>
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue placeholder="Choose object…" />
        </SelectTrigger>
        <SelectContent>
          {objects.map((o) => (
            <SelectItem key={o.key} value={o.key}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

export function MembersSelect({
  value,
  onChange,
  members,
  label,
}: {
  value: string;
  onChange: (userId: string) => void;
  members: FlowPanelMeta['members'];
  label?: string;
}) {
  const id = useId();
  const select = (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger id={id} className="w-full" aria-label={label ?? 'Member'}>
        <SelectValue placeholder="Choose member…" />
      </SelectTrigger>
      <SelectContent>
        {members.map((m) => (
          <SelectItem key={m.userId} value={m.userId}>
            {m.name || m.email}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
  return label ? (
    <Field label={label} htmlFor={id}>
      {select}
    </Field>
  ) : (
    select
  );
}

/* ── Filters ─────────────────────────────────────────────────────────────── */

/** FlowFilter mirrors the db Filter shape verbatim (op set sync-pinned in
 *  core), so FilterRow from filter-bar.tsx works uncast. */
export function FlowFiltersEditor({
  fields,
  filters,
  onChange,
  minRows = 0,
}: {
  fields: FieldDefLite[];
  filters: FlowFilter[];
  onChange: (next: FlowFilter[]) => void;
  /** Conditions that zod requires at least one of keep their last row. */
  minRows?: number;
}) {
  const byKey = useMemo(() => new Map(fields.map((f) => [f.key, f])), [fields]);
  const first = fields[0];

  return (
    <div className="flex flex-col gap-2">
      {filters.map((row, i) => (
        <FilterRow
          // biome-ignore lint/suspicious/noArrayIndexKey: rows have no stable id; order-only edits
          key={i}
          index={i}
          row={row as Filter}
          fields={fields}
          byKey={byKey}
          onChange={(patch) =>
            onChange(filters.map((f, idx) => (idx === i ? { ...f, ...patch } : f)))
          }
          onRemove={() => {
            if (filters.length <= minRows) return;
            onChange(filters.filter((_, idx) => idx !== i));
          }}
        />
      ))}
      <div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!first || filters.length >= 10}
          onClick={() =>
            first && onChange([...filters, { fieldKey: first.key, op: 'isSet', value: null }])
          }
        >
          <Plus />
          Add condition
        </Button>
      </div>
    </div>
  );
}

export function LogicSelect({
  value,
  onChange,
}: {
  value: 'and' | 'or';
  onChange: (next: 'and' | 'or') => void;
}) {
  const id = useId();
  return (
    <Field label="Match" htmlFor={id}>
      <Select value={value} onValueChange={(v) => onChange(v as 'and' | 'or')}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="and">All conditions</SelectItem>
          <SelectItem value="or">Any condition</SelectItem>
        </SelectContent>
      </Select>
    </Field>
  );
}

/* ── Record targets ──────────────────────────────────────────────────────── */

const RECORD_TARGET_LABEL: Record<FlowRecordTarget['kind'], string> = {
  trigger_record: 'The trigger record',
  loop_item: 'The current loop item',
  var: 'A record in a variable',
};

export function RecordTargetEditor({
  value,
  onChange,
}: {
  value: FlowRecordTarget;
  onChange: (next: FlowRecordTarget) => void;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2">
      <Field label="Target" htmlFor={id}>
        <Select
          value={value.kind}
          onValueChange={(kind) =>
            onChange(
              kind === 'var'
                ? { kind: 'var', name: 'record' }
                : { kind: kind as 'trigger_record' | 'loop_item' },
            )
          }
        >
          <SelectTrigger id={id} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(RECORD_TARGET_LABEL) as FlowRecordTarget['kind'][]).map((kind) => (
              <SelectItem key={kind} value={kind}>
                {RECORD_TARGET_LABEL[kind]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {value.kind === 'var' && (
        <VarNameField
          label="Variable"
          value={value.name}
          onChange={(name) => onChange({ kind: 'var', name })}
        />
      )}
    </div>
  );
}

export function UpdateTargetEditor({
  value,
  onChange,
  meta,
}: {
  value: FlowUpdateTarget;
  onChange: (next: FlowUpdateTarget) => void;
  meta: FlowPanelMeta;
}) {
  const id = useId();
  const queryFields = useObjectFields(value.kind === 'query' ? value.objectKey : null);
  const firstObject = meta.objects[0];

  return (
    <div className="flex flex-col gap-2">
      <Field label="Target" htmlFor={id}>
        <Select
          value={value.kind}
          onValueChange={(kind) => {
            if (kind === 'var') onChange({ kind: 'var', name: 'record' });
            else if (kind === 'query')
              onChange({
                kind: 'query',
                objectKey: meta.objectKey ?? firstObject?.key ?? '',
                filters: [{ fieldKey: '', op: 'isSet', value: null }],
                logic: 'and',
                limit: 50,
              });
            else onChange({ kind: kind as 'trigger_record' | 'loop_item' });
          }}
        >
          <SelectTrigger id={id} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(RECORD_TARGET_LABEL) as FlowRecordTarget['kind'][]).map((kind) => (
              <SelectItem key={kind} value={kind}>
                {RECORD_TARGET_LABEL[kind]}
              </SelectItem>
            ))}
            <SelectItem value="query">Records matching a query</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      {value.kind === 'var' && (
        <VarNameField
          label="Variable"
          value={value.name}
          onChange={(name) => onChange({ kind: 'var', name })}
        />
      )}
      {value.kind === 'query' && (
        <div className="flex flex-col gap-2 rounded-md border border-dashed p-2.5">
          <ObjectKeySelect
            value={value.objectKey}
            onChange={(objectKey) => onChange({ ...value, objectKey })}
            objects={meta.objects}
          />
          <LogicSelect value={value.logic} onChange={(logic) => onChange({ ...value, logic })} />
          <FlowFiltersEditor
            fields={queryFields}
            filters={value.filters}
            minRows={1}
            onChange={(filters) => onChange({ ...value, filters })}
          />
          <Field label="Limit">
            <Input
              type="number"
              min={1}
              max={200}
              value={value.limit}
              aria-label="Limit"
              onChange={(e) =>
                onChange({ ...value, limit: Math.max(1, Math.min(200, Number(e.target.value))) })
              }
              className="w-28 tabular-nums"
            />
          </Field>
        </div>
      )}
    </div>
  );
}

/* ── Field → value map (create_record / update_records) ─────────────────── */

type FieldValueRow = { key: string; value: string };

function toRows(fields: Record<string, string | number | boolean | null>): FieldValueRow[] {
  return Object.entries(fields).map(([key, v]) => ({ key, value: v == null ? '' : String(v) }));
}

export function FieldValuesEditor({
  objectFields,
  value,
  onChange,
  mergePaths,
}: {
  objectFields: FieldDefLite[];
  value: Record<string, string | number | boolean | null>;
  onChange: (next: Record<string, string | number | boolean | null>) => void;
  mergePaths: MergeFieldPath[];
}) {
  // Local rows keep ordering + allow a not-yet-keyed row; the committed
  // config only ever contains keyed entries. Host remounts per node id.
  const [rows, setRows] = useState<FieldValueRow[]>(() => toRows(value));
  const writable = writableFields(objectFields);

  const commit = (next: FieldValueRow[]) => {
    setRows(next);
    onChange(Object.fromEntries(next.filter((r) => r.key).map((r) => [r.key, r.value])));
  };

  return (
    <div className="flex flex-col gap-2">
      {rows.map((row, i) => (
        <div
          // biome-ignore lint/suspicious/noArrayIndexKey: rows have no stable id; order-only edits
          key={i}
          className="grid grid-cols-[minmax(0,140px)_minmax(0,1fr)_auto] items-end gap-2"
        >
          <Select
            value={row.key || undefined}
            onValueChange={(key) => commit(rows.map((r, idx) => (idx === i ? { ...r, key } : r)))}
          >
            <SelectTrigger aria-label={`Field ${i + 1}`} className="w-full">
              <SelectValue placeholder="Field…" />
            </SelectTrigger>
            <SelectContent>
              {writable.map((f) => (
                <SelectItem key={f.key} value={f.key}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <MergeFieldInput
            value={row.value}
            onChange={(v) => commit(rows.map((r, idx) => (idx === i ? { ...r, value: v } : r)))}
            paths={mergePaths}
            aria-label={`Value ${i + 1}`}
            placeholder="Value or {{merge}}"
          />
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={`Remove field ${i + 1}`}
            onClick={() => commit(rows.filter((_, idx) => idx !== i))}
          >
            <Trash2 />
          </Button>
        </div>
      ))}
      <div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={rows.length >= 50}
          onClick={() => commit([...rows, { key: '', value: '' }])}
        >
          <Plus />
          Set field
        </Button>
      </div>
    </div>
  );
}
