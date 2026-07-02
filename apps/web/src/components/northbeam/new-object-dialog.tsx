'use client';

// New-object wizard — collects label / plural / API key / icon / color /
// description and calls object.create (the server scaffolds the `name` field,
// the physical table, and a default "All" view). Form pattern mirrors
// setup/workspace/page.tsx: react-hook-form + zod inside FormDialog.
// Model: EverOn NewObjectModal, restyled with Northbeam primitives.

import { ObjChip } from '@/components/northbeam/app-bits';
import { Field } from '@/components/northbeam/field';
import { FormDialog } from '@/components/northbeam/form-dialog';
import { Icon, type IconName } from '@/components/northbeam/icons';
import { ADMIN_SWATCHES, SwatchPicker } from '@/components/northbeam/swatch-picker';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { trpc } from '@/lib/api';
import { cn } from '@/lib/cn';
import { zodResolver } from '@hookform/resolvers/zod';
import { KEY_RE, keyFromLabel } from '@northbeam/db/keys';
import { useRouter } from 'next/navigation';
import type * as React from 'react';
import { useRef, useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';

// Curated object glyphs — every name is verified against the Phosphor→lucide
// map in icons.tsx (do not add names that aren't registered there).
const OBJECT_ICONS: { name: IconName; label: string }[] = [
  { name: 'buildings', label: 'Buildings' },
  { name: 'user', label: 'Person' },
  { name: 'currency-circle-dollar', label: 'Currency' },
  { name: 'lightning', label: 'Lightning' },
  { name: 'map-pin', label: 'Map pin' },
  { name: 'clock', label: 'Clock' },
  { name: 'check-square', label: 'Checkbox' },
  { name: 'hash', label: 'Hash' },
  { name: 'link-simple', label: 'Link' },
  { name: 'envelope-simple', label: 'Envelope' },
  { name: 'list-checks', label: 'Checklist' },
  { name: 'sigma', label: 'Sigma' },
];

const Schema = z.object({
  label: z.string().min(1, 'Label is required.').max(80),
  labelPlural: z.string().min(1, 'Plural label is required.').max(80),
  key: z
    .string()
    .regex(KEY_RE, 'Lowercase letters, digits, and underscores; must start with a letter.'),
  icon: z.string().min(1),
  color: z.string().min(1),
  description: z.string().max(500).optional(),
});
type FormValues = z.infer<typeof Schema>;

const DEFAULTS: FormValues = {
  label: '',
  labelPlural: '',
  key: '',
  icon: 'buildings',
  color: ADMIN_SWATCHES[0]?.value ?? '',
  description: '',
};

/** ObjChip-style tile (color-mix wash + inset hairline in the chosen color)
 *  wrapping an icon glyph instead of the monogram. */
function IconTile({
  name,
  label,
  color,
  selected,
  onSelect,
}: {
  name: IconName;
  label: string;
  color: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={label}
      title={label}
      onClick={onSelect}
      className={cn(
        'flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg outline-offset-2 transition-opacity',
        'focus-visible:outline-2 focus-visible:outline-ring',
        selected ? 'outline-2 outline-[var(--accent)]' : 'outline-none hover:opacity-75',
      )}
      style={{
        background: `color-mix(in srgb, ${color} 16%, var(--surface))`,
        color,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${color} 26%, transparent)`,
      }}
    >
      <Icon name={name} size={16} />
    </button>
  );
}

export function NewObjectDialog({ trigger }: { trigger: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const utils = trpc.useUtils();
  // Auto-derived fields track "has the user typed here" so they follow the
  // label until first manual edit, then stop.
  const keyTouched = useRef(false);
  const pluralTouched = useRef(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(Schema),
    mode: 'onBlur',
    defaultValues: DEFAULTS,
  });

  const create = trpc.object.create.useMutation({
    meta: { context: "Couldn't create the object" },
    onSuccess: async (created) => {
      await utils.object.list.invalidate();
      setOpen(false);
      router.push(`/setup/objects/${created.object.key}`);
    },
  });

  const label = form.watch('label');
  const color = form.watch('color');
  const errors = form.formState.errors;

  const onSubmit = form.handleSubmit((values) =>
    create.mutate({
      label: values.label.trim(),
      labelPlural: values.labelPlural.trim(),
      key: values.key,
      icon: values.icon,
      color: values.color,
      description: values.description?.trim() || undefined,
    }),
  );

  return (
    <FormDialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          form.reset(DEFAULTS);
          keyTouched.current = false;
          pluralTouched.current = false;
        }
      }}
      trigger={trigger}
      title="New object"
      description="Custom objects get their own table, form, and list views — just like Accounts or Deals."
      submitLabel={create.isPending ? 'Creating…' : 'Create object'}
      pending={create.isPending}
      onSubmit={onSubmit}
    >
      <Field label="Label" required htmlFor="obj-label" error={errors.label?.message}>
        <div className="flex items-center gap-2">
          <ObjChip label={label || '?'} color={color} />
          <Input
            id="obj-label"
            placeholder="e.g. Project"
            autoComplete="off"
            {...form.register('label', {
              onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
                const value = e.target.value;
                if (!pluralTouched.current) {
                  form.setValue('labelPlural', value ? `${value}s` : '');
                }
                if (!keyTouched.current) {
                  form.setValue('key', value.trim() ? keyFromLabel(value) : '');
                }
              },
            })}
          />
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field
          label="Plural label"
          required
          htmlFor="obj-plural"
          error={errors.labelPlural?.message}
        >
          <Input
            id="obj-plural"
            autoComplete="off"
            {...form.register('labelPlural', {
              onChange: () => {
                pluralTouched.current = true;
              },
            })}
          />
        </Field>
        <Field
          label="API name"
          required
          htmlFor="obj-key"
          error={errors.key?.message}
          description="Used in URLs and the API. Locked after creation."
        >
          <Input
            id="obj-key"
            className="font-mono"
            spellCheck={false}
            autoComplete="off"
            {...form.register('key', {
              onChange: () => {
                keyTouched.current = true;
              },
            })}
          />
        </Field>
      </div>
      <Field label="Icon">
        <Controller
          name="icon"
          control={form.control}
          render={({ field }) => (
            <div className="flex flex-wrap gap-2">
              {OBJECT_ICONS.map((icon) => (
                <IconTile
                  key={icon.name}
                  name={icon.name}
                  label={icon.label}
                  color={color}
                  selected={field.value === icon.name}
                  onSelect={() => field.onChange(icon.name)}
                />
              ))}
            </div>
          )}
        />
      </Field>
      <Field label="Color">
        <Controller
          name="color"
          control={form.control}
          render={({ field }) => <SwatchPicker value={field.value} onChange={field.onChange} />}
        />
      </Field>
      <Field label="Description" optional htmlFor="obj-desc">
        <Textarea
          id="obj-desc"
          rows={2}
          placeholder="What does this object track?"
          {...form.register('description')}
        />
      </Field>
    </FormDialog>
  );
}
