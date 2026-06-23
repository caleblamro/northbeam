'use client';

import { Field } from '@/components/northbeam/field';
import { SectionCard } from '@/components/northbeam/section-card';
import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { trpc } from '@/lib/api';
import { useCan } from '@/lib/can';
import { zodResolver } from '@hookform/resolvers/zod';
import { Building2, Loader2, Settings as SettingsIcon } from 'lucide-react';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/;

const Schema = z.object({
  name: z.string().min(1, 'Workspace name is required.').max(80),
  slug: z
    .string()
    .min(1, 'Slug is required.')
    .regex(SLUG_RE, 'Lowercase letters, digits, and dashes only.'),
});
type FormValues = z.infer<typeof Schema>;

export default function WorkspaceSetupPage() {
  const utils = trpc.useUtils();
  const boot = trpc.me.bootstrap.useQuery();
  const canEdit = useCan('org.settings.update');

  const form = useForm<FormValues>({
    resolver: zodResolver(Schema),
    mode: 'onBlur',
    defaultValues: { name: '', slug: '' },
  });

  useEffect(() => {
    if (!boot.data?.activeOrg) return;
    form.reset({ name: boot.data.activeOrg.name, slug: boot.data.activeOrg.slug });
  }, [boot.data?.activeOrg, form]);

  const update = trpc.org.update.useMutation({
    meta: { context: "Couldn't save workspace" },
    onSuccess: () => utils.me.bootstrap.invalidate(),
  });

  const onSubmit = form.handleSubmit((values) =>
    update.mutateAsync(values).then(() => form.reset(values)),
  );

  const errors = form.formState.errors;

  return (
    <SectionCard
      icon={SettingsIcon}
      title="Workspace"
      action={<span className="text-muted-foreground text-xs">Identity & branding</span>}
    >
      <form onSubmit={onSubmit} className="flex max-w-md flex-col gap-4">
        {!canEdit && (
          <p className="text-muted-foreground text-xs">
            You have view-only access. Workspace settings can be changed by an admin.
          </p>
        )}
        <Field
          label="Workspace name"
          required
          htmlFor="ws-name"
          error={errors.name?.message}
        >
          <InputGroup>
            <InputGroupAddon>
              <Building2 />
            </InputGroupAddon>
            <InputGroupInput id="ws-name" {...form.register('name')} />
          </InputGroup>
        </Field>
        <Field
          label="Workspace URL"
          description="Used for links and invites."
          htmlFor="ws-slug"
          error={errors.slug?.message}
        >
          <InputGroup>
            <InputGroupAddon className="text-muted-foreground">northbeam.app/</InputGroupAddon>
            <InputGroupInput id="ws-slug" {...form.register('slug')} />
          </InputGroup>
        </Field>
        <div>
          <Button
            type="submit"
            disabled={!form.formState.isDirty || update.isPending || !canEdit}
            title={canEdit ? undefined : 'Admin role required to edit workspace settings.'}
          >
            {update.isPending && <Loader2 className="size-4 animate-spin" />}
            Save changes
          </Button>
        </div>
      </form>
    </SectionCard>
  );
}
