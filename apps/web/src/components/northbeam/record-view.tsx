'use client';

// Record detail page — a compact full-width hero band (breadcrumb + identity
// + inline key-field stats + chevron stage path) over a two-column workspace:
// field sections and related lists on the left, the record's activity
// timeline on the right rail. Layout metadata drives every section/field, so
// this works for any object.

import { ActivityTimeline } from '@/components/northbeam/activity-timeline';
import { Badge } from '@/components/ui/badge';
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
import { trpc } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { FieldConfig, ObjectLayout } from '@northbeam/db/field-types';
import { Loader2, Pencil, Users, Zap } from 'lucide-react';
import Link from 'next/link';
import { Fragment, useState } from 'react';
import { ObjChip } from './app-bits';
import { HidePageHead } from './app-shell';
import { EmptyState } from './empty-state';
import { type FieldDefLite, FieldInput, FieldValue, READONLY_FIELD_TYPES } from './field-render';
import { RecordFormDrawer } from './record-form';
import { RecordPeek } from './record-peek';
import { StagePath, findStageField } from './stage-path';
import { useParentChain } from './use-parent-chain';

export function RecordView({ objectKey, id }: { objectKey: string; id: string }) {
  const [editing, setEditing] = useState(false);

  const rec = trpc.record.get.useQuery({ objectKey, id });
  const related = trpc.record.related.useQuery({ objectKey, id });
  const parentChain = useParentChain({
    objectKey,
    recordId: id,
    fields: rec.data?.fields as FieldDefLite[] | undefined,
    data: rec.data?.row.data as Record<string, unknown> | undefined,
  });

  if (rec.isLoading) return <LoadingScreen size="lg" />;
  if (!rec.data) {
    return <EmptyState icon={Users} title="Record not found" body="It may have been deleted." />;
  }

  const { object, fields, row, refLabels } = rec.data;
  const layout = (object.layout ?? {}) as ObjectLayout;
  const byKey = new Map(fields.map((f) => [f.key, f as FieldDefLite]));
  const sections = layout.sections?.length
    ? layout.sections
    : [{ id: 'all', label: 'Details', cols: 2 as const, fields: fields.map((f) => f.key) }];
  const relatedGroups = related.data ?? [];
  const stageField = findStageField(fields as FieldDefLite[]);

  // Hero stat row: the layout's big-number fields first, then the compact
  // header fields — deduped, capped so the band stays one line.
  const heroKeys = [...new Set([...(layout.statKeys ?? []), ...(layout.compactKeys ?? [])])]
    .filter((k) => byKey.has(k))
    .slice(0, 6);

  // Activities render as the right-rail timeline; everything else related
  // stays a table in the main column.
  const activityGroup = relatedGroups.find((g) => g.object.key === 'activity');
  const tableGroups = relatedGroups.filter((g) => g !== activityGroup);

  return (
    <div className="flex flex-col">
      <HidePageHead />

      {/* Hero band — breaks out of the page gutter and runs edge-to-edge. */}
      <div className="-mx-8 -mt-6 border-border border-b bg-background px-8 pt-4 pb-5">
        <nav className="flex items-center gap-1.5 text-sm" aria-label="Breadcrumb">
          {parentChain.map((c) => (
            <Fragment key={`${c.objectKey}.${c.id}`}>
              <Link
                href={`/${c.objectKey}`}
                className="text-muted-foreground hover:text-foreground"
              >
                {c.objectLabelPlural}
              </Link>
              <span className="text-muted-foreground/60">/</span>
              <RecordPeek objectKey={c.objectKey} id={c.id}>
                <Link
                  href={`/${c.objectKey}/${c.id}`}
                  className="flex min-w-0 items-center gap-1.5 text-muted-foreground hover:text-foreground"
                >
                  <ObjChip label={c.objectLabel} color={c.objectColor} size={16} />
                  <span className="truncate">{c.name}</span>
                </Link>
              </RecordPeek>
              <span className="text-muted-foreground/60">/</span>
            </Fragment>
          ))}
          <Link href={`/${object.key}`} className="text-muted-foreground hover:text-foreground">
            {object.labelPlural}
          </Link>
          <span className="text-muted-foreground/60">/</span>
          <span className="truncate font-medium text-foreground">{row.name}</span>
        </nav>

        <header className="mt-3 flex items-center gap-3">
          <ObjChip label={object.label} color={object.color} size={38} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-semibold text-foreground text-xl tracking-[-0.015em]">
              {row.name}
            </h1>
            <div className="mt-0.5 flex items-center gap-2 text-muted-foreground text-xs">
              <span>{object.label}</span>
              <span className="font-mono text-[0.6875rem]">{id.slice(0, 8)}</span>
            </div>
          </div>
          <Button variant="outline" onClick={() => setEditing(true)}>
            <Pencil />
            Edit
          </Button>
        </header>

        {heroKeys.length > 0 && (
          <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3">
            {heroKeys.map((k) => {
              const f = byKey.get(k);
              if (!f) return null;
              const v = row.data[k];
              return (
                <div key={k} className="min-w-0">
                  <dt className="text-muted-foreground text-xs">{f.label}</dt>
                  <dd
                    className={cn(
                      'mt-0.5 truncate font-medium text-[0.9375rem] tabular-nums',
                      v == null || v === '' ? 'text-muted-foreground' : 'text-foreground',
                    )}
                  >
                    {v == null || v === '' ? (
                      '—'
                    ) : (
                      <FieldValue field={f} value={v} referenceLabel={refLabels[String(v)]} />
                    )}
                  </dd>
                </div>
              );
            })}
          </dl>
        )}

        {stageField && (
          <div className="mt-4">
            <StagePath
              objectKey={objectKey}
              recordId={id}
              field={stageField}
              value={row.data[stageField.key]}
            />
          </div>
        )}
      </div>

      {/* Two-column workspace: sections + related tables left, activity rail
          right. Collapses to one column below lg. */}
      <div className="mt-6 grid items-start gap-5 lg:grid-cols-[minmax(0,1.7fr)_minmax(300px,1fr)]">
        <div className="flex min-w-0 flex-col gap-5">
          {sections.map((sec, si) => {
            const cols = sec.cols ?? 2;
            // Imported layouts (Salesforce especially) can repeat a field
            // within a section and reuse section ids — dedupe fields and
            // suffix the key so React keys stay unique.
            const secFields = [...new Set(sec.fields)]
              .map((k) => byKey.get(k))
              .filter(Boolean) as FieldDefLite[];
            if (!secFields.length) return null;
            return (
              <section
                key={`${sec.id}:${si}`}
                className="overflow-hidden rounded-lg border border-border bg-card"
              >
                <div className="border-border border-b px-5 py-3">
                  <h2 className="font-medium text-[0.9375rem] text-foreground tracking-[-0.005em]">
                    {sec.label}
                  </h2>
                </div>
                <div
                  className="grid gap-x-6 gap-y-4 px-5 py-5"
                  style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))` }}
                >
                  {secFields.map((f) => (
                    <InlineField
                      key={f.key}
                      objectKey={objectKey}
                      recordId={id}
                      field={f}
                      value={row.data[f.key]}
                      refLabel={refLabels[String(row.data[f.key])]}
                      fullWidth={cols > 1 && (f.type === 'textarea' || f.type === 'multipicklist')}
                    />
                  ))}
                </div>
              </section>
            );
          })}

          {tableGroups.map((g) => {
            const gByKey = new Map(g.fields.map((f) => [f.key, f as FieldDefLite]));
            const gLayout = (g.object.layout ?? {}) as ObjectLayout;
            const cols = (gLayout.listColumns ?? [])
              .map((k) => gByKey.get(k))
              .filter(Boolean)
              .slice(0, 4) as FieldDefLite[];
            return (
              <section
                key={`${g.object.key}.${g.via.key}`}
                className="overflow-hidden rounded-lg border border-border bg-card"
              >
                <div className="flex items-center gap-2.5 border-border border-b px-5 py-3">
                  <ObjChip label={g.object.label} color={g.object.color} size={20} />
                  <h2 className="flex-1 font-medium text-[0.9375rem] text-foreground tracking-[-0.005em]">
                    {g.object.labelPlural}
                  </h2>
                  <Badge variant="default" size="sm">
                    {g.rows.length}
                  </Badge>
                </div>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      {cols.map((c) => (
                        <TableHead key={c.key}>{c.label}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {g.rows.map((r) => (
                      <TableRow key={r.id} className="group cursor-pointer hover:bg-muted/40">
                        <TableCell>
                          <RecordPeek objectKey={g.object.key} id={r.id}>
                            <Link
                              href={`/${g.object.key}/${r.id}`}
                              className="font-medium text-foreground after:absolute after:inset-0"
                            >
                              {r.name}
                            </Link>
                          </RecordPeek>
                        </TableCell>
                        {cols.map((c) => (
                          <TableCell key={c.key} className="text-muted-foreground">
                            <FieldValue field={c} value={r.data[c.key]} />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </section>
            );
          })}
        </div>

        {/* Right rail: the record's activity feed. */}
        <aside className="flex min-w-0 flex-col gap-5">
          <section className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="flex items-center gap-2.5 border-border border-b px-5 py-3">
              <h2 className="flex-1 font-medium text-[0.9375rem] text-foreground tracking-[-0.005em]">
                Activity
              </h2>
              {activityGroup && (
                <Badge variant="default" size="sm">
                  {activityGroup.rows.length}
                </Badge>
              )}
            </div>
            <div className="px-5 py-4">
              {activityGroup ? (
                <ActivityTimeline
                  items={activityGroup.rows.map((r) => ({
                    id: r.id,
                    name: (
                      <Link href={`/activity/${r.id}`} className="hover:underline">
                        {r.name}
                      </Link>
                    ),
                    createdAt: r.createdAt,
                    subtype: (r.data.type as string | null) ?? null,
                  }))}
                />
              ) : (
                <EmptyState
                  icon={Zap}
                  size="sm"
                  title="No activity yet"
                  body="Calls, emails, and notes that reference this record will appear here."
                />
              )}
            </div>
          </section>
        </aside>
      </div>

      {editing && (
        <RecordFormDrawer
          open
          onClose={() => setEditing(false)}
          objectKey={objectKey}
          objectLabel={object.label}
          fields={fields as FieldDefLite[]}
          sections={layout.sections}
          record={{ id: row.id, data: row.data }}
          refLabels={refLabels}
        />
      )}
    </div>
  );
}

function InlineField({
  objectKey,
  recordId,
  field,
  value,
  refLabel,
  fullWidth,
}: {
  objectKey: string;
  recordId: string;
  field: FieldDefLite;
  value: unknown;
  refLabel?: string;
  fullWidth?: boolean;
}) {
  const utils = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<unknown>(value);
  const cfg: FieldConfig = field.config ?? {};
  const readOnly = READONLY_FIELD_TYPES.has(field.type);

  const update = trpc.record.update.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.record.get.invalidate({ objectKey, id: recordId }),
        utils.record.related.invalidate(),
        utils.record.list.invalidate(),
      ]);
      setEditing(false);
    },
  });

  const empty = value == null || value === '' || (Array.isArray(value) && value.length === 0);

  return (
    <div className={cn('flex flex-col gap-1', fullWidth && 'col-span-full')}>
      <div className="flex items-center gap-1 font-medium text-muted-foreground text-xs">
        {field.label}
        {field.required && <span className="text-destructive">*</span>}
      </div>
      {editing ? (
        <div className="flex flex-col gap-2">
          <FieldInput
            field={field}
            value={draft}
            onChange={setDraft}
            referenceValue={
              field.type === 'reference' && draft
                ? { value: String(draft), label: refLabel ?? String(draft) }
                : null
            }
            loadReference={(q) =>
              utils.record.searchRefs.fetch({ objectKey: cfg.targetObject ?? '', q })
            }
          />
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={update.isPending}
              onClick={() =>
                update.mutate({ objectKey, id: recordId, data: { [field.key]: draft } })
              }
            >
              {update.isPending && <Loader2 className="animate-spin" />}
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setDraft(value);
                setEditing(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : readOnly ? (
        <div className={cn('text-sm', empty ? 'text-muted-foreground' : 'text-foreground')}>
          {empty ? '—' : <FieldValue field={field} value={value} referenceLabel={refLabel} />}
        </div>
      ) : (
        <button
          type="button"
          className="-mx-1.5 -my-0.5 group flex items-center gap-2 rounded-md px-1.5 py-0.5 text-left text-sm transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => {
            setDraft(value);
            setEditing(true);
          }}
          title="Click to edit"
        >
          <span className={cn('truncate', empty ? 'text-muted-foreground' : 'text-foreground')}>
            {empty ? 'Empty' : <FieldValue field={field} value={value} referenceLabel={refLabel} />}
          </span>
          <Pencil className="size-3 shrink-0 text-muted-foreground/0 transition-colors group-hover:text-muted-foreground" />
        </button>
      )}
    </div>
  );
}
