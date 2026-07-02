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
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useCan } from '@/lib/can';
import type { FieldConfig } from '@northbeam/db/field-types';
import { Database, Plus } from 'lucide-react';
import { useState } from 'react';

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
        {fields.length === 0 ? (
          <EmptyState
            icon={Database}
            title="No fields"
            body="This object has no field definitions yet."
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
              {fields.map((f) => (
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
