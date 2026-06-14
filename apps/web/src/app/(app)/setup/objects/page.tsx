'use client';

// Object Manager — Salesforce-style index of every object in the workspace.
// Read-only scaffold for now: the field editor + layout customizer (#18) will
// open from a row click in a follow-up. The data model is already in place —
// objectDef / fieldDef — so we just surface what exists.

import { EmptyState } from '@/components/northbeam/empty-state';
import { SectionCard } from '@/components/northbeam/section-card';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { trpc } from '@/lib/api';
import { Database, Plus } from 'lucide-react';

export default function ObjectManagerPage() {
  const objects = trpc.object.list.useQuery();
  const rows = objects.data ?? [];

  return (
    <SectionCard
      icon={Database}
      title="Object manager"
      action={
        <Button variant="outline" disabled>
          <Plus />
          New object
        </Button>
      }
      padding="none"
    >
      {objects.isSuccess && rows.length === 0 ? (
        <EmptyState
          icon={Database}
          title="No objects yet"
          body="Standard objects are seeded when a workspace is created. Custom objects will be createable from here."
          size="sm"
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Label</TableHead>
              <TableHead>API name</TableHead>
              <TableHead className="w-24">Type</TableHead>
              <TableHead className="w-32">Source</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((obj) => (
              <TableRow key={obj.id}>
                <TableCell>
                  <div className="font-semibold text-foreground">{obj.label}</div>
                </TableCell>
                <TableCell>
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                    {obj.key}
                  </code>
                </TableCell>
                <TableCell>
                  <span
                    className={
                      obj.isSystem
                        ? 'rounded-full bg-muted px-2 py-0.5 font-medium text-xs'
                        : 'rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary text-xs'
                    }
                  >
                    {obj.isSystem ? 'Standard' : 'Custom'}
                  </span>
                </TableCell>
                <TableCell className="text-muted-foreground text-xs capitalize">
                  {obj.source ?? 'native'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </SectionCard>
  );
}
