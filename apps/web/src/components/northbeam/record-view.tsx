'use client';

// Record detail page — hero + stat strip + Details/Related tabs +
// click-to-edit detail grid. Structure ported from the On Q OS handoff;
// rendered against DiceUI primitives + tokens. Layout metadata drives
// every section/field, so this works for any object.

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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { trpc } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { FieldConfig, ObjectLayout } from '@northbeam/db/field-types';
import { Loader2, Pencil, Users } from 'lucide-react';
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
  const [tab, setTab] = useState<'details' | 'related'>('details');
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
  const compactKeys = (layout.compactKeys ?? []).filter((k) => byKey.has(k));
  const statKeys = (layout.statKeys ?? []).filter((k) => byKey.has(k));
  const sections = layout.sections?.length
    ? layout.sections
    : [{ id: 'all', label: 'Details', cols: 2 as const, fields: fields.map((f) => f.key) }];
  const relatedGroups = related.data ?? [];
  const relatedCount = relatedGroups.reduce((n, g) => n + g.rows.length, 0);
  const stageField = findStageField(fields as FieldDefLite[]);

  return (
    <div className="flex flex-col gap-7">
      <HidePageHead />

      <nav className="flex items-center gap-1.5 text-sm" aria-label="Breadcrumb">
        {parentChain.map((c) => (
          <Fragment key={`${c.objectKey}.${c.id}`}>
            <Link href={`/${c.objectKey}`} className="text-muted-foreground hover:text-foreground">
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

      <header className="flex items-start gap-4">
        <ObjChip label={object.label} color={object.color} size={44} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <span>{object.label}</span>
            <span className="font-mono text-[0.6875rem]">{id.slice(0, 8)}</span>
          </div>
          <h1 className="mt-1 truncate font-medium text-3xl text-foreground tracking-[-0.02em]">
            {row.name}
          </h1>
          {compactKeys.length > 0 && (
            <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-sm">
              {compactKeys.map((k) => {
                const f = byKey.get(k);
                if (!f) return null;
                const v = row.data[k];
                if (v == null || v === '') return null;
                return (
                  <div key={k} className="flex items-center gap-1.5">
                    <dt className="text-muted-foreground">{f.label}:</dt>
                    <dd className="text-foreground">
                      <FieldValue field={f} value={v} referenceLabel={refLabels[String(v)]} />
                    </dd>
                  </div>
                );
              })}
            </dl>
          )}
        </div>
        <Button variant="outline" onClick={() => setEditing(true)}>
          <Pencil />
          Edit
        </Button>
      </header>

      {stageField && (
        <StagePath
          objectKey={objectKey}
          recordId={id}
          field={stageField}
          value={row.data[stageField.key]}
        />
      )}

      {statKeys.length > 0 && (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-4">
          {statKeys.map((k) => {
            const f = byKey.get(k);
            if (!f) return null;
            return (
              <div key={k} className="bg-card p-4">
                <div className="font-medium text-[0.6875rem] text-muted-foreground uppercase tracking-[0.14em]">
                  {f.label}
                </div>
                <div className="mt-2 font-normal text-2xl text-foreground tabular-nums tracking-[-0.025em]">
                  <FieldValue field={f} value={row.data[k]} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as 'details' | 'related')} className="gap-6">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="related">
            Related
            {relatedCount > 0 && (
              <Badge variant="default" size="sm" className="ml-1">
                {relatedCount}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="flex flex-col gap-5">
          {sections.map((sec) => {
            const cols = sec.cols ?? 2;
            const secFields = sec.fields.map((k) => byKey.get(k)).filter(Boolean) as FieldDefLite[];
            if (!secFields.length) return null;
            return (
              <section
                key={sec.id}
                className={cn(
                  'overflow-hidden rounded-lg border border-border bg-card',
                  cols === 1 && 'col-span-full',
                )}
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
        </TabsContent>

        <TabsContent value="related" className="flex flex-col gap-5">
          {relatedGroups.length === 0 ? (
            <EmptyState
              icon={Users}
              title="Nothing related yet"
              body="Records that reference this one will appear here."
            />
          ) : (
            relatedGroups.map((g) => {
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
            })
          )}
        </TabsContent>
      </Tabs>

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
