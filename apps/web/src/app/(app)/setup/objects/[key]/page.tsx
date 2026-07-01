'use client';

// Object detail — properties + field list for a single object def. Read-only
// scaffold; the field editor + layout customizer (#17 / #18) will hang off
// this page. We deliberately render through trpc.object.get rather than
// re-querying the index so this page works as a direct deep link.

import { DescriptionList } from '@/components/northbeam/description-list';
import { EmptyState } from '@/components/northbeam/empty-state';
import { FieldTableRow } from '@/components/northbeam/field-table-row';
import { LayoutSummary } from '@/components/northbeam/layout-summary';
import { LayoutEditor } from '@/components/northbeam/object-layout-editor';
import { SectionCard } from '@/components/northbeam/section-card';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { Button } from '@/components/ui/button';
import { LoadingScreen } from '@/components/ui/loading-screen';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { trpc } from '@/lib/api';
import { useCan } from '@/lib/can';
import { Database, LayoutPanelLeft, Pencil } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
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

export default function ObjectDetailPage() {
  const params = useParams<{ key: string }>();
  const key = params.key;
  const q = trpc.object.get.useQuery({ key });
  const utils = trpc.useUtils();
  const canEditLayout = useCan('org.settings.update');
  const [editingLayout, setEditingLayout] = useState(false);

  // Default view for this object — silent on failure so a missing view table
  // never breaks the Object Manager detail page.
  const viewsQ = trpc.view.list.useQuery(
    { objectId: q.data?.object.id ?? '' },
    { enabled: !!q.data, retry: false, meta: { silent: true } },
  );
  const updateLayout = trpc.object.updateLayout.useMutation({
    meta: { context: "Couldn't save the layout" },
    onSuccess: () => {
      utils.object.get.invalidate({ key });
      setEditingLayout(false);
    },
  });

  if (q.isLoading) return <LoadingScreen size="md" />;

  if (!q.data) {
    return (
      <SectionCard title="Not found">
        <EmptyState
          icon={Database}
          title="Object not found"
          body={`Couldn't find an object with key "${key}" in this workspace.`}
          size="sm"
        />
      </SectionCard>
    );
  }

  const { object, fields } = q.data;
  const defaultView = viewsQ.data?.find((v) => v.isDefault) ?? null;

  return (
    <>
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/setup/objects">Object manager</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{object.label}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <SectionCard
        title="Properties"
        action={
          <Badge tone={object.isSystem ? 'neutral' : 'brand'}>
            {object.isSystem ? 'Standard' : 'Custom'}
          </Badge>
        }
      >
        <DescriptionList
          labelWidth="md"
          items={[
            { label: 'Label', value: object.label },
            {
              label: 'API name',
              value: <code className="text-xs">{object.key}</code>,
              valueClassName: 'font-mono',
            },
            {
              label: 'Table name',
              value: <code className="text-xs">{object.tableName}</code>,
              valueClassName: 'font-mono',
            },
            {
              label: 'Source',
              value: <span className="capitalize">{object.source ?? 'native'}</span>,
            },
            {
              label: 'Default view',
              value: defaultView ? (
                <Link
                  href={`/${object.key}?view=${defaultView.id}`}
                  className="font-medium text-primary hover:underline"
                >
                  {defaultView.label}
                </Link>
              ) : (
                <span className="text-muted-foreground">—</span>
              ),
            },
          ]}
        />
      </SectionCard>

      <SectionCard
        title="Form layout"
        action={
          editingLayout ? (
            <span className="text-muted-foreground text-xs">Drag fields between sections</span>
          ) : canEditLayout ? (
            <Button variant="outline" size="sm" onClick={() => setEditingLayout(true)}>
              <LayoutPanelLeft />
              Edit form layout
            </Button>
          ) : (
            <span className="text-muted-foreground text-xs">View-only</span>
          )
        }
      >
        {editingLayout ? (
          <LayoutEditor
            objectId={object.id}
            fields={fields}
            layout={object.layout ?? {}}
            saving={updateLayout.isPending}
            onCancel={() => setEditingLayout(false)}
            onSave={(layout) => updateLayout.mutate({ objectId: object.id, layout })}
          />
        ) : (
          <LayoutSummary layout={object.layout ?? {}} fields={fields} />
        )}
      </SectionCard>

      <SectionCard
        title={`Fields (${fields.length})`}
        action={
          <Button variant="outline" disabled>
            <Pencil />
            New field
          </Button>
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
                <FieldTableRow key={f.id} field={f} toneMap={TYPE_TONE} />
              ))}
            </TableBody>
          </Table>
        )}
      </SectionCard>
    </>
  );
}
