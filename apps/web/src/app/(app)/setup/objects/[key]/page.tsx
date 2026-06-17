'use client';

// Object detail — properties + field list for a single object def. Read-only
// scaffold; the field editor + layout customizer (#17 / #18) will hang off
// this page. We deliberately render through trpc.object.get rather than
// re-querying the index so this page works as a direct deep link.

import { DescriptionList } from '@/components/northbeam/description-list';
import { EmptyState } from '@/components/northbeam/empty-state';
import { LayoutEditor } from '@/components/northbeam/object-layout-editor';
import { SectionCard } from '@/components/northbeam/section-card';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadingScreen } from '@/components/ui/loading-screen';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { trpc } from '@/lib/api';
import {
  ArrowLeft,
  Check,
  Database,
  Info,
  LayoutPanelLeft,
  Minus,
  Pencil,
} from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import type { FieldDefLite } from '@/components/northbeam/field-render';
import type { ObjectLayout } from '@northbeam/db/field-types';

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
  const utils = trpc.useUtils();

  // Default view for this object — silent on failure so a missing view table
  // never breaks the Object Manager detail page.
  const viewsQ = trpc.view.list.useQuery(
    { objectId: object.id },
    { retry: false, meta: { silent: true } },
  );
  const defaultView = viewsQ.data?.find((v) => v.isDefault) ?? null;

  const [editingLayout, setEditingLayout] = useState(false);
  const updateLayout = trpc.object.updateLayout.useMutation({
    meta: { context: "Couldn't save the layout" },
    onSuccess: () => {
      utils.object.get.invalidate({ key: object.key });
      setEditingLayout(false);
    },
  });

  return (
    <>
      <Breadcrumb objectLabel={object.label} />

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
          ) : (
            <Button variant="outline" size="sm" onClick={() => setEditingLayout(true)}>
              <LayoutPanelLeft />
              Edit form layout
            </Button>
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
            onSave={(layout) =>
              updateLayout.mutate({ objectId: object.id, layout })
            }
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
              {fields.map((f) => {
                const cfg = (f.config ?? {});
                const tone = TYPE_TONE[f.type] ?? 'text';
                const meta = fieldMeta(f.type, cfg);
                return (
                  <TableRow key={f.id}>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-foreground">{f.label}</span>
                        {f.isSystem && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="text-muted-foreground" aria-label="System field">
                                <Info className="size-3.5" />
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>
                              System field — managed by Northbeam, can't be edited.
                            </TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                      {(cfg.description || cfg.helpText) && (
                        <div className="mt-0.5 line-clamp-1 text-muted-foreground text-xs">
                          {cfg.description ?? cfg.helpText}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                        {f.key}
                      </code>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Badge tone={tone} size="sm" className="uppercase tracking-wider">
                          {f.type}
                        </Badge>
                        {meta && <span className="text-muted-foreground text-xs">{meta}</span>}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <BoolDot value={f.required} />
                    </TableCell>
                    <TableCell className="text-center">
                      <BoolDot value={f.indexed} />
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon-sm" aria-label="Edit field" disabled>
                        <Pencil className="size-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </SectionCard>
    </>
  );
}

/** Read-only summary of the persisted layout — sections + their fields,
 *  plus a count of unassigned fields. Replaced by LayoutEditor in edit mode. */
function LayoutSummary({
  layout,
  fields,
}: {
  layout: ObjectLayout;
  fields: FieldDefLite[];
}) {
  const sections = layout.sections ?? [];
  const placed = new Set(sections.flatMap((s) => s.fields));
  const unassignedCount = fields.filter((f) => !placed.has(f.key)).length;
  const byKey = new Map(fields.map((f) => [f.key, f]));

  if (sections.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        No custom layout yet — every field appears in a single "More" group on the form.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {sections.map((s) => (
        <div key={s.id} className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2 font-medium text-foreground text-xs">
            <span>{s.label}</span>
            <Badge tone="neutral" size="sm" className="font-normal">
              {s.cols ?? 2} col
            </Badge>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">{s.fields.length} fields</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {s.fields.map((key) => {
              const f = byKey.get(key);
              return (
                <Badge key={key} tone="neutral" size="sm" className="font-mono">
                  {f?.label ?? key}
                </Badge>
              );
            })}
          </div>
        </div>
      ))}
      {unassignedCount > 0 && (
        <p className="text-muted-foreground text-xs">
          {unassignedCount} unassigned field{unassignedCount === 1 ? '' : 's'} — will appear in a
          generic "More" group on the form.
        </p>
      )}
    </div>
  );
}

function Breadcrumb({ objectLabel }: { objectLabel: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <Button asChild variant="ghost" size="sm" className="h-7 px-2">
        <Link href="/setup/objects">
          <ArrowLeft className="size-3.5" />
          Object manager
        </Link>
      </Button>
      <span className="text-muted-foreground">/</span>
      <span className="font-semibold text-foreground">{objectLabel}</span>
    </div>
  );
}

function BoolDot({ value }: { value: boolean }): ReactNode {
  return value ? (
    <Check className="mx-auto size-4 text-emerald-600 dark:text-emerald-400" />
  ) : (
    <Minus className="mx-auto size-3.5 text-muted-foreground/40" />
  );
}

/** Short inline metadata to render next to the type pill (e.g., "→ account"
 *  for a reference, "USD" for a currency, "12 options" for a picklist). */
function fieldMeta(
  type: string,
  cfg: {
    targetObject?: string;
    currencyCode?: string;
    options?: { value: string; label: string }[];
  },
): string | null {
  if (type === 'reference' && cfg.targetObject) return `→ ${cfg.targetObject}`;
  if (type === 'currency' && cfg.currencyCode) return cfg.currencyCode;
  if ((type === 'picklist' || type === 'multipicklist') && cfg.options?.length) {
    return `${cfg.options.length} options`;
  }
  return null;
}
