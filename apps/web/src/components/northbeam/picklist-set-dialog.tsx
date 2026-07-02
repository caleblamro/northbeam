'use client';

// PicklistSetDialog — create/manage a global picklist value set. Two panes:
// the set itself (name, description, sortable value options) on the left and
// its field assignments on the right. Assignments write field.update directly:
// binding sets config.globalPicklistId (dropping inline options — the config
// keeps exactly one of the two); unbinding re-inlines the set's current values
// as config.options so the field keeps working standalone. Deleting a set is
// blocked server-side while any field still draws from it — the CONFLICT toast
// names the offending fields.

import { ConfirmDialog } from '@/components/northbeam/confirm-dialog';
import { Field } from '@/components/northbeam/field';
import { PicklistOptionsEditor } from '@/components/northbeam/picklist-options-editor';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { type RouterOutputs, trpc } from '@/lib/api';
import { type PicklistOption, narrowFieldConfig } from '@northbeam/db/field-types';
import { Plus, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

type Usage = RouterOutputs['picklist']['get']['usedBy'][number];

export function PicklistSetDialog({
  open,
  onOpenChange,
  setId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** null = create a new set. */
  setId: string | null;
}) {
  const utils = trpc.useUtils();
  const detail = trpc.picklist.get.useQuery(
    { id: setId ?? '' },
    { enabled: open && setId !== null },
  );

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [values, setValues] = useState<PicklistOption[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Hydrate the draft once per open target. Assignment mutations refetch
  // picklist.get while the dialog is open — the guard keeps those refetches
  // from clobbering unsaved name/value edits.
  const hydratedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      hydratedFor.current = null;
      return;
    }
    setConfirmDelete(false);
    if (setId === null) {
      setName('');
      setDescription('');
      setValues([]);
    }
  }, [open, setId]);
  const loaded = detail.data;
  useEffect(() => {
    if (!loaded || hydratedFor.current === loaded.id) return;
    hydratedFor.current = loaded.id;
    setName(loaded.name);
    setDescription(loaded.description ?? '');
    setValues(loaded.values);
  }, [loaded]);

  const invalidate = () =>
    Promise.all([
      utils.picklist.list.invalidate(),
      utils.picklist.get.invalidate(),
      utils.object.get.invalidate(),
    ]);
  const create = trpc.picklist.create.useMutation({
    meta: { context: "Couldn't create the set" },
    onSuccess: async () => {
      await invalidate();
      onOpenChange(false);
    },
  });
  const update = trpc.picklist.update.useMutation({
    meta: { context: "Couldn't save the set" },
    onSuccess: async () => {
      await invalidate();
      onOpenChange(false);
    },
  });
  const del = trpc.picklist.delete.useMutation({
    meta: { context: "Couldn't delete the set" },
    onSuccess: async () => {
      await invalidate();
      setConfirmDelete(false);
      onOpenChange(false);
    },
    onError: () => setConfirmDelete(false),
  });

  const pending = create.isPending || update.isPending || del.isPending;
  const save = () => {
    const trimmed = name.trim();
    if (setId === null) {
      create.mutate({ name: trimmed, description: description.trim() || undefined, values });
    } else {
      update.mutate({
        id: setId,
        patch: { name: trimmed, description: description.trim() || null, values },
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{setId === null ? 'New value set' : 'Manage value set'}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_260px]">
          <div className="flex flex-col gap-4">
            <Field label="Name" required htmlFor="picklist-set-name">
              <Input
                id="picklist-set-name"
                value={name}
                placeholder="Deal stages"
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="Description" htmlFor="picklist-set-description">
              <Textarea
                id="picklist-set-description"
                rows={2}
                value={description}
                placeholder="What this set is for"
                onChange={(e) => setDescription(e.target.value)}
              />
            </Field>
            <Field label="Values" required>
              <PicklistOptionsEditor options={values} onChange={setValues} disabled={pending} />
            </Field>
          </div>

          <div className="flex min-w-0 flex-col gap-3 md:border-l md:pl-6">
            <div>
              <div className="font-medium text-foreground text-sm">Assigned fields</div>
              <p className="mt-1 text-muted-foreground text-xs leading-relaxed">
                Picklist fields that draw their options from this set. Updating the set updates them
                all.
              </p>
            </div>
            {setId === null ? (
              <div className="rounded-md border border-dashed px-3 py-4 text-center text-muted-foreground text-xs">
                Save the set first, then assign fields to it.
              </div>
            ) : (
              <AssignedFieldsPanel
                setId={setId}
                usedBy={loaded?.usedBy ?? []}
                savedValues={loaded?.values ?? []}
              />
            )}
          </div>
        </div>

        <DialogFooter>
          {setId !== null && (
            <Button
              type="button"
              variant="outline"
              className="mr-auto text-destructive"
              disabled={pending}
              onClick={() => setConfirmDelete(true)}
            >
              Delete set
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={pending || !name.trim() || values.length === 0 || detail.isLoading}
            onClick={save}
          >
            {setId === null ? 'Create set' : 'Save changes'}
          </Button>
        </DialogFooter>
      </DialogContent>

      {setId !== null && (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title="Delete this value set?"
          description={`"${loaded?.name ?? name}" will be permanently removed. Deletion is blocked while any field still draws from the set — unassign those fields first.`}
          confirmLabel="Delete set"
          tone="destructive"
          pending={del.isPending}
          onConfirm={() => del.mutate({ id: setId })}
        />
      )}
    </Dialog>
  );
}

/** Right pane: current assignments + an object → field picker that binds a
 *  picklist field to the set. Assignment writes happen immediately (they're
 *  field-config edits, independent of the set draft on the left). */
function AssignedFieldsPanel({
  setId,
  usedBy,
  savedValues,
}: {
  setId: string;
  usedBy: Usage[];
  /** The set's persisted values — re-inlined into a field on unassign. */
  savedValues: PicklistOption[];
}) {
  const utils = trpc.useUtils();
  const objects = trpc.object.list.useQuery({});
  const [objectKey, setObjectKey] = useState('');
  const [fieldId, setFieldId] = useState('');
  const objectDetail = trpc.object.get.useQuery({ key: objectKey }, { enabled: !!objectKey });

  // Bindable = picklist/multipicklist fields not already on this set. Fields
  // bound to another set can be rebound; inline-option fields get converted.
  const candidates = (objectDetail.data?.fields ?? []).filter(
    (f) =>
      (f.type === 'picklist' || f.type === 'multipicklist') &&
      narrowFieldConfig('picklist', f.config).globalPicklistId !== setId,
  );

  const mutate = trpc.field.update.useMutation({
    meta: { context: "Couldn't update the field assignment" },
    onSuccess: async () => {
      await Promise.all([
        utils.picklist.get.invalidate({ id: setId }),
        utils.picklist.list.invalidate(),
        utils.object.get.invalidate(),
      ]);
    },
  });

  const assign = () => {
    const field = objectDetail.data?.fields.find((f) => f.id === fieldId);
    if (!field) return;
    // Exactly one of options/globalPicklistId may be set — drop the inline
    // options in the same write that binds the set.
    const { options: _inline, ...config } = narrowFieldConfig('picklist', field.config);
    mutate.mutate(
      { objectKey, fieldId: field.id, patch: { config: { ...config, globalPicklistId: setId } } },
      { onSuccess: () => setFieldId('') },
    );
  };

  const unassign = async (usage: Usage) => {
    const object = await utils.object.get.fetch({ key: usage.objectKey });
    const field = object.fields.find((f) => f.id === usage.fieldId);
    if (!field) return;
    const { globalPicklistId: _set, ...config } = narrowFieldConfig('picklist', field.config);
    mutate.mutate({
      objectKey: usage.objectKey,
      fieldId: usage.fieldId,
      patch: { config: { ...config, options: savedValues } },
    });
  };

  return (
    <div className="flex flex-col gap-2">
      {usedBy.length === 0 ? (
        <div className="rounded-md border border-dashed px-3 py-4 text-center text-muted-foreground text-xs">
          No fields draw from this set yet.
        </div>
      ) : (
        usedBy.map((usage) => (
          <div
            key={usage.fieldId}
            className="flex items-center justify-between gap-2 rounded-md border bg-card px-2.5 py-1.5"
          >
            <div className="min-w-0 truncate text-xs">
              <span className="font-medium text-foreground">{usage.objectLabel}</span>
              <span className="text-muted-foreground"> · {usage.fieldLabel}</span>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={`Unassign ${usage.objectLabel} · ${usage.fieldLabel}`}
              disabled={mutate.isPending}
              onClick={() => unassign(usage)}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        ))
      )}

      <div className="mt-1 flex flex-col gap-1.5">
        <Select
          value={objectKey || undefined}
          onValueChange={(v) => {
            setObjectKey(v);
            setFieldId('');
          }}
        >
          <SelectTrigger size="sm" className="w-full" aria-label="Object">
            <SelectValue placeholder="Object…" />
          </SelectTrigger>
          <SelectContent>
            {(objects.data ?? []).map((obj) => (
              <SelectItem key={obj.key} value={obj.key}>
                {obj.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1.5">
          <Select value={fieldId || undefined} onValueChange={setFieldId} disabled={!objectKey}>
            <SelectTrigger size="sm" className="min-w-0 flex-1" aria-label="Picklist field">
              <SelectValue
                placeholder={
                  objectKey && objectDetail.isSuccess && candidates.length === 0
                    ? 'No picklist fields'
                    : 'Picklist field…'
                }
              />
            </SelectTrigger>
            <SelectContent>
              {candidates.map((f) => (
                <SelectItem key={f.id} value={f.id}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!fieldId || mutate.isPending}
            onClick={assign}
          >
            <Plus />
            Assign
          </Button>
        </div>
      </div>
    </div>
  );
}
