'use client';

// Object Manager — Salesforce-style index of every object in the workspace
// (including archived ones, so they stay reachable for unarchiving). Custom
// objects are created here via the New-object wizard.

import { EmptyState } from '@/components/northbeam/empty-state';
import { NewObjectDialog } from '@/components/northbeam/new-object-dialog';
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
import { useCan } from '@/lib/can';
import { ChevronRight, Database, Plus } from 'lucide-react';
// Database stays — used by the empty state below.
import Link from 'next/link';

export default function ObjectManagerPage() {
  const objects = trpc.object.list.useQuery({ includeArchived: true });
  const canManage = useCan('object.manage');
  const rows = objects.data ?? [];

  const newObjectButton = (
    <Button variant="outline" disabled={!canManage}>
      <Plus />
      New object
    </Button>
  );

  return (
    <SectionCard
      title="Object manager"
      action={canManage ? <NewObjectDialog trigger={newObjectButton} /> : newObjectButton}
      padding="none"
    >
      {objects.isSuccess && rows.length === 0 ? (
        <EmptyState
          icon={Database}
          title="No objects yet"
          body="Standard objects are seeded when a workspace is created. Use New object to add a custom one."
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
                  <span className="flex items-center gap-1">
                    <Badge tone={obj.isSystem ? 'neutral' : 'brand'} size="sm">
                      {obj.isSystem ? 'Standard' : 'Custom'}
                    </Badge>
                    {obj.archivedAt ? (
                      <Badge tone="warning" size="sm">
                        Archived
                      </Badge>
                    ) : null}
                  </span>
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
