'use client';
import { EmptyState } from '@/components/northbeam/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { trpc } from '@/lib/api';
import { AlertCircle, ArrowRight, Loader2 } from 'lucide-react';
import { useState } from 'react';

function Loading({ label }: { label: string }) {
  return (
    <div className="grid place-items-center gap-3 p-16 text-center">
      <Loader2 className="size-5 animate-spin text-muted-foreground" />
      <span className="text-muted-foreground text-sm">{label}</span>
    </div>
  );
}

export function DiscoverScreen({ onCreated }: { onCreated: (runId: string) => void }) {
  const discover = trpc.salesforce.discover.useQuery();
  const createRun = trpc.salesforce.createRun.useMutation({
    onSuccess: (r) => onCreated(r.runId),
  });
  const [picked, setPicked] = useState<Set<string>>(new Set());

  if (discover.isError) {
    return (
      <EmptyState
        icon={AlertCircle}
        title="Couldn't reach Salesforce"
        body={discover.error.message}
      />
    );
  }
  if (!discover.data) return <Loading label="Reading your org's objects…" />;

  const toggle = (name: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(name)) n.delete(name);
      else n.add(name);
      return n;
    });

  return (
    <div className="reveal flex flex-col gap-4">
      <div className="mb-1 flex items-center gap-3">
        <p className="text-muted-foreground text-sm">
          {discover.data.length} importable objects · {picked.size} selected
        </p>
        <div className="flex-1" />
        <Button
          disabled={picked.size === 0 || createRun.isPending}
          onClick={() => createRun.mutate({ objects: [...picked] })}
        >
          {createRun.isPending ? <Loader2 className="animate-spin" /> : <ArrowRight />}
          Analyze {picked.size || ''} object{picked.size === 1 ? '' : 's'}
        </Button>
      </div>
      {createRun.isPending && (
        <Loading label="Describing objects and sampling records — this takes a moment…" />
      )}
      <Card className="gap-0 overflow-hidden py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Object</TableHead>
              <TableHead>API name</TableHead>
              <TableHead>Maps to</TableHead>
              <TableHead className="text-right">Records</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {discover.data.map((o) => (
              <TableRow key={o.name} className="cursor-pointer" onClick={() => toggle(o.name)}>
                <TableCell onClick={(e) => e.stopPropagation()}>
                  <Checkbox checked={picked.has(o.name)} onCheckedChange={() => toggle(o.name)} />
                </TableCell>
                <TableCell className="font-medium text-foreground">{o.labelPlural}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">{o.name}</TableCell>
                <TableCell>
                  <Badge tone={o.standardTarget ? 'relation' : 'neutral'} size="sm">
                    {o.standardTarget ? `→ ${o.standardTarget}` : 'new object'}
                  </Badge>
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {o.count?.toLocaleString() ?? '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
