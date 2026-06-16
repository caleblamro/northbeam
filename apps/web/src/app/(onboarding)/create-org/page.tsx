'use client';

// Create-org page guards: redirect to /sign-in if there's no session (so an
// unauthenticated user doesn't land here, submit, and see an opaque "sign in
// required" error). Mutation errors with code UNAUTHORIZED also bounce to
// /sign-in. Users who already have an active org are sent to /.

import { Field } from '@/components/northbeam/field';
import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { trpc } from '@/lib/api';
import { zodResolver } from '@hookform/resolvers/zod';
import { Building2, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
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

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function isUnauthorized(err: { data?: { code?: string } | null; message?: string }): boolean {
  return err.data?.code === 'UNAUTHORIZED' || /sign in required/i.test(err.message ?? '');
}

export default function CreateOrgPage() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const boot = trpc.me.bootstrap.useQuery();

  const form = useForm<FormValues>({
    resolver: zodResolver(Schema),
    mode: 'onBlur',
    defaultValues: { name: '', slug: '' },
  });

  const create = trpc.org.create.useMutation({
    meta: { silent: true },
    onSuccess: async () => {
      await utils.me.bootstrap.invalidate();
      router.replace('/');
    },
    onError: (err) => {
      if (isUnauthorized(err)) router.replace('/sign-in');
    },
  });

  useEffect(() => {
    if (!boot.data) return;
    if (!boot.data.session) router.replace('/sign-in');
    else if (boot.data.activeOrg) router.replace('/');
  }, [boot.data, router]);

  const nameValue = form.watch('name');
  useEffect(() => {
    if (form.formState.dirtyFields.slug) return;
    form.setValue('slug', slugify(nameValue ?? ''));
  }, [nameValue, form]);

  const onSubmit = form.handleSubmit((values) =>
    create.mutateAsync({ name: values.name.trim(), slug: values.slug.trim() }),
  );

  if (boot.isLoading || !boot.data || !boot.data.session || boot.data.activeOrg) {
    return (
      <div className="flex items-center justify-center gap-3">
        <Loader2 className="size-5 animate-spin text-primary" />
      </div>
    );
  }

  const errors = form.formState.errors;

  return (
    <form onSubmit={onSubmit}>
      <h1 className="mb-2 font-semibold text-2xl tracking-tight">Create your workspace</h1>
      <p className="mb-5 text-muted-foreground leading-relaxed">
        This is where your contacts, accounts, and deals live. You can invite teammates later.
      </p>
      <div className="flex flex-col gap-3.5">
        <Field
          label="Workspace name"
          required
          htmlFor="org-name"
          error={errors.name?.message}
        >
          <InputGroup>
            <InputGroupAddon>
              <Building2 />
            </InputGroupAddon>
            <InputGroupInput
              id="org-name"
              placeholder="Acme Corp"
              autoFocus
              {...form.register('name')}
            />
          </InputGroup>
        </Field>
        <Field
          label="URL slug"
          description="Lowercase letters, digits, and dashes."
          htmlFor="org-slug"
          error={errors.slug?.message}
        >
          <InputGroup>
            <InputGroupAddon className="text-muted-foreground">northbeam.app/</InputGroupAddon>
            <InputGroupInput
              id="org-slug"
              placeholder="acme"
              {...form.register('slug')}
            />
          </InputGroup>
        </Field>
      </div>
      <div className="mt-4">
        <Button type="submit" className="w-full" disabled={create.isPending}>
          {create.isPending && <Loader2 className="size-4 animate-spin" />}
          Create workspace
        </Button>
      </div>
      {create.isError && !isUnauthorized(create.error) && (
        <p className="mt-3 text-destructive text-sm">{create.error.message}</p>
      )}
    </form>
  );
}
