'use client';

// LayoutEditor — drag fields between sections, rename sections, toggle
// column count, persist via trpc.object.updateLayout. Inline editor on the
// Object Manager detail page; opens behind an "Edit form layout" button.
//
// Drag-and-drop runs on @dnd-kit (the Kanban primitive already pulls it in
// transitively). Fields not assigned to any section land in a permanent
// "Unassigned" zone at the bottom so they're never lost in the shuffle.

import type { FieldDefLite } from '@/components/northbeam/field-render';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/cn';
import {
  DndContext,
  type DragEndEvent,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import type { LayoutSection, ObjectLayout } from '@northbeam/db/field-types';
import {
  Columns2,
  Columns3,
  GripVertical,
  Loader2,
  Plus,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

const UNASSIGNED_ID = '__unassigned__';

interface LayoutEditorProps {
  objectId: string;
  fields: FieldDefLite[];
  layout: ObjectLayout;
  saving: boolean;
  onCancel: () => void;
  onSave: (next: ObjectLayout) => void;
}

function nextSectionId(taken: Set<string>): string {
  let i = taken.size + 1;
  // biome-ignore lint/correctness/noConstantCondition: bounded by retry
  while (true) {
    const id = `section_${i}`;
    if (!taken.has(id)) return id;
    i += 1;
  }
}

export function LayoutEditor({
  objectId,
  fields,
  layout,
  saving,
  onCancel,
  onSave,
}: LayoutEditorProps) {
  // Local draft starts from the persisted layout. Reset whenever the source
  // layout changes (e.g. after a save round-trip).
  const [draft, setDraft] = useState<LayoutSection[]>(() => layout.sections ?? []);
  useEffect(() => setDraft(layout.sections ?? []), [layout.sections]);

  // Unassigned = fields not referenced by any section. Always rendered as a
  // safe-haven drop zone at the bottom.
  const unassigned = useMemo(() => {
    const placed = new Set(draft.flatMap((s) => s.fields));
    return fields.filter((f) => !placed.has(f.key));
  }, [draft, fields]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  /** Move a field key out of every section it currently lives in, then drop
   *  it into the target section. Keeps the spec single-home: a field never
   *  appears in two sections. */
  const moveField = (fieldKey: string, targetSectionId: string) => {
    setDraft((prev) => {
      const withoutKey = prev.map((s) => ({
        ...s,
        fields: s.fields.filter((k) => k !== fieldKey),
      }));
      if (targetSectionId === UNASSIGNED_ID) return withoutKey;
      return withoutKey.map((s) =>
        s.id === targetSectionId ? { ...s, fields: [...s.fields, fieldKey] } : s,
      );
    });
  };

  const onDragEnd = (event: DragEndEvent) => {
    const fieldKey = event.active.id as string;
    const target = event.over?.id as string | undefined;
    if (!target) return;
    moveField(fieldKey, target);
  };

  const addSection = () => {
    const id = nextSectionId(new Set(draft.map((s) => s.id)));
    setDraft([...draft, { id, label: 'New section', cols: 2, fields: [] }]);
  };

  const removeSection = (sectionId: string) => {
    // Fields in the deleted section drop back to Unassigned automatically
    // because the next render's `unassigned` recomputes from `placed`.
    setDraft(draft.filter((s) => s.id !== sectionId));
  };

  const renameSection = (sectionId: string, label: string) => {
    setDraft(draft.map((s) => (s.id === sectionId ? { ...s, label } : s)));
  };

  const setCols = (sectionId: string, cols: 1 | 2) => {
    setDraft(draft.map((s) => (s.id === sectionId ? { ...s, cols } : s)));
  };

  const save = () => {
    onSave({ ...layout, sections: draft });
  };

  const fieldByKey = useMemo(() => new Map(fields.map((f) => [f.key, f])), [fields]);

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
      <div className="flex flex-col gap-3" data-object-id={objectId}>
        <div className="flex items-center justify-between gap-2">
          <Button variant="outline" size="sm" onClick={addSection}>
            <Plus />
            Add section
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              Save layout
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {draft.map((section) => (
            <LayoutSectionEditor
              key={section.id}
              section={section}
              fieldByKey={fieldByKey}
              onRename={(label) => renameSection(section.id, label)}
              onChangeCols={(cols) => setCols(section.id, cols)}
              onRemove={() => removeSection(section.id)}
            />
          ))}
          <UnassignedZone fields={unassigned} />
        </div>
      </div>
    </DndContext>
  );
}

/* ── Section panel ──────────────────────────────────────────────────────── */

function LayoutSectionEditor({
  section,
  fieldByKey,
  onRename,
  onChangeCols,
  onRemove,
}: {
  section: LayoutSection;
  fieldByKey: Map<string, FieldDefLite>;
  onRename: (label: string) => void;
  onChangeCols: (cols: 1 | 2) => void;
  onRemove: () => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: section.id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex flex-col gap-2 rounded-md border bg-card p-3',
        isOver && 'border-primary/40 bg-primary/5',
      )}
    >
      <div className="flex items-center gap-2">
        <Input
          value={section.label}
          onChange={(e) => onRename(e.target.value)}
          className="h-7 max-w-xs font-medium text-sm"
        />
        <div className="ml-auto flex items-center gap-0.5 rounded-md border bg-background p-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            data-active={section.cols !== 2 ? 'true' : undefined}
            aria-label="One column"
            className="size-6 data-[active=true]:bg-primary/10 data-[active=true]:text-primary"
            onClick={() => onChangeCols(1)}
          >
            <Columns2 className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            data-active={section.cols === 2 ? 'true' : undefined}
            aria-label="Two columns"
            className="size-6 data-[active=true]:bg-primary/10 data-[active=true]:text-primary"
            onClick={() => onChangeCols(2)}
          >
            <Columns3 className="size-3.5" />
          </Button>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Delete section"
          onClick={onRemove}
        >
          <Trash2 className="size-3.5 text-destructive" />
        </Button>
      </div>
      <div
        className={cn(
          'grid min-h-[60px] gap-2',
          section.cols === 2 ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1',
        )}
      >
        {section.fields.length === 0 ? (
          <div className="col-span-full flex items-center justify-center rounded-md border border-dashed py-4 text-muted-foreground text-xs">
            Drop fields here
          </div>
        ) : (
          section.fields.map((key) => {
            const field = fieldByKey.get(key);
            if (!field) return null;
            return <DraggableFieldChip key={key} field={field} />;
          })
        )}
      </div>
    </div>
  );
}

/* ── Field chip ─────────────────────────────────────────────────────────── */

function DraggableFieldChip({ field }: { field: FieldDefLite }) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: field.key,
  });
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn(
        'flex cursor-grab items-center gap-2 rounded-md border bg-background px-2.5 py-1.5 text-sm shadow-xs',
        'hover:border-foreground/30 active:cursor-grabbing',
        isDragging && 'opacity-40',
      )}
    >
      <GripVertical className="size-3.5 text-muted-foreground" />
      <span className="flex-1 truncate font-medium text-foreground">{field.label}</span>
      {field.required && <Badge tone="brand" size="sm">required</Badge>}
      <Badge tone="neutral" size="sm" className="uppercase tracking-wider">
        {field.type}
      </Badge>
    </div>
  );
}

/* ── Unassigned zone ────────────────────────────────────────────────────── */

function UnassignedZone({ fields }: { fields: FieldDefLite[] }) {
  const { isOver, setNodeRef } = useDroppable({ id: UNASSIGNED_ID });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex flex-col gap-2 rounded-md border border-dashed bg-muted/30 p-3',
        isOver && 'border-primary/40 bg-primary/10',
      )}
    >
      <div className="flex items-center gap-2 text-muted-foreground text-xs">
        <span className="font-semibold uppercase tracking-wider">Unassigned</span>
        <span>·</span>
        <span>Fields not yet placed in a section. They still appear in a "More" group on the form.</span>
      </div>
      {fields.length === 0 ? (
        <div className="rounded-md border border-dashed py-3 text-center text-muted-foreground text-xs">
          Every field is placed.
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {fields.map((f) => (
            <DraggableFieldChip key={f.key} field={f} />
          ))}
        </div>
      )}
    </div>
  );
}
