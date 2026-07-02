'use client';

// Sortable picklist option rows: drag to reorder, edit labels inline, cycle
// each option's color through the curated admin swatches, remove, and
// Enter-to-add. Shared by the field editor's picklist config block and the
// global picklist set dialog. Sensor setup mirrors object-layout-editor.tsx.

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { PicklistOption } from '@northbeam/db/field-types';
import { GripVertical, Plus, X } from 'lucide-react';
import { useState } from 'react';
import { ADMIN_SWATCHES } from './swatch-picker';

/** Stored value from a label: lowercase snake_case. */
function slugify(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function uniqueValue(base: string, taken: Set<string>): string {
  const root = base || 'option';
  if (!taken.has(root)) return root;
  let i = 2;
  while (taken.has(`${root}_${i}`)) i += 1;
  return `${root}_${i}`;
}

export function PicklistOptionsEditor({
  options,
  onChange,
  disabled,
}: {
  options: PicklistOption[];
  onChange: (next: PicklistOption[]) => void;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState('');
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  const update = (index: number, patch: Partial<PicklistOption>) => {
    onChange(options.map((o, i) => (i === index ? { ...o, ...patch } : o)));
  };

  const setLabel = (index: number, label: string) => {
    const current = options[index];
    if (!current) return;
    // The stored value tracks the label (auto-slug) until it has manually
    // diverged — imported/preexisting options keep their value untouched.
    if (current.value === slugify(current.label)) {
      const taken = new Set(options.filter((_, i) => i !== index).map((o) => o.value));
      update(index, { label, value: uniqueValue(slugify(label), taken) });
    } else {
      update(index, { label });
    }
  };

  const cycleColor = (index: number) => {
    const current = ADMIN_SWATCHES.findIndex((s) => s.value === options[index]?.color);
    const next = ADMIN_SWATCHES[(current + 1) % ADMIN_SWATCHES.length];
    if (next) update(index, { color: next.value });
  };

  const remove = (index: number) => {
    onChange(options.filter((_, i) => i !== index));
  };

  const add = () => {
    const label = draft.trim();
    if (!label) return;
    const taken = new Set(options.map((o) => o.value));
    const swatch = ADMIN_SWATCHES[options.length % ADMIN_SWATCHES.length];
    onChange([
      ...options,
      { label, value: uniqueValue(slugify(label), taken), color: swatch?.value },
    ]);
    setDraft('');
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const from = options.findIndex((o) => o.value === active.id);
    const to = options.findIndex((o) => o.value === over.id);
    if (from < 0 || to < 0) return;
    onChange(arrayMove(options, from, to));
  };

  return (
    <div className="flex flex-col gap-2">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={options.map((o) => o.value)} strategy={verticalListSortingStrategy}>
          <div className="flex flex-col gap-1.5">
            {options.length === 0 && (
              <div className="rounded-md border border-dashed py-3 text-center text-muted-foreground text-xs">
                No options yet — add the first one below.
              </div>
            )}
            {options.map((option, i) => (
              <OptionRow
                key={option.value}
                option={option}
                disabled={disabled}
                onLabelChange={(label) => setLabel(i, label)}
                onCycleColor={() => cycleColor(i)}
                onRemove={() => remove(i)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <div className="flex items-center gap-2">
        <Input
          value={draft}
          disabled={disabled}
          placeholder="Add an option…"
          className="h-8 text-sm"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled || !draft.trim()}
          onClick={add}
        >
          <Plus />
          Add
        </Button>
      </div>
    </div>
  );
}

function OptionRow({
  option,
  disabled,
  onLabelChange,
  onCycleColor,
  onRemove,
}: {
  option: PicklistOption;
  disabled?: boolean;
  onLabelChange: (label: string) => void;
  onCycleColor: () => void;
  onRemove: () => void;
}) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: option.value,
    disabled,
  });
  const colorName =
    ADMIN_SWATCHES.find((s) => s.value === option.color)?.name ??
    (option.color ? 'Custom' : 'None');

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-center gap-2 rounded-md border bg-card px-2 py-1.5',
        isDragging && 'z-10 opacity-70 shadow-sm',
      )}
    >
      <button
        type="button"
        aria-label={`Reorder ${option.label}`}
        disabled={disabled}
        className="cursor-grab text-muted-foreground outline-none focus-visible:text-foreground active:cursor-grabbing disabled:pointer-events-none"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="size-3.5" />
      </button>

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            aria-label={`Color: ${colorName}. Click to change`}
            disabled={disabled}
            onClick={onCycleColor}
            className="grid size-5 shrink-0 cursor-pointer place-items-center rounded-full outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none"
          >
            <span
              aria-hidden="true"
              className="size-3.5 rounded-full border border-[color:var(--border)]"
              style={{ background: option.color ?? 'var(--surface-sunken)' }}
            />
          </button>
        </TooltipTrigger>
        <TooltipContent>{colorName} — click to cycle</TooltipContent>
      </Tooltip>

      <Input
        value={option.label}
        disabled={disabled}
        aria-label="Option label"
        className="h-7 flex-1 text-sm"
        onChange={(e) => onLabelChange(e.target.value)}
      />
      <code className="max-w-28 truncate font-mono text-muted-foreground text-xs">
        {option.value}
      </code>

      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={`Remove ${option.label}`}
        disabled={disabled}
        onClick={onRemove}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}
