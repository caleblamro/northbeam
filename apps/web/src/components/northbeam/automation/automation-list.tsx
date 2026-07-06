'use client';

// AutomationList — the flows table shared by /setup/automations and the
// object manager's Automations tab (pre-filtered via objectId). Row actions:
// activate / pause / delete; "New flow" dialog creates a draft and pushes
// into the canvas editor.

import { EmptyState } from '@/components/northbeam/empty-state';
import { ListToolbar } from '@/components/northbeam/list-toolbar';
import { Badge, type BadgeTone } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { LoadingScreen } from '@/components/ui/loading-screen';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { trpc } from '@/lib/api';
import { timeAgo } from '@/lib/time';
import type { FlowNodeType, FlowTrigger } from '@northbeam/core/flow';
import { Loader2, MoreHorizontal, Plus, Workflow } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '../confirm-dialog';
import { Field } from '../field';
import { NODE_CATALOG } from './node-catalog';

const STATUS_BADGE: Record<string, { tone: BadgeTone; label: string }> = {
  draft: { tone: 'neutral', label: 'Draft' },
  active: { tone: 'success', label: 'Active' },
  paused: { tone: 'warning', label: 'Paused' },
  needs_rebuild: { tone: 'danger', label: 'Rebuild manually' },
};

function triggerLabel(triggerType: string | null): string {
  if (!triggerType) return '—';
  const entry = NODE_CATALOG[triggerType as FlowNodeType];
  return entry?.label ?? triggerType;
}

const NO_OBJECT = '__none__';

type TriggerChoice = 'record' | 'scheduled' | 'webhook';

function buildTrigger(choice: TriggerChoice): FlowTrigger {
  switch (choice) {
    case 'record':
      return { id: 'trigger', type: 'trigger_record', config: { event: 'created_or_updated' } };
    case 'scheduled':
      return {
        id: 'trigger',
        type: 'trigger_scheduled',
        config: {
          schedule: { frequency: 'daily', time: '09:00' },
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        },
      };
    case 'webhook':
      return { id: 'trigger', type: 'trigger_webhook', config: {} };
  }
}

function NewFlowDialog({
  open,
  onOpenChange,
  defaultObjectId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultObjectId?: string;
}) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const objectsQ = trpc.object.list.useQuery();
  const [name, setName] = useState('');
  const [objectId, setObjectId] = useState(defaultObjectId ?? NO_OBJECT);
  const [choice, setChoice] = useState<TriggerChoice>(defaultObjectId ? 'record' : 'webhook');
  const create = trpc.automation.create.useMutation({
    meta: { context: "Couldn't create the flow" },
    onSuccess: (flow) => {
      utils.automation.list.invalidate();
      onOpenChange(false);
      router.push(`/automations/${flow.id}`);
    },
  });

  const hasObject = objectId !== NO_OBJECT;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New flow</DialogTitle>
          <DialogDescription>
            Pick a trigger — you'll build the steps on the canvas next.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <Field label="Name" htmlFor="new-flow-name">
            <Input
              id="new-flow-name"
              value={name}
              maxLength={120}
              placeholder="e.g. Notify owner on closed-won"
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
          <Field label="Object" htmlFor="new-flow-object">
            <Select
              value={objectId}
              onValueChange={(v) => {
                setObjectId(v);
                if (v === NO_OBJECT && choice === 'record') setChoice('webhook');
                if (v !== NO_OBJECT) setChoice('record');
              }}
            >
              <SelectTrigger id="new-flow-object" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_OBJECT}>None — global flow</SelectItem>
                {(objectsQ.data ?? []).map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Trigger" htmlFor="new-flow-trigger">
            <Select value={choice} onValueChange={(v) => setChoice(v as TriggerChoice)}>
              <SelectTrigger id="new-flow-trigger" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {hasObject && <SelectItem value="record">Record created or updated</SelectItem>}
                <SelectItem value="scheduled">On a schedule</SelectItem>
                <SelectItem value="webhook">Inbound webhook</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!name.trim() || create.isPending}
            onClick={() => {
              const trigger = buildTrigger(
                hasObject ? choice : choice === 'record' ? 'webhook' : choice,
              );
              create.mutate({
                name: name.trim(),
                objectId: hasObject ? objectId : null,
                draftTrigger: trigger,
                draftGraph: { nodes: [trigger], edges: [] },
              });
            }}
          >
            {create.isPending && <Loader2 className="animate-spin" />}
            Create flow
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AutomationList({ objectId }: { objectId?: string }) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const q = trpc.automation.list.useQuery(objectId ? { objectId } : {});
  const objectsQ = trpc.object.list.useQuery();
  const objectLabel = useMemo(
    () => new Map((objectsQ.data ?? []).map((o) => [o.id, o.label])),
    [objectsQ.data],
  );

  const invalidate = () => utils.automation.list.invalidate();
  const activate = trpc.automation.activate.useMutation({
    meta: { context: "Couldn't activate the flow" },
    onSuccess: (res) => {
      invalidate();
      if (res.ok) toast.success('Flow activated');
      else
        toast.error(
          res.issues.find((i) => i.severity === 'error')?.message ??
            'Fix the flow’s issues to activate it',
        );
    },
  });
  const pause = trpc.automation.pause.useMutation({
    meta: { context: "Couldn't pause the flow" },
    onSuccess: () => {
      invalidate();
      toast.success('Flow paused');
    },
  });
  const remove = trpc.automation.remove.useMutation({
    meta: { context: "Couldn't delete the flow" },
    onSuccess: () => {
      invalidate();
      setDeleteId(null);
    },
  });

  const flows = useMemo(() => {
    const all = q.data ?? [];
    const needle = search.trim().toLowerCase();
    if (!needle) return all;
    return all.filter(
      (f) =>
        f.name.toLowerCase().includes(needle) ||
        (f.description ?? '').toLowerCase().includes(needle),
    );
  }, [q.data, search]);

  const deleting = flows.find((f) => f.id === deleteId) ?? null;

  return (
    <div>
      <ListToolbar
        searchValue={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search flows…"
        actions={
          <Button size="sm" onClick={() => setDialogOpen(true)}>
            <Plus />
            New flow
          </Button>
        }
      />

      {q.isLoading ? (
        <LoadingScreen size="sm" />
      ) : flows.length === 0 ? (
        <EmptyState
          icon={Workflow}
          title={search ? 'No matching flows' : 'No flows yet'}
          body={
            search
              ? 'Try a different search.'
              : 'Automate the busywork — trigger on record changes, schedules, or webhooks.'
          }
          action={
            !search && (
              <Button size="sm" onClick={() => setDialogOpen(true)}>
                <Plus />
                New flow
              </Button>
            )
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                {!objectId && <TableHead>Object</TableHead>}
                <TableHead>Trigger</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last run</TableHead>
                <TableHead className="text-right">Runs (7d)</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {flows.map((flow) => {
                const status = STATUS_BADGE[flow.status] ?? {
                  tone: 'neutral' as BadgeTone,
                  label: flow.status,
                };
                return (
                  <TableRow
                    key={flow.id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/automations/${flow.id}`)}
                  >
                    <TableCell>
                      <div className="font-medium">{flow.name}</div>
                      {flow.description && (
                        <div className="max-w-96 truncate text-muted-foreground text-xs">
                          {flow.description}
                        </div>
                      )}
                    </TableCell>
                    {!objectId && (
                      <TableCell>
                        {flow.objectId ? (
                          <Badge variant="outline" size="sm">
                            {objectLabel.get(flow.objectId) ?? '…'}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground text-xs">Global</span>
                        )}
                      </TableCell>
                    )}
                    <TableCell className="text-muted-foreground text-sm">
                      {triggerLabel(flow.triggerType)}
                    </TableCell>
                    <TableCell>
                      <Badge size="sm" tone={status.tone}>
                        {status.label}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {flow.lastRunAt ? timeAgo(flow.lastRunAt) : '—'}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">
                      {flow.runCount7d}
                    </TableCell>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Actions for ${flow.name}`}
                          >
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => router.push(`/automations/${flow.id}`)}>
                            Open
                          </DropdownMenuItem>
                          {flow.status === 'active' ? (
                            <DropdownMenuItem onClick={() => pause.mutate({ id: flow.id })}>
                              Pause
                            </DropdownMenuItem>
                          ) : (
                            flow.status !== 'needs_rebuild' && (
                              <DropdownMenuItem onClick={() => activate.mutate({ id: flow.id })}>
                                Activate
                              </DropdownMenuItem>
                            )
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => setDeleteId(flow.id)}
                          >
                            Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <NewFlowDialog open={dialogOpen} onOpenChange={setDialogOpen} defaultObjectId={objectId} />
      <ConfirmDialog
        open={deleteId !== null}
        onOpenChange={(open) => !open && setDeleteId(null)}
        title={deleting ? `Delete "${deleting.name}"?` : 'Delete flow?'}
        description="The flow, its versions, and its run history are removed permanently."
        confirmLabel="Delete flow"
        tone="destructive"
        pending={remove.isPending}
        onConfirm={() => deleteId && remove.mutate({ id: deleteId })}
      />
    </div>
  );
}
