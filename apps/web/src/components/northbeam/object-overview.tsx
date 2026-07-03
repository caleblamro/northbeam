'use client';

// Overview tab on the Object Manager detail page — the Properties card and
// the form-layout summary/editor. Extracted verbatim from
// setup/objects/[key]/page.tsx when the page grew ?tab= navigation, so the
// page stays thin.

import { DescriptionList } from '@/components/northbeam/description-list';
import { LayoutSummary } from '@/components/northbeam/layout-summary';
import { ObjectArchiveAction } from '@/components/northbeam/object-archive-action';
import { LayoutEditor } from '@/components/northbeam/object-layout-editor';
import { SectionCard } from '@/components/northbeam/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { type RouterOutputs, trpc } from '@/lib/api';
import { useCan } from '@/lib/can';
import { LayoutPanelLeft } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

type ObjectGet = RouterOutputs['object']['get'];

export function ObjectOverview({
  object,
  fields,
}: {
  object: ObjectGet['object'];
  fields: ObjectGet['fields'];
}) {
  const utils = trpc.useUtils();
  const canEditLayout = useCan('object.manage');
  const [editingLayout, setEditingLayout] = useState(false);

  // Default view for this object — silent on failure so a missing view table
  // never breaks the Object Manager detail page.
  const viewsQ = trpc.view.list.useQuery(
    { objectId: object.id },
    { retry: false, meta: { silent: true } },
  );
  const defaultView = viewsQ.data?.find((v) => v.isDefault) ?? null;

  const updateLayout = trpc.object.updateLayout.useMutation({
    meta: { context: "Couldn't save the layout" },
    onSuccess: () => {
      utils.object.get.invalidate({ key: object.key });
      setEditingLayout(false);
    },
  });

  return (
    <div className="flex flex-col gap-4">
      <SectionCard
        title="Properties"
        action={
          <div className="flex items-center gap-2">
            {object.archivedAt ? <Badge tone="warning">Archived</Badge> : null}
            <Badge tone={object.isSystem ? 'neutral' : 'brand'}>
              {object.isSystem ? 'Standard' : 'Custom'}
            </Badge>
            <ObjectArchiveAction
              objectId={object.id}
              objectKey={object.key}
              label={object.label}
              isSystem={object.isSystem}
              archived={!!object.archivedAt}
            />
          </div>
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
    </div>
  );
}
