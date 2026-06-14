'use client';

import { Field } from '@/components/northbeam/field';
import { SectionCard } from '@/components/northbeam/section-card';
import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { trpc } from '@/lib/api';
import { Building2, Loader2, Settings as SettingsIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

export default function WorkspaceSetupPage() {
  const utils = trpc.useUtils();
  const boot = trpc.me.bootstrap.useQuery();
  const update = trpc.org.update.useMutation({
    onSuccess: () => utils.me.bootstrap.invalidate(),
  });

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');

  useEffect(() => {
    if (!boot.data?.activeOrg) return;
    setName(boot.data.activeOrg.name);
    setSlug(boot.data.activeOrg.slug);
  }, [boot.data?.activeOrg]);

  const dirty =
    !!boot.data?.activeOrg &&
    (name !== boot.data.activeOrg.name || slug !== boot.data.activeOrg.slug);

  return (
    <SectionCard
      icon={SettingsIcon}
      title="Workspace"
      action={<span className="text-muted-foreground text-xs">Identity & branding</span>}
    >
      <div className="flex max-w-md flex-col gap-4">
        <Field label="Workspace name" htmlFor="ws-name">
          <InputGroup>
            <InputGroupAddon>
              <Building2 />
            </InputGroupAddon>
            <InputGroupInput
              id="ws-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </InputGroup>
        </Field>
        <Field label="Workspace URL" description="Used for links and invites" htmlFor="ws-slug">
          <InputGroup>
            <InputGroupAddon className="text-muted-foreground">northbeam.app/</InputGroupAddon>
            <InputGroupInput
              id="ws-slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
            />
          </InputGroup>
        </Field>
        <div>
          <Button
            disabled={!dirty || update.isPending}
            onClick={() => update.mutate({ name, slug })}
          >
            {update.isPending && <Loader2 className="size-4 animate-spin" />}
            Save changes
          </Button>
        </div>
        {update.isError && (
          <p className="text-destructive text-sm">{update.error.message}</p>
        )}
      </div>
    </SectionCard>
  );
}
