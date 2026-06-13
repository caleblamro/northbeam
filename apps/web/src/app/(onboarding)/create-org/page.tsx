'use client';

// B1 — Create-org page guards: redirect to /sign-in if there's no session
// (so an unauthenticated user doesn't land here, submit, and see an opaque
// "sign in required" error). Mutation errors with code UNAUTHORIZED also
// bounce to /sign-in. Users who already have an active org are sent to /.

import { Spinner } from '@/components/northbeam/primitives';
import { Button } from '@/components/northbeam/button-legacy';
import { Field, TextInput } from '@/components/northbeam/input-legacy';
import { trpc } from '@/lib/api';
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center' }}>
        <Spinner style={{ color: 'var(--brand)' }} />
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1
        style={{
          fontSize: 'var(--text-2xl)',
          fontWeight: 600,
          letterSpacing: '-0.02em',
          margin: '0 0 8px',
        }}
      >
        Create your workspace
      </h1>
      <p style={{ color: 'var(--ink-muted)', margin: '0 0 22px', lineHeight: 1.5 }}>
        This is where your contacts, accounts, and deals live. You can invite teammates later.
      </p>
      <div className="stack" style={{ gap: 14 }}>
        <Field label="Workspace name" required htmlFor="org-name">
          <TextInput value={name} onChange={onName} leadIcon="buildings" placeholder="Acme Corp" />
        </Field>
        <Field label="URL slug" hint="Lowercase letters, digits, and dashes" htmlFor="org-slug">
          <TextInput
            value={slug}
            onChange={(v) => {
              setSlugEdited(true);
              setSlug(slugify(v));
            }}
            leadAffix="northbeam.app/"
            placeholder="acme"
          />
        </Field>
      </div>
      <div style={{ marginTop: 18 }}>
        <Button
          type="submit"
          block
          loading={create.isPending}
          disabled={!name.trim() || !slug.trim()}
        >
          Create workspace
        </Button>
      </div>
      {create.isError && !isUnauthorized(create.error) && (
        <p style={{ color: 'var(--danger)', fontSize: 'var(--text-sm)', marginTop: 12 }}>
          {create.error.message}
        </p>
      )}
    </form>
  );
}
