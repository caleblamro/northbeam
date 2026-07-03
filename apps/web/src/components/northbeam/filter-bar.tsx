'use client';

// FilterDialog — icon-button that opens a dialog for managing all filters at
// once (field / operator / value per row).  FilterRow is the individual row
// inside that dialog and is also re-used by object-rule-editors.tsx for format-
// rule conditions, which share the same field/op/value shape.
//
// Filtering runs server-side via record.list; the web and API layers share the
// same Filter type from @northbeam/db/views.

import { Field } from '@/components/northbeam/field';
import type { FieldDefLite } from '@/components/northbeam/field-render';
import { Combobox, type Option } from '@/components/northbeam/select-legacy';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  type Filter,
  type FilterOp,
  OP_LABEL,
  RELATIVE_DATE_PRESETS,
  UNARY_OPS,
  isFilterable,
  isRelativeDateToken,
  opsForType,
} from '@/lib/filters';
import { Filter as FilterIcon, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';

type ReferenceLoader = (objectKey: string, query: string) => Promise<Option[]>;

/* ── FilterDialog ────────────────────────────────────────────────────────────
   Single icon button (Filter) that opens a Dialog for managing all filters
   at once. Each row exposes field, operator and value selection inline; rows
   can be removed via the trash button and added via the footer "Add filter"
   button. Apply commits the staged filter list back to the parent; Cancel
   discards. The trigger button shows a count badge when filters are active.
   ────────────────────────────────────────────────────────────────────────── */

interface FilterDialogProps {
  fields: FieldDefLite[];
  filters: Filter[];
  onChange: (filters: Filter[]) => void;
  loadReferenceOptions?: ReferenceLoader;
}

export function FilterDialog({
  fields,
  filters,
  onChange,
  loadReferenceOptions,
}: FilterDialogProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Filter[]>(filters);
  const filterable = fields.filter(isFilterable);
  const byKey = new Map(fields.map((f) => [f.key, f]));

  // Reset draft each time the dialog opens.
  const handleOpen = (next: boolean) => {
    if (next) setDraft(filters);
    setOpen(next);
  };

  const apply = () => {
    onChange(draft.filter((f) => f.fieldKey));
    setOpen(false);
  };

  const addBlank = () => {
    const first = filterable[0];
    if (!first) return;
    const op = opsForType(first.type)[0] ?? 'eq';
    setDraft((d) => [...d, { fieldKey: first.key, op, value: null }]);
  };

  const updateAt = (i: number, patch: Partial<Filter>) => {
    setDraft((d) => d.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  };

  const removeAt = (i: number) => {
    setDraft((d) => d.filter((_, idx) => idx !== i));
  };

  const clearAll = () => setDraft([]);

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-label="Filters"
          className="relative gap-1.5"
        >
          <FilterIcon className="size-3.5" />
          {filters.length > 0 && (
            <Badge tone="accent" size="sm" dot={false} className="h-4 min-w-4 px-1 tabular-nums">
              {filters.length}
            </Badge>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Filters</DialogTitle>
          <DialogDescription>
            Narrow the list to records that match every condition below.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-2">
          {draft.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-lg border border-border border-dashed py-10 text-center">
              <FilterIcon className="size-6 text-muted-foreground/60" />
              <div className="text-muted-foreground text-sm">No filters yet</div>
              <Button type="button" size="sm" variant="outline" onClick={addBlank}>
                <Plus />
                Add filter
              </Button>
            </div>
          ) : (
            <>
              {draft.map((row, i) => (
                <FilterRow
                  key={i}
                  index={i}
                  row={row}
                  fields={filterable}
                  byKey={byKey}
                  loadReferenceOptions={loadReferenceOptions}
                  onChange={(patch) => updateAt(i, patch)}
                  onRemove={() => removeAt(i)}
                />
              ))}
              <div className="flex items-center justify-between pt-1">
                <Button type="button" size="sm" variant="ghost" onClick={addBlank}>
                  <Plus />
                  Add filter
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-muted-foreground"
                  onClick={clearAll}
                >
                  Clear all
                </Button>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={apply}>
            Apply filters
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* One row inside the FilterDialog: field selector + operator + value + trash.
   Exported for reuse by the format-rules editor (object-rule-editors.tsx),
   whose rule conditions are the same field/op/value rows. */
export function FilterRow({
  index,
  row,
  fields,
  byKey,
  loadReferenceOptions,
  onChange,
  onRemove,
}: {
  index: number;
  row: Filter;
  fields: FieldDefLite[];
  byKey: Map<string, FieldDefLite>;
  loadReferenceOptions?: ReferenceLoader;
  onChange: (patch: Partial<Filter>) => void;
  onRemove: () => void;
}) {
  const field = byKey.get(row.fieldKey) ?? fields[0];
  if (!field) return null;
  const ops = opsForType(field.type);
  const isUnary = UNARY_OPS.has(row.op);
  const fieldId = `filter-field-${index}`;
  const opId = `filter-op-${index}`;
  const valueId = `filter-value-${index}`;

  return (
    <div className="grid grid-cols-[minmax(0,160px)_minmax(0,140px)_minmax(0,1fr)_auto] items-end gap-2 rounded-md bg-muted/30 p-2.5">
      <Field label="Field" htmlFor={fieldId}>
        <Select
          value={row.fieldKey}
          onValueChange={(k) => {
            const f = byKey.get(k);
            const nextOp = f ? (opsForType(f.type)[0] ?? row.op) : row.op;
            onChange({ fieldKey: k, op: nextOp, value: null });
          }}
        >
          <SelectTrigger id={fieldId} className="w-full">
            <SelectValue placeholder="Choose field…" />
          </SelectTrigger>
          <SelectContent>
            {fields.map((f) => (
              <SelectItem key={f.key} value={f.key}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Condition" htmlFor={opId}>
        <Select value={row.op} onValueChange={(v) => onChange({ op: v as FilterOp })}>
          <SelectTrigger id={opId} className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ops.map((op) => (
              <SelectItem key={op} value={op}>
                {OP_LABEL[op]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Value" htmlFor={valueId}>
        {isUnary || field.type === 'checkbox' ? (
          <div className="flex h-9 items-center text-muted-foreground text-xs italic">—</div>
        ) : (
          <FilterValueInput
            field={field}
            op={row.op}
            value={row.value}
            onChange={(v) => onChange({ value: v })}
            loadReferenceOptions={loadReferenceOptions}
          />
        )}
      </Field>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label={`Remove filter ${index + 1}`}
        onClick={onRemove}
        className="self-end"
      >
        <Trash2 />
      </Button>
    </div>
  );
}

/* ── Per-type value input ───────────────────────────────────────────────── */

function FilterValueInput({
  field,
  op,
  value,
  onChange,
  loadReferenceOptions,
}: {
  field: FieldDefLite;
  op: FilterOp;
  value: Filter['value'];
  onChange: (next: Filter['value']) => void;
  loadReferenceOptions?: ReferenceLoader;
}) {
  if (field.type === 'reference') {
    const targetObject = (field.config as { targetObject?: string } | null)?.targetObject ?? '';
    const selected: Option | null =
      value == null ? null : { value: String(value), label: String(value) };
    return (
      <Combobox
        value={selected}
        onChange={(o) => onChange(o?.value ?? null)}
        loadOptions={
          loadReferenceOptions ? (q) => loadReferenceOptions(targetObject, q) : async () => []
        }
        placeholder={`Search ${targetObject || 'records'}…`}
        emptyText="No matches"
      />
    );
  }

  if (field.type === 'picklist' || field.type === 'multipicklist') {
    const opts =
      (field.config as { options?: { value: string; label: string }[] } | null)?.options ?? [];
    return (
      <Select value={value == null ? '' : String(value)} onValueChange={(v) => onChange(v)}>
        <SelectTrigger id="filter-value">
          <SelectValue placeholder="Choose…" />
        </SelectTrigger>
        <SelectContent>
          {opts.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  if (field.type === 'date' || field.type === 'datetime') {
    return (
      <DateFilterValue
        value={value}
        onChange={onChange}
        inputType={field.type === 'date' ? 'date' : 'datetime-local'}
      />
    );
  }

  if (
    field.type === 'number' ||
    field.type === 'currency' ||
    field.type === 'percent' ||
    field.type === 'autonumber'
  ) {
    return (
      <Input
        id="filter-value"
        type="number"
        value={value == null ? '' : String(value)}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      />
    );
  }

  // text, textarea, email, url, phone, formula, rollup, ai — plain text input
  return (
    <Input
      id="filter-value"
      value={value == null ? '' : String(value)}
      onChange={(e) => onChange(e.target.value)}
      placeholder={op === 'contains' ? 'contains…' : ''}
    />
  );
}

/** Date/datetime value editor: relative presets ("Last 30 days" → '@-30d')
 *  keep saved views evergreen; "Specific date…" reveals the native picker.
 *  A token value selects its preset; anything else reads as custom. */
const CUSTOM_DATE = '__custom__';

function DateFilterValue({
  value,
  onChange,
  inputType,
}: {
  value: Filter['value'];
  onChange: (next: Filter['value']) => void;
  inputType: 'date' | 'datetime-local';
}) {
  const isToken = isRelativeDateToken(value);
  return (
    <div className="flex min-w-0 gap-1.5">
      <Select
        value={isToken ? String(value) : CUSTOM_DATE}
        onValueChange={(v) => onChange(v === CUSTOM_DATE ? '' : v)}
      >
        <SelectTrigger id="filter-value" className="min-w-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {RELATIVE_DATE_PRESETS.map((p) => (
            <SelectItem key={p.token} value={p.token}>
              {p.label}
            </SelectItem>
          ))}
          <SelectItem value={CUSTOM_DATE}>Specific date…</SelectItem>
        </SelectContent>
      </Select>
      {!isToken && (
        <Input
          type={inputType}
          aria-label="Specific date"
          value={value == null ? '' : String(value)}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}
