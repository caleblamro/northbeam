'use client';

// SaveViewDialog — name + share-target picker. Replaces the prompt() stub
// inside RecordListView's "Save as new view…" flow. The share-target shape
// here mirrors @northbeam/db/views.ShareTarget; the dialog only surfaces
// the three v1 modes (private / role / org). Direct-share-with-user lands
// when the member picker UI does.

import { Field } from '@/components/northbeam/field';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
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
import { cn } from '@/lib/cn';
import { VIEW_ICONS, VIEW_ICON_ORDER } from '@/lib/views/icons';
import { zodResolver } from '@hookform/resolvers/zod';
import { ROLES, ROLE_LABELS, type Role } from '@northbeam/core/roles';
import type { ShareTarget, ViewIcon } from '@northbeam/db/views';
import { Loader2 } from 'lucide-react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

const SHARE_MODES = ['private', 'role', 'org'] as const;
type ShareMode = (typeof SHARE_MODES)[number];

const SHAREABLE_ROLES: Role[] = ['admin', 'member', 'viewer'];

// `roles` is plain `z.array(...)` (not `.default([])`) — `.default(...)`
// makes the input optional while the output stays required, which RHF's
// resolver typing doesn't reconcile.
const Schema = z
  .object({
    label: z.string().min(1, 'Name is required.').max(80),
    icon: z.enum(VIEW_ICON_ORDER as [ViewIcon, ...ViewIcon[]]),
    shareMode: z.enum(SHARE_MODES),
    roles: z.array(z.enum(ROLES)),
  })
  .refine((v) => v.shareMode !== 'role' || v.roles.length > 0, {
    message: 'Pick at least one role.',
    path: ['roles'],
  });

type FormValues = z.infer<typeof Schema>;

interface SaveViewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Suggested label (typically the active view's name). */
  defaultLabel?: string;
  /** Suggested icon — defaults to `list`. */
  defaultIcon?: ViewIcon;
  isSaving: boolean;
  onSave(input: { label: string; sharedWith: ShareTarget[]; icon: ViewIcon }): void;
}

export function SaveViewDialog({
  open,
  onOpenChange,
  defaultLabel,
  defaultIcon,
  isSaving,
  onSave,
}: SaveViewDialogProps) {
  const form = useForm<FormValues>({
    resolver: zodResolver(Schema),
    mode: 'onBlur',
    defaultValues: {
      label: defaultLabel ?? '',
      icon: defaultIcon ?? 'list',
      shareMode: 'private',
      roles: [],
    },
  });

  const onSubmit = form.handleSubmit((values) => {
    const sharedWith: ShareTarget[] =
      values.shareMode === 'org'
        ? [{ kind: 'org' }]
        : values.shareMode === 'role'
          ? values.roles.map((role) => ({ kind: 'role', role }))
          : [];
    onSave({ label: values.label.trim(), sharedWith, icon: values.icon });
  });

  const shareMode = form.watch('shareMode');

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o)
          form.reset({
            label: defaultLabel ?? '',
            icon: defaultIcon ?? 'list',
            shareMode: 'private',
            roles: [],
          });
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Save view</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Field
            label="Name"
            required
            htmlFor="view-label"
            error={form.formState.errors.label?.message}
          >
            <Input
              id="view-label"
              autoFocus
              placeholder="Mine, this week"
              {...form.register('label')}
            />
          </Field>
          <Field label="Icon" htmlFor="view-icon">
            <Controller
              control={form.control}
              name="icon"
              render={({ field }) => (
                <div
                  id="view-icon"
                  className="grid grid-cols-8 gap-1.5 rounded-md border bg-card p-2"
                >
                  {VIEW_ICON_ORDER.map((key) => {
                    const Icon = VIEW_ICONS[key];
                    const isActive = field.value === key;
                    return (
                      <button
                        type="button"
                        key={key}
                        onClick={() => field.onChange(key)}
                        aria-label={key}
                        aria-pressed={isActive}
                        className={cn(
                          'flex aspect-square items-center justify-center rounded-md border bg-background text-muted-foreground transition-colors',
                          'hover:border-foreground/30 hover:text-foreground',
                          isActive &&
                            'border-primary/60 bg-primary/10 text-primary hover:text-primary',
                        )}
                      >
                        <Icon className="size-3.5" />
                      </button>
                    );
                  })}
                </div>
              )}
            />
          </Field>
          <Field label="Visibility" htmlFor="view-share-mode">
            <Controller
              control={form.control}
              name="shareMode"
              render={({ field }) => (
                <Select value={field.value} onValueChange={(v) => field.onChange(v as ShareMode)}>
                  <SelectTrigger id="view-share-mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="private">Only me</SelectItem>
                    <SelectItem value="role">Specific roles</SelectItem>
                    <SelectItem value="org">Everyone in the workspace</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </Field>
          {shareMode === 'role' && (
            <Field
              label="Visible to"
              htmlFor="view-roles"
              error={form.formState.errors.roles?.message}
            >
              <Controller
                control={form.control}
                name="roles"
                render={({ field }) => (
                  <div id="view-roles" className="flex flex-col gap-1.5">
                    {SHAREABLE_ROLES.map((role) => {
                      const checked = field.value.includes(role);
                      return (
                        <label key={role} className="flex items-center gap-2 text-sm">
                          <Checkbox
                            checked={checked}
                            onCheckedChange={(next) => {
                              const set = new Set(field.value);
                              if (next) set.add(role);
                              else set.delete(role);
                              field.onChange([...set]);
                            }}
                          />
                          {ROLE_LABELS[role]}
                        </label>
                      );
                    })}
                  </div>
                )}
              />
            </Field>
          )}
          <DialogFooter className="px-0 pb-0">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving && <Loader2 className="size-4 animate-spin" />}
              Save view
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
