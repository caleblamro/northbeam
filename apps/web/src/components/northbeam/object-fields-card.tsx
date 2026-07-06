'use client';

// The Fields card on the object detail page: field metadata table + the
// field editor drawer (create / edit / delete). Extracted from
// setup/objects/[key]/page.tsx so the page stays thin. All schema editing
// is gated by 'object.manage'; system fields open in config-only mode.

import { EmptyState } from '@/components/northbeam/empty-state';
import { type EditorField, FieldEditorDrawer } from '@/components/northbeam/field-editor-drawer';
import { FieldTableRow } from '@/components/northbeam/field-table-row';
import { SectionCard } from '@/components/northbeam/section-card';
import type { BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCan } from '@/lib/can';
import { cn } from '@/lib/cn';
import type { FieldConfig } from '@northbeam/db/field-types';
import { Database, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';

// Field-type → tone mapping. The tones share a neutral background and only
// differ in a small color-dot prefix, so the field list reads as a label,
// not a colored block. Defined in components/ui/badge.tsx.
type TypeTone = Extract<BadgeTone, 'text' | 'number' | 'date' | 'choice' | 'relation' | 'computed'>;

const TYPE_TONE: Record<string, TypeTone> = {
  text: 'text',
  textarea: 'text',
  email: 'text',
  phone: 'text',
  url: 'text',
  number: 'number',
  currency: 'number',
  percent: 'number',
  autonumber: 'computed',
  date: 'date',
  datetime: 'date',
  checkbox: 'choice',
  picklist: 'choice',
  multipicklist: 'choice',
  reference: 'relation',
  formula: 'computed',
  rollup: 'computed',
  ai: 'computed',
};

/** What the card needs per field — the rows from trpc.object.get satisfy it. */
type CardField = EditorField & {
  config: FieldConfig | null;
  required: boolean;
  indexed: boolean;
  isSystem: boolean;
};

// Filter chips group by the same tone categories the type badges use, so
// "Choice" in the toolbar means exactly what a choice-toned badge means.
const CATEGORIES: Array<{ key: TypeTone | 'all'; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'text', label: 'Text' },
  { key: 'number', label: 'Number' },
  { key: 'date', label: 'Date' },
  { key: 'choice', label: 'Choice' },
  { key: 'relation', label: 'Relation' },
  { key: 'computed', label: 'Computed' },
];

export function ObjectFieldsCard({
  objectKey,
  objectLabel,
  fields,
}: {
  objectKey: string;
  objectLabel: string;
  fields: CardField[];
}) {
  const canManage = useCan('object.manage');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<CardField | null>(null);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<TypeTone | 'all'>('all');

  // 30+ field objects (every Salesforce import) need search + category
  // narrowing — both are pure client-side passes over the loaded defs.
  const visible = useMemo(() => {
    const term = q.trim().toLowerCase();
    return fields.filter((f) => {
      if (cat !== 'all' && TYPE_TONE[f.type] !== cat) return false;
      if (!term) return true;
      return f.label.toLowerCase().includes(term) || f.key.toLowerCase().includes(term);
    });
  }, [fields, q, cat]);

  const countFor = (key: TypeTone | 'all') =>
    key === 'all' ? fields.length : fields.filter((f) => TYPE_TONE[f.type] === key).length;

  const openCreate = () => {
    setEditing(null);
    setDrawerOpen(true);
  };
  const openEdit = (field: CardField) => {
    setEditing(field);
    setDrawerOpen(true);
  };

  return (
    <>
      <SectionCard
        title={`Fields (${fields.length})`}
        action={
          canManage ? (
            <Button variant="outline" onClick={openCreate}>
              <Plus />
              New field
            </Button>
          ) : (
            <span className="text-muted-foreground text-xs">View-only</span>
          )
        }
        padding="none"
      >
        <div className="flex flex-wrap items-center gap-2 border-border border-b px-5 py-3">
          <div className="relative">
            <Search className="-translate-y-1/2 absolute top-1/2 left-2.5 size-3.5 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search fields…"
              className="h-8 w-56 pl-8"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {CATEGORIES.map((c) => {
              const n = countFor(c.key);
              if (c.key !== 'all' && n === 0) return null;
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setCat(c.key)}
                  className={cn(
                    'inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs transition-colors',
                    cat === c.key
                      ? 'border-[var(--accent-ring)] bg-[var(--accent-soft)] text-[var(--accent)]'
                      : 'border-border text-muted-foreground hover:text-foreground',
                  )}
                >
                  {c.label}
                  <span className="tabular-nums opacity-70">{n}</span>
                </button>
              );
            })}
          </div>
        </div>
        {fields.length === 0 ? (
          <EmptyState
            icon={Database}
            title="No fields"
            body="This object has no field definitions yet."
            size="sm"
          />
        ) : visible.length === 0 ? (
          <EmptyState
            icon={Search}
            title="No fields match"
            body="Try a different search or category."
            size="sm"
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Label</TableHead>
                <TableHead>API name</TableHead>
                <TableHead className="w-32">Type</TableHead>
                <TableHead className="w-20 text-center">Required</TableHead>
                <TableHead className="w-20 text-center">Indexed</TableHead>
                <TableHead className="w-1" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((f) => (
                <FieldTableRow
                  key={f.id}
                  field={f}
                  toneMap={TYPE_TONE}
                  onEdit={canManage ? () => openEdit(f) : undefined}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>

      <FieldEditorDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        objectKey={objectKey}
        objectLabel={objectLabel}
        fields={fields}
        editing={editing}
      />
    </>
  );
}
