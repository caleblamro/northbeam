'use client';

import { Field } from '@/components/northbeam/field';
import { SectionCard } from '@/components/northbeam/section-card';
import { Avatar } from '@/components/northbeam/primitives';
import { EmptyState } from '@/components/northbeam/empty-state';
import { Button } from '@/components/ui/button';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { trpc } from '@/lib/api';
import {
  Bell,
  Building2,
  CreditCard,
  Mail,
  MoreHorizontal,
  Settings as SettingsIcon,
  UserPlus,
  Users,
} from 'lucide-react';
import { useState } from 'react';
import type { LucideIcon } from 'lucide-react';

type Section = 'general' | 'members' | 'billing' | 'notifications';
const SECTIONS: { id: Section; label: string; icon: LucideIcon }[] = [
  { id: 'general', label: 'General', icon: SettingsIcon },
  { id: 'members', label: 'Members', icon: Users },
  { id: 'billing', label: 'Billing', icon: CreditCard },
  { id: 'notifications', label: 'Notifications', icon: Bell },
];

export default function SettingsPage() {
  const [section, setSection] = useState<Section>('general');
  return (
    <div className="grid gap-7 lg:grid-cols-[200px_minmax(0,1fr)]">
      <nav className="flex flex-col gap-0.5 lg:sticky lg:top-0">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          return (
            <button
              key={s.id}
              type="button"
              data-active={section === s.id ? 'true' : undefined}
              onClick={() => setSection(s.id)}
              className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left font-medium text-muted-foreground text-sm transition-colors hover:bg-muted hover:text-foreground data-[active=true]:bg-primary/10 data-[active=true]:text-primary"
            >
              <Icon className="size-4" />
              {s.label}
            </button>
          );
        })}
      </nav>
      <div className="min-w-0">
        {section === 'general' && <GeneralSection />}
        {section === 'members' && <MembersSection />}
        {section === 'billing' && (
          <SectionCard icon={CreditCard} title="Billing">
            <EmptyState icon={CreditCard} title="Billing" body="Plans, payment methods, and invoices live here." size="sm" />
          </SectionCard>
        )}
        {section === 'notifications' && (
          <SectionCard icon={Bell} title="Notifications">
            <EmptyState icon={Bell} title="Notifications" body="Choose what Northbeam emails you about." size="sm" />
          </SectionCard>
        )}
      </div>
    </div>
  );
}

function GeneralSection() {
  const boot = trpc.me.bootstrap.useQuery();
  const [name, setName] = useState('');
  const value = name || boot.data?.activeOrg?.name || '';
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
            <InputGroupInput id="ws-name" value={value} onChange={(e) => setName(e.target.value)} />
          </InputGroup>
        </Field>
        <Field label="Workspace URL" description="Used for links and invites" htmlFor="ws-slug">
          <InputGroup>
            <InputGroupAddon className="text-muted-foreground">northbeam.app/</InputGroupAddon>
            <InputGroupInput
              id="ws-slug"
              value={boot.data?.activeOrg?.slug ?? ''}
              onChange={() => undefined}
            />
          </InputGroup>
        </Field>
        <div>
          <Button>Save changes</Button>
        </div>
      </div>
    </SectionCard>
  );
}

function MembersSection() {
  const members = trpc.org.members.useQuery();
  const data = members.data;
  return (
    <SectionCard
      icon={Users}
      title="Members"
      action={
        <Button>
          <UserPlus />
          Invite
        </Button>
      }
      padding="none"
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Member</TableHead>
            <TableHead>Role</TableHead>
            <TableHead className="w-1" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {(data?.members ?? []).map((m) => (
            <TableRow key={m.id}>
              <TableCell>
                <div className="flex items-center gap-3">
                  <Avatar name={m.name || m.email} className="size-8" />
                  <div className="min-w-0">
                    <div className="font-semibold text-foreground">{m.name || m.email}</div>
                    <div className="text-muted-foreground text-xs">{m.email}</div>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <span className="rounded-full bg-muted px-2 py-0.5 font-medium text-xs capitalize">
                  {m.role}
                </span>
              </TableCell>
              <TableCell>
                <Button variant="ghost" size="icon-sm" aria-label="Member actions">
                  <MoreHorizontal />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {data && data.invitations.length > 0 && (
        <div className="border-t px-5 py-4">
          <div className="mb-2 font-semibold text-muted-foreground text-xs uppercase tracking-wider">
            Pending invitations
          </div>
          {data.invitations.map((inv) => (
            <div key={inv.id} className="flex items-center gap-3 py-1.5 text-sm">
              <Mail className="size-4 text-muted-foreground" />
              <span>{inv.email}</span>
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs">{inv.role}</span>
              <span className="ml-auto">
                <Button variant="ghost" size="sm">
                  Cancel
                </Button>
              </span>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}
