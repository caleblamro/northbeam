'use client';

// Config forms for the logic nodes: assignment (vars / in-memory record
// fields), get_records (bounded query into a variable), loop (iterate a
// collection var), wait (duration | until | relative to a date field —
// SF "scheduled paths").

import { Field } from '@/components/northbeam/field';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { FlowNodeOfType } from '@northbeam/core/flow';
import { Plus, Trash2 } from 'lucide-react';
import { useId } from 'react';
import { MergeFieldInput } from '../merge-field-input';
import {
  FlowFiltersEditor,
  type FlowPanelMeta,
  LogicSelect,
  ObjectKeySelect,
  VarNameField,
  useObjectFields,
  writableFields,
} from './shared';

/* ── Assignment ─────────────────────────────────────────────────────────── */

type AssignmentConfig = FlowNodeOfType<'assignment'>['config'];
type Assignment = AssignmentConfig['assignments'][number];

export function AssignmentPanel({
  config,
  onConfig,
  meta,
}: {
  config: AssignmentConfig;
  onConfig: (next: AssignmentConfig) => void;
  meta: FlowPanelMeta;
}) {
  const rows = config.assignments;
  const patch = (i: number, next: Assignment) =>
    onConfig({ assignments: rows.map((r, idx) => (idx === i ? next : r)) });

  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-xs">
        Record-field assignments are in-memory only — add an Update records step to persist them
        (Salesforce semantics).
      </p>
      {rows.map((row, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows have no stable id; order-only edits
        <div key={i} className="flex flex-col gap-2 rounded-md border bg-card p-3">
          <div className="grid grid-cols-[minmax(0,130px)_minmax(0,1fr)_auto] items-end gap-2">
            <Select
              value={row.target.scope}
              onValueChange={(scope) =>
                patch(i, {
                  ...row,
                  target:
                    scope === 'vars'
                      ? { scope: 'vars', name: 'value' }
                      : { scope: 'record', fieldKey: meta.fields[0]?.key ?? '' },
                })
              }
            >
              <SelectTrigger aria-label={`Assignment ${i + 1} target`} className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="vars">Variable</SelectItem>
                <SelectItem value="record">Record field</SelectItem>
              </SelectContent>
            </Select>
            {row.target.scope === 'vars' ? (
              <Input
                value={row.target.name}
                aria-label={`Assignment ${i + 1} variable`}
                spellCheck={false}
                className="font-mono text-xs"
                onChange={(e) =>
                  patch(i, { ...row, target: { scope: 'vars', name: e.target.value } })
                }
              />
            ) : (
              <Select
                value={row.target.fieldKey || undefined}
                onValueChange={(fieldKey) =>
                  patch(i, { ...row, target: { scope: 'record', fieldKey } })
                }
              >
                <SelectTrigger aria-label={`Assignment ${i + 1} field`} className="w-full">
                  <SelectValue placeholder="Field…" />
                </SelectTrigger>
                <SelectContent>
                  {writableFields(meta.fields).map((f) => (
                    <SelectItem key={f.key} value={f.key}>
                      {f.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={`Remove assignment ${i + 1}`}
              disabled={rows.length <= 1}
              onClick={() => onConfig({ assignments: rows.filter((_, idx) => idx !== i) })}
            >
              <Trash2 />
            </Button>
          </div>
          <MergeFieldInput
            value={row.value == null ? '' : String(row.value)}
            onChange={(value) => patch(i, { ...row, value })}
            paths={meta.mergePaths}
            aria-label={`Assignment ${i + 1} value`}
            placeholder="Value or {{merge}}"
          />
        </div>
      ))}
      <div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={rows.length >= 20}
          onClick={() =>
            onConfig({
              assignments: [...rows, { target: { scope: 'vars', name: 'value' }, value: '' }],
            })
          }
        >
          <Plus />
          Add assignment
        </Button>
      </div>
    </div>
  );
}

/* ── Get records ────────────────────────────────────────────────────────── */

type GetRecordsConfig = FlowNodeOfType<'get_records'>['config'];

export function GetRecordsPanel({
  config,
  onConfig,
  meta,
}: {
  config: GetRecordsConfig;
  onConfig: (next: GetRecordsConfig) => void;
  meta: FlowPanelMeta;
}) {
  const fields = useObjectFields(config.objectKey || null);
  const limitId = useId();
  const sortId = useId();
  const filters = config.filters ?? [];

  return (
    <div className="flex flex-col gap-4">
      <ObjectKeySelect
        value={config.objectKey}
        onChange={(objectKey) =>
          onConfig({ ...config, objectKey, filters: undefined, sort: undefined })
        }
        objects={meta.objects}
      />

      {filters.length > 1 && (
        <LogicSelect
          value={config.logic ?? 'and'}
          onChange={(logic) => onConfig({ ...config, logic })}
        />
      )}
      <Field label="Conditions">
        <FlowFiltersEditor
          fields={fields}
          filters={filters}
          onChange={(next) => onConfig({ ...config, filters: next.length > 0 ? next : undefined })}
        />
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Field label="Sort by" htmlFor={sortId}>
          <Select
            value={config.sort?.fieldKey ?? '__none__'}
            onValueChange={(key) =>
              onConfig({
                ...config,
                sort:
                  key === '__none__'
                    ? undefined
                    : { fieldKey: key, direction: config.sort?.direction ?? 'asc' },
              })
            }
          >
            <SelectTrigger id={sortId} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">None</SelectItem>
              {fields.map((f) => (
                <SelectItem key={f.key} value={f.key}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Direction">
          <Select
            value={config.sort?.direction ?? 'asc'}
            onValueChange={(direction) =>
              config.sort &&
              onConfig({
                ...config,
                sort: { ...config.sort, direction: direction as 'asc' | 'desc' },
              })
            }
          >
            <SelectTrigger aria-label="Sort direction" className="w-full" disabled={!config.sort}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="asc">Ascending</SelectItem>
              <SelectItem value="desc">Descending</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>

      <Field label="Limit" htmlFor={limitId} description="At most 200 records.">
        <Input
          id={limitId}
          type="number"
          min={1}
          max={200}
          value={config.limit}
          className="w-28 tabular-nums"
          onChange={(e) =>
            onConfig({ ...config, limit: Math.max(1, Math.min(200, Number(e.target.value))) })
          }
        />
      </Field>

      <VarNameField
        label="Store results in"
        value={config.assignTo}
        onChange={(assignTo) => onConfig({ ...config, assignTo })}
        description="Read later as {{vars.name}} or loop over it."
      />
    </div>
  );
}

/* ── Loop ───────────────────────────────────────────────────────────────── */

type LoopConfig = FlowNodeOfType<'loop'>['config'];

export function LoopPanel({
  config,
  onConfig,
  collectionVars,
}: {
  config: LoopConfig;
  onConfig: (next: LoopConfig) => void;
  /** Vars known to hold collections (get_records assignTo across the graph). */
  collectionVars: string[];
}) {
  return (
    <div className="flex flex-col gap-4">
      {collectionVars.length > 0 && (
        <Field label="Collection">
          <Select
            value={config.sourceVar || undefined}
            onValueChange={(sourceVar) => onConfig({ sourceVar })}
          >
            <SelectTrigger aria-label="Collection variable" className="w-full">
              <SelectValue placeholder="Choose a variable…" />
            </SelectTrigger>
            <SelectContent>
              {collectionVars.map((name) => (
                <SelectItem key={name} value={name}>
                  {`{{vars.${name}}}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
      <VarNameField
        label="Source variable"
        value={config.sourceVar}
        onChange={(sourceVar) => onConfig({ sourceVar })}
        description="Each item is {{loopItem}} inside the For-each path. Up to 200 iterations."
      />
    </div>
  );
}

/* ── Wait ───────────────────────────────────────────────────────────────── */

type WaitConfig = FlowNodeOfType<'wait'>['config'];
type WaitUnit = Extract<WaitConfig, { kind: 'duration' }>['unit'];

const WAIT_UNITS: WaitUnit[] = ['minutes', 'hours', 'days'];

export function WaitPanel({
  config,
  onConfig,
  meta,
}: {
  config: WaitConfig;
  onConfig: (next: WaitConfig) => void;
  meta: FlowPanelMeta;
}) {
  const kindId = useId();
  const dateFields = meta.fields.filter((f) => f.type === 'date' || f.type === 'datetime');
  const recordTrigger = meta.trigger?.type === 'trigger_record';

  return (
    <div className="flex flex-col gap-4">
      <Field label="Wait" htmlFor={kindId}>
        <Select
          value={config.kind}
          onValueChange={(kind) => {
            if (kind === 'duration') onConfig({ kind: 'duration', amount: 1, unit: 'days' });
            else if (kind === 'until') onConfig({ kind: 'until', at: '' });
            else
              onConfig({
                kind: 'relative_to_field',
                fieldKey: dateFields[0]?.key ?? '',
                offset: 1,
                unit: 'days',
              });
          }}
        >
          <SelectTrigger id={kindId} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="duration">For a duration</SelectItem>
            <SelectItem value="until">Until a moment</SelectItem>
            <SelectItem value="relative_to_field">Relative to a date field</SelectItem>
          </SelectContent>
        </Select>
      </Field>

      {config.kind === 'duration' && (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Amount">
            <Input
              type="number"
              min={1}
              aria-label="Amount"
              value={config.amount}
              className="tabular-nums"
              onChange={(e) => onConfig({ ...config, amount: Math.max(1, Number(e.target.value)) })}
            />
          </Field>
          <Field label="Unit">
            <Select
              value={config.unit}
              onValueChange={(unit) => onConfig({ ...config, unit: unit as WaitUnit })}
            >
              <SelectTrigger aria-label="Unit" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WAIT_UNITS.map((u) => (
                  <SelectItem key={u} value={u}>
                    {u}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      )}

      {config.kind === 'until' && (
        <Field label="Until" description="An ISO datetime, or a {{merge}} resolving to one.">
          <MergeFieldInput
            value={config.at}
            onChange={(at) => onConfig({ kind: 'until', at })}
            paths={meta.mergePaths}
            aria-label="Until"
            placeholder="2026-08-01T09:00:00Z or {{record.renewal_date}}"
          />
        </Field>
      )}

      {config.kind === 'relative_to_field' && (
        <>
          {!recordTrigger && (
            <Callout variant="warning">
              Field-relative waits need a record trigger — the field is re-read from the trigger
              record at fire time.
            </Callout>
          )}
          <Field label="Date field">
            <Select
              value={config.fieldKey || undefined}
              onValueChange={(fieldKey) => onConfig({ ...config, fieldKey })}
            >
              <SelectTrigger aria-label="Date field" className="w-full">
                <SelectValue placeholder="Choose field…" />
              </SelectTrigger>
              <SelectContent>
                {dateFields.map((f) => (
                  <SelectItem key={f.key} value={f.key}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-3 gap-2">
            <Field label="Offset">
              <Input
                type="number"
                min={0}
                aria-label="Offset"
                value={Math.abs(config.offset)}
                className="tabular-nums"
                onChange={(e) => {
                  const magnitude = Math.max(0, Number(e.target.value));
                  onConfig({ ...config, offset: config.offset < 0 ? -magnitude : magnitude });
                }}
              />
            </Field>
            <Field label="Unit">
              <Select
                value={config.unit}
                onValueChange={(unit) => onConfig({ ...config, unit: unit as WaitUnit })}
              >
                <SelectTrigger aria-label="Unit" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WAIT_UNITS.map((u) => (
                    <SelectItem key={u} value={u}>
                      {u}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="When">
              <Select
                value={config.offset < 0 ? 'before' : 'after'}
                onValueChange={(when) =>
                  onConfig({
                    ...config,
                    offset: when === 'before' ? -Math.abs(config.offset) : Math.abs(config.offset),
                  })
                }
              >
                <SelectTrigger aria-label="Before or after" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="before">Before</SelectItem>
                  <SelectItem value="after">After</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>
        </>
      )}
    </div>
  );
}
