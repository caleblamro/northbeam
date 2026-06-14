'use client';

// Object Manager — Salesforce-style index of every object in the workspace.
// Read-only scaffold for now: the field editor + layout customizer (#18) will
// open from a row click in a follow-up. The data model is already in place —
// objectDef / fieldDef — so we just surface what exists.

import { EmptyState } from '@/components/northbeam/empty-state';
import { SectionCard } from '@/components/northbeam/section-card';
import { Badge } from '@/components/ui/badge';
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
import { ChevronRight, Database, Plus } from 'lucide-react';
// Database stays — used by the empty state below.
import Link from 'next/link';

export default function ObjectManagerPage() {
  const objects = trpc.object.list.useQuery();
  const rows = objects.data ?? [];

  return (
    <SectionCard
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
              <TableHead className="w-1" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((obj) => (
              <TableRow key={obj.id} className="group cursor-pointer hover:bg-muted/40">
                <TableCell>
                  <Link
                    href={`/setup/objects/${obj.key}`}
                    className="block font-semibold text-foreground after:absolute after:inset-0"
                  >
                    {obj.label}
                  </Link>
                </TableCell>
                <TableCell>
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                    {obj.key}
                  </code>
                </TableCell>
                <TableCell>
                  <Badge tone={obj.isSystem ? 'neutral' : 'brand'} size="sm">
                    {obj.isSystem ? 'Standard' : 'Custom'}
                  </Badge>
                </TableCell>
                <TableCell className="text-muted-foreground text-xs capitalize">
                  {obj.source ?? 'native'}
                </TableCell>
                <TableCell>
                  <ChevronRight className="size-4 text-muted-foreground/40 transition-colors group-hover:text-muted-foreground" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </SectionCard>
  );
}
