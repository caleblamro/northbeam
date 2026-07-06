'use client';

// FlowCondition editor — the shared condition surface for trigger entry
// conditions and decision outcomes. Two modes mirroring core's discriminated
// union: filter rows (field/op/value, all/any) or a Northbeam formula via the
// existing FormulaEditorPanel (live parse + known-key validation).

import type { FieldDefLite } from '@/components/northbeam/field-render';
import { FormulaEditorPanel } from '@/components/northbeam/formula-editor-panel';
import { Chip } from '@/components/ui/chip';
import { Switch } from '@/components/ui/switch';
import type { FlowCondition } from '@northbeam/core/flow';
import { useId } from 'react';
import { FlowFiltersEditor, LogicSelect } from './shared';

export function defaultCondition(fields: FieldDefLite[]): FlowCondition {
  return {
    mode: 'filters',
    logic: 'and',
    filters: [{ fieldKey: fields[0]?.key ?? '', op: 'isSet', value: null }],
  };
}

export function ConditionEditor({
  value,
  onChange,
  fields,
}: {
  value: FlowCondition;
  onChange: (next: FlowCondition) => void;
  fields: FieldDefLite[];
}) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex gap-1.5">
        <Chip
          type="button"
          selected={value.mode === 'filters'}
          onClick={() => value.mode !== 'filters' && onChange(defaultCondition(fields))}
        >
          Filters
        </Chip>
        <Chip
          type="button"
          selected={value.mode === 'formula'}
          onClick={() => value.mode !== 'formula' && onChange({ mode: 'formula', formula: '' })}
        >
          Formula
        </Chip>
      </div>

      {value.mode === 'filters' ? (
        <>
          <LogicSelect value={value.logic} onChange={(logic) => onChange({ ...value, logic })} />
          <FlowFiltersEditor
            fields={fields}
            filters={value.filters}
            minRows={1}
            onChange={(filters) =>
              onChange({ ...value, filters: filters.length > 0 ? filters : value.filters })
            }
          />
        </>
      ) : (
        <FormulaEditorPanel
          fields={fields}
          formula={value.formula}
          onChange={(formula) => onChange({ mode: 'formula', formula })}
        />
      )}
    </div>
  );
}

/** Optional condition (trigger entry conditions) — a switch reveals the
 *  editor; off = undefined = the flow runs for every event. */
export function OptionalConditionEditor({
  label,
  value,
  onChange,
  fields,
}: {
  label: string;
  value: FlowCondition | undefined;
  onChange: (next: FlowCondition | undefined) => void;
  fields: FieldDefLite[];
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="font-medium text-foreground text-sm">
          {label}
        </label>
        <Switch
          id={id}
          checked={value !== undefined}
          onCheckedChange={(on) => onChange(on ? defaultCondition(fields) : undefined)}
        />
      </div>
      {value !== undefined && <ConditionEditor value={value} onChange={onChange} fields={fields} />}
    </div>
  );
}
