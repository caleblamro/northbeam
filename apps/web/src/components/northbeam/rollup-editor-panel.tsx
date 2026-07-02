'use client';

// Roll-up summary config panel: pick the child object (auto-discovered from
// lookup fields pointing back at this object), the lookup to relate through,
// the aggregate, the child field to aggregate, and an optional child-filter
// formula. Discovery is client-side — object.list, then object.get per
// object, scanning for reference fields whose config.targetObject is this
// object's key. Modeled on the rollup block in
// design_handoff_northbeam/studio-fieldeditor.jsx, restyled with tokens.

import { Field } from '@/components/northbeam/field';
import type { FieldDefLite } from '@/components/northbeam/field-render';
import { FormulaEditorPanel } from '@/components/northbeam/formula-editor-panel';
import { Callout } from '@/components/ui/callout';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { trpc } from '@/lib/api';
import {
  type FieldType,
  type RollupFieldConfig,
  type RollupFn,
  fieldTypeMeta,
  narrowFieldConfig,
} from '@northbeam/db/field-types';
import { Info } from 'lucide-react';
import { ObjChip } from './app-bits';

/** In-flight rollup config — every key optional so partial drafts compile.
 *  The field editor validates completeness (via safeValidateFieldConfig)
 *  before submitting. */
export type RollupDraft = Partial<NonNullable<RollupFieldConfig['rollup']>>;

const AGGREGATES: { value: RollupFn; label: string }[] = [
  { value: 'count', label: 'Count' },
  { value: 'sum', label: 'Sum' },
  { value: 'avg', label: 'Average' },
  { value: 'min', label: 'Min' },
  { value: 'max', label: 'Max' },
];

const NUMERIC_CHILD_TYPES = new Set<FieldType>(['number', 'currency', 'percent']);

type ChildCandidate = {
  key: string;
  label: string;
  labelPlural: string;
  color: string | null;
  /** Reference fields on the child pointing back at this object. */
  viaFields: { key: string; label: string }[];
  /** Aggregatable (numeric) child fields. */
  numericFields: { key: string; label: string; type: FieldType }[];
  /** All child fields, for the child-filter formula editor. */
  fields: FieldDefLite[];
};

export function RollupEditorPanel({
  objectKey,
  objectLabel,
  value,
  onChange,
  disabled,
}: {
  /** The PARENT object (the one the rollup field lives on). */
  objectKey: string;
  objectLabel: string;
  value: RollupDraft;
  onChange: (next: RollupDraft) => void;
  disabled?: boolean;
}) {
  const objectsQuery = trpc.object.list.useQuery({});
  const detailQueries = trpc.useQueries((t) =>
    (objectsQuery.data ?? []).map((o) => t.object.get({ key: o.key })),
  );
  const loading = objectsQuery.isLoading || detailQueries.some((q) => q.isLoading);

  const candidates: ChildCandidate[] = [];
  for (const q of detailQueries) {
    if (!q.data) continue;
    const { object, fields } = q.data;
    const viaFields = fields
      .filter(
        (f) =>
          f.type === 'reference' &&
          narrowFieldConfig('reference', f.config).targetObject === objectKey,
      )
      .map((f) => ({ key: f.key, label: f.label }));
    if (viaFields.length === 0) continue;
    candidates.push({
      key: object.key,
      label: object.label,
      labelPlural: object.labelPlural,
      color: object.color,
      viaFields,
      numericFields: fields
        .filter((f) => NUMERIC_CHILD_TYPES.has(f.type))
        .map((f) => ({ key: f.key, label: f.label, type: f.type })),
      fields: fields.map((f) => ({
        key: f.key,
        label: f.label,
        type: f.type,
        config: f.config,
        required: f.required,
      })),
    });
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-9 w-full" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }

  if (candidates.length === 0) {
    return (
      <Callout variant="info" icon={Info} title={`No objects reference ${objectLabel}`}>
        Add a Lookup field on another object pointing at {objectLabel} first — roll-ups aggregate
        those child records.
      </Callout>
    );
  }

  const child = candidates.find((c) => c.key === value.childObject);
  const fn = value.fn ?? 'count';
  const returnType: FieldType | undefined =
    fn === 'count' ? 'number' : child?.numericFields.find((f) => f.key === value.childField)?.type;

  const setChild = (key: string) => {
    const next = candidates.find((c) => c.key === key);
    onChange({
      childObject: key,
      // Single lookup back at us → no ambiguity, pre-select it.
      via: next && next.viaFields.length === 1 ? next.viaFields[0]?.key : undefined,
      fn,
    });
  };

  const setFn = (next: RollupFn) => {
    onChange({ ...value, fn: next, childField: next === 'count' ? undefined : value.childField });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Child object" description="The records being aggregated.">
          <Select value={value.childObject ?? ''} onValueChange={setChild} disabled={disabled}>
            <SelectTrigger className="w-full" aria-label="Child object">
              <SelectValue placeholder="Pick an object…" />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((c) => (
                <SelectItem key={c.key} value={c.key}>
                  <ObjChip label={c.label} color={c.color ?? undefined} size={18} />
                  {c.labelPlural}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field
          label="Related via"
          description={`The lookup on the child that points at ${objectLabel}.`}
        >
          <Select
            value={value.via ?? ''}
            onValueChange={(via) => onChange({ ...value, via })}
            disabled={disabled || !child}
          >
            <SelectTrigger className="w-full" aria-label="Related via">
              <SelectValue placeholder="Pick a lookup…" />
            </SelectTrigger>
            <SelectContent>
              {(child?.viaFields ?? []).map((f) => (
                <SelectItem key={f.key} value={f.key}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Aggregate">
          <Select value={fn} onValueChange={(v) => setFn(v as RollupFn)} disabled={disabled}>
            <SelectTrigger className="w-full" aria-label="Aggregate">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AGGREGATES.map((a) => (
                <SelectItem key={a.value} value={a.value}>
                  {a.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        {fn !== 'count' && (
          <Field label="Field to aggregate">
            <Select
              value={value.childField ?? ''}
              onValueChange={(childField) => onChange({ ...value, childField })}
              disabled={disabled || !child}
            >
              <SelectTrigger className="w-full" aria-label="Field to aggregate">
                <SelectValue placeholder="Pick a numeric field…" />
              </SelectTrigger>
              <SelectContent>
                {(child?.numericFields ?? []).map((f) => (
                  <SelectItem key={f.key} value={f.key}>
                    {f.label}
                    <span className="text-muted-foreground text-xs">
                      {fieldTypeMeta(f.type).label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
      </div>

      {child && (
        <Field
          label="Child filter"
          optional
          description="Northbeam formula evaluated per child record — only children where it's truthy are aggregated."
        >
          <FormulaEditorPanel
            fields={child.fields}
            formula={value.filter ?? ''}
            onChange={(filter) => onChange({ ...value, filter: filter || undefined })}
            disabled={disabled}
          />
        </Field>
      )}

      {returnType && (
        <p className="text-muted-foreground text-xs">
          Returns: <span className="font-medium">{fieldTypeMeta(returnType).label}</span>
          {fn !== 'count' && ' (the aggregated field’s type)'}
        </p>
      )}
    </div>
  );
}
