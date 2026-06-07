'use client';

import { Button } from '@/components/ui/button';
import { Field, TextInput } from '@/components/ui/input';
import { trpc } from '@/lib/api';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

function slugify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export default function CreateOrgPage() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugEdited, setSlugEdited] = useState(false);
  const create = trpc.org.create.useMutation({
    onSuccess: async () => {
      await utils.me.bootstrap.invalidate();
      router.replace('/');
    },
  });

  const onName = (v: string) => {
    setName(v);
    if (!slugEdited) setSlug(slugify(v));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    create.mutate({ name: name.trim(), slug: slug.trim() });
  };

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
      {create.isError && (
        <p style={{ color: 'var(--danger)', fontSize: 'var(--text-sm)', marginTop: 12 }}>
          {create.error.message}
        </p>
      )}
    </form>
  );
}
