'use client';

// FilterBar — chip strip + add/edit popover for dynamic record filters (#30).
// Controlled component: parent owns the filter array and the URL state. This
// component owns the in-progress draft inside the popover. When the user
// commits a draft, it bubbles up via onChange.
//
// Filtering runs client-side today (rowPassesFilters in /lib/filters); the
// component's API matches the eventual server-side `record.list` filters
// input shape so the swap is transparent.

import { Field } from '@/components/northbeam/field';
import type { FieldDefLite } from '@/components/northbeam/field-render';
import { Combobox, type Option } from '@/components/northbeam/select-legacy';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/cn';
import {
  type Filter,
  type FilterOp,
  OP_LABEL,
  UNARY_OPS,
  chipLabel,
  isFilterable,
  opsForType,
} from '@/lib/filters';
import { Filter as FilterIcon, Plus, Trash2, X } from 'lucide-react';
import { type ReactNode, useState } from 'react';

type ReferenceLoader = (objectKey: string, query: string) => Promise<Option[]>;

interface FilterBarProps {
  /** All fields available to filter on. Computed system fields are dimmed. */
  fields: FieldDefLite[];
  filters: Filter[];
  onChange: (filters: Filter[]) => void;
  /** Async option loader for `reference` field values. */
  loadReferenceOptions?: ReferenceLoader;
  /** Optional row above the filter chips (e.g., SavedViews tabs). */
  views?: ReactNode;
  /** Render flat (no margin/wrapping flex-col) — for embedding inside a toolbar. */
  inline?: boolean;
  className?: string;
}

export function FilterBar({
  fields,
  filters,
  onChange,
  loadReferenceOptions,
  views,
  inline,
  className,
}: FilterBarProps) {
  const byKey = new Map(fields.map((f) => [f.key, f]));

  const upsertAt = (index: number, next: Filter) => {
    const out = filters.slice();
    if (index < 0) out.push(next);
    else out[index] = next;
    onChange(out);
  };
  const removeAt = (index: number) => {
    onChange(filters.filter((_, i) => i !== index));
  };

  const chips = (
    <>
      {filters.map((f, i) => {
        const field = byKey.get(f.fieldKey);
        if (!field) return null;
        return (
          <FilterChipEditor
            key={i}
            fields={fields}
            field={field}
            filter={f}
            loadReferenceOptions={loadReferenceOptions}
            onApply={(next) => upsertAt(i, next)}
            onRemove={() => removeAt(i)}
          />
        );
      })}
      <FilterChipEditor
        mode="add"
        fields={fields}
        loadReferenceOptions={loadReferenceOptions}
        onApply={(next) => upsertAt(-1, next)}
      />
      {filters.length > 0 && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => onChange([])}
        >
          Clear all
        </Button>
      )}
    </>
  );

  if (inline) {
    return <div className={cn('flex flex-wrap items-center gap-1.5', className)}>{chips}</div>;
  }

  return (
    <div className={cn('mb-3 flex flex-col gap-2', className)}>
      {views && <div className="flex items-center gap-2 border-b">{views}</div>}
      <div className="flex flex-wrap items-center gap-1.5">{chips}</div>
    </div>
  );
}

/* ── Chip + popover ─────────────────────────────────────────────────────── */

type EditorProps = {
  fields: FieldDefLite[];
  loadReferenceOptions?: ReferenceLoader;
  onApply: (next: Filter) => void;
} & (
  | { mode: 'add'; field?: undefined; filter?: undefined; onRemove?: undefined }
  | {
      mode?: 'edit';
      field: FieldDefLite;
      filter: Filter;
      onRemove: () => void;
    }
);

function FilterChipEditor({
  mode = 'edit',
  fields,
  field,
  filter,
  loadReferenceOptions,
  onApply,
  onRemove,
}: EditorProps) {
  const [open, setOpen] = useState(false);

  // Draft state — initialized from the current filter or empty for 'add'.
  const [draftField, setDraftField] = useState<FieldDefLite | null>(field ?? null);
  const [draftOp, setDraftOp] = useState<FilterOp>(filter?.op ?? 'contains');
  const [draftValue, setDraftValue] = useState<Filter['value']>(filter?.value);

  const handleOpen = (next: boolean) => {
    if (next) {
      setDraftField(field ?? null);
      setDraftOp(filter?.op ?? (field ? (opsForType(field.type)[0] ?? 'eq') : 'contains'));
      setDraftValue(filter?.value);
    }
    setOpen(next);
  };

  const apply = () => {
    if (!draftField) return;
    onApply({ fieldKey: draftField.key, op: draftOp, value: draftValue ?? null });
    setOpen(false);
  };

  const trigger =
    mode === 'add' ? (
      <Button type="button" variant="ghost" size="sm">
        {filterCount(fields) === 0 ? <FilterIcon /> : <Plus />}
        Add filter
      </Button>
    ) : (
      <ChipTrigger
        filter={filter as Filter}
        field={field as FieldDefLite}
        onRemove={onRemove ?? (() => {})}
      />
    );

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        {!draftField ? (
          <FieldPicker
            fields={fields}
            onPick={(f) => {
              setDraftField(f);
              setDraftOp(opsForType(f.type)[0] ?? 'eq');
              setDraftValue(undefined);
            }}
          />
        ) : (
          <div className="flex flex-col gap-3 p-3">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                className="text-muted-foreground text-xs hover:text-foreground"
                onClick={() => setDraftField(null)}
              >
                ← {draftField.label}
              </button>
            </div>
            <Field label="Condition" htmlFor="filter-op">
              <Select value={draftOp} onValueChange={(v) => setDraftOp(v as FilterOp)}>
                <SelectTrigger id="filter-op">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {opsForType(draftField.type).map((op) => (
                    <SelectItem key={op} value={op}>
                      {OP_LABEL[op]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {!UNARY_OPS.has(draftOp) && draftField.type !== 'checkbox' && (
              <Field label="Value" htmlFor="filter-value">
                <FilterValueInput
                  field={draftField}
                  op={draftOp}
                  value={draftValue}
                  onChange={setDraftValue}
                  loadReferenceOptions={loadReferenceOptions}
                />
              </Field>
            )}
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="button" size="sm" onClick={apply}>
                Apply
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function ChipTrigger({
  filter,
  field,
  onRemove,
}: {
  filter: Filter;
  field: FieldDefLite;
  onRemove: () => void;
}) {
  // Pretty-print picklist values via the field's option labels when available.
  const opts = (field.config as { options?: { value: string; label: string }[] } | null)?.options;
  const valueLabel =
    opts && filter.value != null
      ? opts.find((o) => o.value === String(filter.value))?.label
      : undefined;
  const label = chipLabel(filter, field.label, valueLabel);
  return (
    <span className="inline-flex items-center gap-0.5 rounded-md border bg-muted/40 text-xs">
      <button
        type="button"
        className="rounded-l-md px-2 py-1 hover:bg-muted"
        // Mark this button so the parent Popover wires its trigger correctly.
        data-slot="filter-chip"
      >
        {label}
      </button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="Remove filter"
        className="-mr-px size-5 rounded-l-none rounded-r-md"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        <X />
      </Button>
    </span>
  );
}

function FieldPicker({
  fields,
  onPick,
}: {
  fields: FieldDefLite[];
  onPick: (f: FieldDefLite) => void;
}) {
  return (
    <Command>
      <CommandInput placeholder="Filter on field…" />
      <CommandList>
        <CommandEmpty>No fields.</CommandEmpty>
        <CommandGroup>
          {fields.filter(isFilterable).map((f) => (
            <CommandItem
              key={f.key}
              value={`${f.label} ${f.key} ${f.type}`}
              onSelect={() => onPick(f)}
            >
              <span className="flex-1 font-medium">{f.label}</span>
              <span className="text-muted-foreground text-xs">{f.type}</span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
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

  if (field.type === 'date') {
    return (
      <Input
        id="filter-value"
        type="date"
        value={value == null ? '' : String(value)}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }

  if (field.type === 'datetime') {
    return (
      <Input
        id="filter-value"
        type="datetime-local"
        value={value == null ? '' : String(value)}
        onChange={(e) => onChange(e.target.value)}
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

function filterCount(fields: FieldDefLite[]): number {
  // Trivial helper kept for ergonomic call sites; the bar passes its filter
  // array down and we count there. Returning fields.length here is fine — it
  // only drives the icon swap between `Filter` and `+` in the empty-state.
  return fields.length;
}

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

/* One row inside the FilterDialog: field selector + operator + value + trash. */
function FilterRow({
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
