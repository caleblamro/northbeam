'use client';

// Object detail — the S2 "object hero" page for a single object def: an
// identity hero (chip, mono api/table names, description, live stats) over
// count-badged tabs — Overview (properties + form layout) · Fields · Record
// types · Validation · Formatting. Tab state lives in the URL (?tab=) so
// deep links survive refresh. We deliberately render through trpc.object.get
// rather than re-querying the index so this page works as a direct deep link.

import { ObjChip } from '@/components/northbeam/app-bits';
import { AutomationList } from '@/components/northbeam/automation/automation-list';
import { EmptyState } from '@/components/northbeam/empty-state';
import { ObjectFieldsCard } from '@/components/northbeam/object-fields-card';
import { ObjectOverview } from '@/components/northbeam/object-overview';
import {
  FormatRulesEditor,
  ValidationRulesEditor,
} from '@/components/northbeam/object-rule-editors';
import { RecordTypesEditor } from '@/components/northbeam/record-types-editor';
import { SectionCard } from '@/components/northbeam/section-card';
import { Badge } from '@/components/ui/badge';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { LoadingScreen } from '@/components/ui/loading-screen';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { trpc } from '@/lib/api';
import { useCan } from '@/lib/can';
import { Database } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { parseAsStringLiteral, useQueryState } from 'nuqs';

const TABS = [
  'overview',
  'fields',
  'record-types',
  'validation',
  'formatting',
  'automations',
] as const;

export default function ObjectDetailPage() {
  const params = useParams<{ key: string }>();
  const key = params.key;
  const q = trpc.object.get.useQuery({ key });
  const canAutomate = useCan('automation.manage');
  const [tab, setTab] = useQueryState('tab', parseAsStringLiteral(TABS).withDefault('overview'));

  // Hero stats + tab badges. All silent — a failed count never blocks the
  // page, the number just stays absent.
  const countQ = trpc.record.aggregate.useQuery(
    { objectKey: key, groupBy: null, measure: { agg: 'count' }, filters: [] },
    { enabled: !!q.data, retry: false, meta: { silent: true } },
  );
  const typesQ = trpc.recordType.list.useQuery(
    { objectKey: key },
    { enabled: !!q.data, retry: false, meta: { silent: true } },
  );
  const rulesQ = trpc.validation.list.useQuery(
    { objectKey: key },
    { enabled: !!q.data, retry: false, meta: { silent: true } },
  );

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
  const recordCount = countQ.data ? Number(countQ.data.buckets[0]?.value ?? 0) : null;
  const typeCount = typesQ.data?.length ?? null;
  const ruleCount = rulesQ.data?.length ?? null;
  const formatCount = object.formatRules?.length ?? 0;

  /** Tab label + optional count badge — counts appear as they load. */
  const tabBadge = (n: number | null) =>
    n != null && n > 0 ? (
      <Badge variant="default" size="sm" className="ml-1 tabular-nums">
        {n}
      </Badge>
    ) : null;

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

      {/* Identity hero — who this object is, before any tab content. */}
      <header className="flex items-start gap-4">
        <ObjChip label={object.label} color={object.color} size={44} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-semibold text-xl tracking-[-0.015em]">{object.label}</h1>
            {object.archivedAt && (
              <Badge tone="warning" size="sm">
                Archived
              </Badge>
            )}
          </div>
          <div className="mt-0.5 font-mono text-[0.6875rem] text-muted-foreground">
            {object.key} · table: {object.tableName || object.key}
          </div>
          {object.description && (
            <p className="mt-2 max-w-xl text-muted-foreground text-sm leading-relaxed">
              {object.description}
            </p>
          )}
          <dl className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm tabular-nums">
            <div>
              <span className="font-medium text-foreground">{fields.length}</span>{' '}
              <span className="text-muted-foreground">fields</span>
            </div>
            {recordCount != null && (
              <div>
                <span className="font-medium text-foreground">{recordCount.toLocaleString()}</span>{' '}
                <span className="text-muted-foreground">records</span>
              </div>
            )}
            {typeCount != null && typeCount > 0 && (
              <div>
                <span className="font-medium text-foreground">{typeCount}</span>{' '}
                <span className="text-muted-foreground">
                  record {typeCount === 1 ? 'type' : 'types'}
                </span>
              </div>
            )}
            <div className="text-muted-foreground">
              Source: <span className="capitalize">{object.source ?? 'native'}</span>
            </div>
          </dl>
        </div>
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(v as (typeof TABS)[number])}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="fields">Fields {tabBadge(fields.length)}</TabsTrigger>
          <TabsTrigger value="record-types">Record types {tabBadge(typeCount)}</TabsTrigger>
          <TabsTrigger value="validation">Validation {tabBadge(ruleCount)}</TabsTrigger>
          <TabsTrigger value="formatting">Formatting {tabBadge(formatCount)}</TabsTrigger>
          {canAutomate && <TabsTrigger value="automations">Automations</TabsTrigger>}
        </TabsList>
        <TabsContent value="overview">
          <ObjectOverview object={object} fields={fields} />
        </TabsContent>
        <TabsContent value="fields">
          <ObjectFieldsCard objectKey={object.key} objectLabel={object.label} fields={fields} />
        </TabsContent>
        <TabsContent value="record-types">
          <RecordTypesEditor objectKey={object.key} />
        </TabsContent>
        <TabsContent value="validation">
          <ValidationRulesEditor objectKey={object.key} fields={fields} />
        </TabsContent>
        <TabsContent value="formatting">
          <FormatRulesEditor
            objectId={object.id}
            objectKey={object.key}
            fields={fields}
            rules={object.formatRules ?? []}
          />
        </TabsContent>
        {canAutomate && (
          <TabsContent value="automations">
            <AutomationList objectId={object.id} />
          </TabsContent>
        )}
      </Tabs>
    </>
  );
}
