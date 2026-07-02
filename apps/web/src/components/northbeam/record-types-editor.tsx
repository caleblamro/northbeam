'use client';

// Record types tab on the Object Manager detail page — list the object's
// record types with live record counts, add new ones (label → auto key), and
// delete non-default types (the server reassigns their records to the default
// type before the row goes away). Model: EverOn RecordTypesEditor, restyled
// with Northbeam primitives.

import { ConfirmDialog } from '@/components/northbeam/confirm-dialog';
import { EmptyState } from '@/components/northbeam/empty-state';
import { Field } from '@/components/northbeam/field';
import { FormDialog } from '@/components/northbeam/form-dialog';
import { SectionCard } from '@/components/northbeam/section-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { LoadingScreen } from '@/components/ui/loading-screen';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { type RouterOutputs, trpc } from '@/lib/api';
import { useCan } from '@/lib/can';
import { KEY_RE, keyFromLabel } from '@northbeam/db/keys';
import { Check, Layers, Minus, Plus, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';

type RecordType = RouterOutputs['recordType']['list'][number];

export function RecordTypesEditor({ objectKey }: { objectKey: string }) {
  const canManage = useCan('object.manage');
  const utils = trpc.useUtils();
  const q = trpc.recordType.list.useQuery({ objectKey });

  const [addOpen, setAddOpen] = useState(false);
  const [deleting, setDeleting] = useState<RecordType | null>(null);

  const remove = trpc.recordType.delete.useMutation({
    meta: { context: "Couldn't delete the record type" },
    onSuccess: () => {
      utils.recordType.list.invalidate({ objectKey });
      setDeleting(null);
    },
  });

  const types = q.data ?? [];
  const defaultType = types.find((t) => t.isDefault) ?? null;

  return (
    <SectionCard
      title={`Record types${q.data ? ` (${types.length})` : ''}`}
      action={
        canManage ? (
          <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}>
            <Plus />
            New record type
          </Button>
        ) : (
          <span className="text-muted-foreground text-xs">View-only</span>
        )
      }
      padding="none"
    >
      {q.isLoading ? (
        <LoadingScreen size="sm" />
      ) : types.length === 0 ? (
        <EmptyState
          icon={Layers}
          title="No record types"
          body="Record types let one object carry different processes — each type can get its own layout and picklist values."
          size="sm"
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Label</TableHead>
              <TableHead>API name</TableHead>
              <TableHead className="w-20 text-center">Active</TableHead>
              <TableHead className="w-24 text-right">Records</TableHead>
              <TableHead className="w-1" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {types.map((rt) => (
              <TableRow key={rt.id}>
                <TableCell>
                  <div className="flex items-center gap-1.5">
                    <span className="font-semibold text-foreground">{rt.label}</span>
                    {rt.isDefault && (
                      <Badge tone="brand" size="sm">
                        Default
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{rt.key}</code>
                </TableCell>
                <TableCell className="text-center">
                  {rt.active ? (
                    <Check className="mx-auto size-4 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <Minus className="mx-auto size-3.5 text-muted-foreground/40" />
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">{rt.count}</TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${rt.label}`}
                    // The default type is the fallback home for reassigned
                    // records, so it can't be deleted itself.
                    disabled={!canManage || rt.isDefault}
                    onClick={() => setDeleting(rt)}
                  >
                    <Trash2 className="size-3.5 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <AddRecordTypeDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        objectKey={objectKey}
        existingKeys={types.map((t) => t.key)}
      />

      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => {
          if (!o) setDeleting(null);
        }}
        title={`Delete record type "${deleting?.label ?? ''}"?`}
        description={
          deleting
            ? deleting.count > 0
              ? `${deleting.count} ${deleting.count === 1 ? 'record' : 'records'} will fall back to ${
                  defaultType ? `"${defaultType.label}"` : 'no record type'
                }. Layout overrides for this type are removed.`
              : 'No records use this type. Layout overrides for this type are removed.'
            : undefined
        }
        confirmLabel="Delete record type"
        tone="destructive"
        pending={remove.isPending}
        onConfirm={() => {
          if (deleting) remove.mutate({ id: deleting.id });
        }}
      />
    </SectionCard>
  );
}

/* ── Add dialog ─────────────────────────────────────────────────────────── */

function AddRecordTypeDialog({
  open,
  onOpenChange,
  objectKey,
  existingKeys,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  objectKey: string;
  existingKeys: string[];
}) {
  const utils = trpc.useUtils();
  const [label, setLabel] = useState('');
  const [key, setKey] = useState('');
  // The key follows the label until the user edits it directly.
  const keyTouched = useRef(false);

  const create = trpc.recordType.create.useMutation({
    meta: { context: "Couldn't create the record type" },
    onSuccess: () => {
      utils.recordType.list.invalidate({ objectKey });
      handleOpenChange(false);
    },
  });

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setLabel('');
      setKey('');
      keyTouched.current = false;
    }
    onOpenChange(next);
  };

  const keyError = key
    ? !KEY_RE.test(key)
      ? 'Lowercase letters, digits, and underscores; must start with a letter.'
      : existingKeys.includes(key)
        ? 'A record type with this key already exists.'
        : undefined
    : undefined;
  const canSubmit = label.trim().length > 0 && key.length > 0 && !keyError;

  return (
    <FormDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="New record type"
      description="Record types split one object into distinct processes with their own layouts."
      submitLabel={create.isPending ? 'Creating…' : 'Create record type'}
      pending={create.isPending}
      onSubmit={() => {
        if (canSubmit) create.mutate({ objectKey, label: label.trim(), key });
      }}
    >
      <Field label="Label" required htmlFor="rt-label">
        <Input
          id="rt-label"
          value={label}
          autoComplete="off"
          placeholder="e.g. Partner account"
          onChange={(e) => {
            setLabel(e.target.value);
            if (!keyTouched.current)
              setKey(e.target.value.trim() ? keyFromLabel(e.target.value) : '');
          }}
        />
      </Field>
      <Field
        label="API name"
        required
        htmlFor="rt-key"
        error={keyError}
        description="Used by the API and layout assignments. Locked after creation."
      >
        <Input
          id="rt-key"
          value={key}
          className="font-mono"
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => {
            keyTouched.current = true;
            setKey(e.target.value);
          }}
        />
      </Field>
    </FormDialog>
  );
}
