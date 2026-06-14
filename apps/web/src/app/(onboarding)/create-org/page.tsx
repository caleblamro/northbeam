'use client';

// B1 — Create-org page guards: redirect to /sign-in if there's no session
// (so an unauthenticated user doesn't land here, submit, and see an opaque
// "sign in required" error). Mutation errors with code UNAUTHORIZED also
// bounce to /sign-in. Users who already have an active org are sent to /.

import { Field } from '@/components/northbeam/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { trpc } from '@/lib/api';
import { Building2, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

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
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);

  const create = trpc.org.create.useMutation({
    onSuccess: async () => {
      await utils.me.bootstrap.invalidate();
      router.replace('/');
    },
    onError: (err) => {
      if (isUnauthorized(err)) router.replace('/sign-in');
    },
  });

  // Auth guard. Wait for bootstrap, then route: no session → /sign-in;
  // session + activeOrg → / (they don't need to be here).
  useEffect(() => {
    if (!boot.data) return;
    if (!boot.data.session) router.replace('/sign-in');
    else if (boot.data.activeOrg) router.replace('/');
  }, [boot.data, router]);

  const onName = (v: string) => {
    setName(v);
    if (!slugEdited) setSlug(slugify(v));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    create.mutate({ name: name.trim(), slug: slug.trim() });
  };

  if (boot.isLoading || !boot.data || !boot.data.session || boot.data.activeOrg) {
    return (
      <div className="flex items-center justify-center gap-3">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1 className="mb-2 font-medium text-2xl tracking-[-0.02em]">Create your workspace</h1>
      <p className="mb-6 text-muted-foreground leading-relaxed">
        This is where your contacts, accounts, and deals live. You can invite teammates later.
      </p>
      <div className="flex flex-col gap-4">
        <Field label="Workspace name" required htmlFor="org-name">
          <InputGroup>
            <InputGroupAddon>
              <Building2 />
            </InputGroupAddon>
            <InputGroupInput
              id="org-name"
              value={name}
              onChange={(e) => onName(e.target.value)}
              placeholder="Acme Corp"
              required
            />
          </InputGroup>
        </Field>
        <Field label="URL slug" description="Lowercase letters, digits, and dashes" htmlFor="org-slug">
          <InputGroup>
            <InputGroupAddon className="text-muted-foreground">northbeam.app/</InputGroupAddon>
            <InputGroupInput
              id="org-slug"
              value={slug}
              onChange={(e) => {
                setSlugEdited(true);
                setSlug(slugify(e.target.value));
              }}
              placeholder="acme"
            />
          </InputGroup>
        </Field>
      </div>
      <div className="mt-4">
        <Button
          type="submit"
          className="w-full"
          disabled={!name.trim() || !slug.trim() || create.isPending}
        >
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
