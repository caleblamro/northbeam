'use client';

// Generic list view for any object — toolbar + filter bar + table + row→record-
// page navigation + create/edit drawer + delete. One component backs Contacts/
// Accounts/Deals/Activities on real data.

import { EmptyState } from '@/components/northbeam/empty-state';
import { FilterBar } from '@/components/northbeam/filter-bar';
import { ListToolbar } from '@/components/northbeam/list-toolbar';
import { Spinner } from '@/components/northbeam/primitives';
import { RecordFormDrawer } from '@/components/northbeam/record-form';
import { SavedViews } from '@/components/northbeam/saved-views';
import { ObjChip } from '@/components/northbeam/app-bits';
import { HidePageHead, PageActions } from '@/components/northbeam/app-shell';
import { type FieldDefLite, FieldValue } from '@/components/northbeam/field-render';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { trpc } from '@/lib/api';
import {
  type Filter,
  readFiltersFromParams,
  rowPassesFilters,
  writeFiltersToParams,
} from '@/lib/filters';
import type { ObjectLayout } from '@northbeam/db/field-types';
import { AlertCircle, MoreHorizontal, Pencil, Trash2, Upload, UserPlus } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';

const NUMERIC = new Set(['currency', 'number', 'percent']);

export function RecordListView({
  objectKey,
  newLabel,
  showImport = true,
  standalone = false,
}: {
  objectKey: string;
  newLabel?: string;
  showImport?: boolean;
  standalone?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [q, setQ] = useState('');
  const [savedView, setSavedView] = useState('all');
  const [editing, setEditing] = useState<
    { id: string; data: Record<string, unknown> } | 'new' | null
  >(null);

  // Filters live in the URL so refresh + share-the-link both work. The
  // searchParams object is reactive — useMemo just avoids re-parsing JSON on
  // every render.
  const filters = useMemo(
    () => readFiltersFromParams(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );
  const setFilters = useCallback(
    (next: Filter[]) => {
      const params = new URLSearchParams(searchParams.toString());
      writeFiltersToParams(params, next);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [router, pathname, searchParams],
  );

  const utils = trpc.useUtils();
  const list = trpc.record.list.useQuery({ objectKey, search: q || undefined });
  const remove = trpc.record.remove.useMutation({
    onSuccess: () => utils.record.list.invalidate(),
  });

  const fields = (list.data?.fields ?? []) as FieldDefLite[];
  const allRows = list.data?.rows ?? [];
  // Client-side filtering for v0. Server-side filtering on `record.list` is
  // the next move once the dynamic-records layer grows predicate support — at
  // that point this `rows` is `allRows` again and the `filters` array is
  // passed straight into the tRPC query.
  const rows = useMemo(
    () => (filters.length === 0 ? allRows : allRows.filter((r) => rowPassesFilters(fields, r.data, filters))),
    [allRows, fields, filters],
  );
  const refLabels = list.data?.refLabels ?? {};
  const object = list.data?.object;
  const objectLabel = object?.label ?? '';
  const objectPlural = object?.labelPlural ?? '';
  const layout = (object?.layout ?? {}) as ObjectLayout;

  const colKeys = layout.listColumns?.length
    ? layout.listColumns
    : fields.slice(0, 4).map((f) => f.key);
  const columns = colKeys
    .map((k) => fields.find((f) => f.key === k))
    .filter((f): f is FieldDefLite => !!f);

  const createBtn = (
    <Button onClick={() => setEditing('new')}>
      <UserPlus />
      {newLabel ?? `New ${objectLabel.toLowerCase() || 'record'}`}
    </Button>
  );

  if (list.isError) {
    return (
      <>
        {standalone && <HidePageHead />}
        <EmptyState
          icon={AlertCircle}
          title="Unknown object"
          body={`No object '${objectKey}' exists in this workspace.`}
        />
      </>
    );
  }

  return (
    <>
      {standalone ? (
        <>
          <HidePageHead />
          <header className="mb-5 flex items-center gap-4">
            <ObjChip label={objectLabel || objectKey} color={object?.color} size={46} />
            <div className="min-w-0 flex-1">
              <h1 className="font-semibold text-2xl tracking-tight">{objectPlural || objectKey}</h1>
              {!list.isLoading && (
                <p className="text-muted-foreground text-sm">{rows.length} records</p>
              )}
            </div>
            <div>{createBtn}</div>
          </header>
        </>
      ) : (
        <PageActions>
          {showImport && (
            <Button variant="outline">
              <Upload />
              Import
            </Button>
          )}
          {createBtn}
        </PageActions>
      )}

      <FilterBar
        fields={fields}
        filters={filters}
        onChange={setFilters}
        loadReferenceOptions={(targetObject, query) =>
          utils.record.searchRefs.fetch({ objectKey: targetObject, q: query })
        }
        views={
          <SavedViews
            views={[
              { id: 'all', label: 'All' },
              { id: 'mine', label: 'My records' },
              { id: 'recent', label: 'Recent' },
            ]}
            activeId={savedView}
            onSelect={setSavedView}
          />
        }
      />
      <ListToolbar
        searchValue={q}
        onSearchChange={setQ}
        searchPlaceholder={`Search ${objectPlural.toLowerCase() || 'records'}…`}
      />

      {list.isLoading ? (
        <Card className="grid place-items-center p-12">
          <Spinner style={{ color: 'var(--brand)' }} />
        </Card>
      ) : rows.length === 0 ? (
        <Card className="p-0">
          <EmptyState
            icon={UserPlus}
            title={q ? `No ${objectPlural.toLowerCase()} match` : `No ${objectPlural.toLowerCase()} yet`}
            body={
              q
                ? 'Try a different search.'
                : `Create your first ${objectLabel.toLowerCase()}, or run a Salesforce migration.`
            }
            action={!q && createBtn}
          />
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                {columns.map((c) => (
                  <TableHead key={c.key} className={NUMERIC.has(c.type) ? 'text-right' : undefined}>
                    {c.label}
                  </TableHead>
                ))}
                <TableHead className="w-1" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow
                  key={r.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/${objectKey}/${r.id}`)}
                >
                  <TableCell className="font-semibold text-foreground">{r.name}</TableCell>
                  {columns.map((c) => (
                    <TableCell key={c.key} className={NUMERIC.has(c.type) ? 'text-right' : undefined}>
                      <FieldValue
                        field={c}
                        value={r.data[c.key]}
                        referenceLabel={refLabels[String(r.data[c.key])]}
                      />
                    </TableCell>
                  ))}
                  <TableCell className="w-1" onClick={(e) => e.stopPropagation()}>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label="Row actions">
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => setEditing({ id: r.id, data: r.data })}>
                          <Pencil />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onSelect={() => remove.mutate({ objectKey, id: r.id })}
                        >
                          <Trash2 />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {editing && object && (
        <RecordFormDrawer
          open
          onClose={() => setEditing(null)}
          objectKey={objectKey}
          objectLabel={objectLabel}
          fields={fields}
          sections={layout.sections}
          record={editing === 'new' ? null : editing}
          refLabels={refLabels}
        />
      )}
    </>
  );
}
