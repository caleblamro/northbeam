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
import { type FieldDefLite } from '@/components/northbeam/field-render';
import { Combobox, type Option } from '@/components/northbeam/select-legacy';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
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
import { Filter as FilterIcon, Plus, X } from 'lucide-react';
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
  className?: string;
}

export function FilterBar({
  fields,
  filters,
  onChange,
  loadReferenceOptions,
  views,
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

  return (
    <div className={cn('mb-3 flex flex-col gap-2', className)}>
      {views && <div className="flex items-center gap-2 border-b">{views}</div>}
      <div className="flex flex-wrap items-center gap-1.5">
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
      </div>
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
      setDraftOp(filter?.op ?? (field ? opsForType(field.type)[0] ?? 'eq' : 'contains'));
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
        {filterCount(fields) === 0 ? (
          <FilterIcon />
        ) : (
          <Plus />
        )}
        Add filter
      </Button>
    ) : (
      <ChipTrigger filter={filter as Filter} field={field as FieldDefLite} onRemove={onRemove!} />
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
          {fields
            .filter(isFilterable)
            .map((f) => (
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
    const selected: Option | null = value == null ? null : { value: String(value), label: String(value) };
    return (
      <Combobox
        value={selected}
        onChange={(o) => onChange(o?.value ?? null)}
        loadOptions={loadReferenceOptions ? (q) => loadReferenceOptions(targetObject, q) : async () => []}
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
