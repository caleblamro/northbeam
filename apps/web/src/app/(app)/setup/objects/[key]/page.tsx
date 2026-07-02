'use client';

// Object detail — tabbed Object Manager page for a single object def:
// Overview (properties + form layout) · Fields · Record types · Validation ·
// Formatting. Tab state lives in the URL (?tab=) so deep links survive
// refresh. We deliberately render through trpc.object.get rather than
// re-querying the index so this page works as a direct deep link.

import { EmptyState } from '@/components/northbeam/empty-state';
import { ObjectFieldsCard } from '@/components/northbeam/object-fields-card';
import { ObjectOverview } from '@/components/northbeam/object-overview';
import {
  FormatRulesEditor,
  ValidationRulesEditor,
} from '@/components/northbeam/object-rule-editors';
import { RecordTypesEditor } from '@/components/northbeam/record-types-editor';
import { SectionCard } from '@/components/northbeam/section-card';
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
import { Database } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { parseAsStringLiteral, useQueryState } from 'nuqs';

const TABS = ['overview', 'fields', 'record-types', 'validation', 'formatting'] as const;

export default function ObjectDetailPage() {
  const params = useParams<{ key: string }>();
  const key = params.key;
  const q = trpc.object.get.useQuery({ key });
  const [tab, setTab] = useQueryState('tab', parseAsStringLiteral(TABS).withDefault('overview'));

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

      <Tabs value={tab} onValueChange={(v) => setTab(v as (typeof TABS)[number])}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="fields">Fields</TabsTrigger>
          <TabsTrigger value="record-types">Record types</TabsTrigger>
          <TabsTrigger value="validation">Validation</TabsTrigger>
          <TabsTrigger value="formatting">Formatting</TabsTrigger>
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
      </Tabs>
    </>
  );
}
