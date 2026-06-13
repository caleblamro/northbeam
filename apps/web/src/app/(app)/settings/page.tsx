'use client';

import { type Column, DataTable } from '@/components/northbeam/data-table';
import { Icon, type IconName } from '@/components/northbeam/icons';
import { EmptyState } from '@/components/northbeam/page-head';
import { Avatar, Badge } from '@/components/northbeam/primitives';
import { Button } from '@/components/northbeam/button-legacy';
import { Field, TextInput } from '@/components/northbeam/input-legacy';
import { trpc } from '@/lib/api';
import { useState } from 'react';

type Section = 'general' | 'members' | 'billing' | 'notifications';
const SECTIONS: { id: Section; label: string; icon: IconName }[] = [
  { id: 'general', label: 'General', icon: 'gear-six' },
  { id: 'members', label: 'Members', icon: 'users-three' },
  { id: 'billing', label: 'Billing', icon: 'credit-card' },
  { id: 'notifications', label: 'Notifications', icon: 'lightning' },
];

type Member = {
  id: string;
  role: string;
  userId: string;
  name: string | null;
  email: string;
};

function MembersSection() {
  const members = trpc.org.members.useQuery();
  const data = members.data;

  const columns: Column<Member>[] = [
    {
      key: 'name',
      header: 'Member',
      render: (m) => (
        <div className="tbl__name">
          <Avatar
            name={m.name || m.email}
            className="cmdk__avatar"
            style={{ width: 32, height: 32 }}
          />
          <div className="tbl__two">
            <b>{m.name || m.email}</b>
            <small>{m.email}</small>
          </div>
        </div>
      ),
    },
    {
      key: 'role',
      header: 'Role',
      render: (m) => <Badge variant={m.role === 'owner' ? 'brand' : undefined}>{m.role}</Badge>,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      render: () => <Button variant="ghost" size="sm" icon="dots-three" />,
    },
  ];

  return (
    <div className="set-card">
      <div className="set-card__h" style={{ display: 'flex', alignItems: 'center' }}>
        <div>
          <h3>Members</h3>
          <p>People with access to this workspace.</p>
        </div>
        <span style={{ marginLeft: 'auto' }}>
          <Button variant="primary" icon="user-plus">
            Invite
          </Button>
        </span>
      </div>
      <div className="set-card__body" style={{ padding: 0 }}>
        {members.isLoading ? (
          <EmptyState icon="users-three" title="Loading members…" />
        ) : (
          <DataTable<Member>
            columns={columns}
            rows={(data?.members ?? []) as Member[]}
            empty={<EmptyState icon="users-three" title="No members yet" />}
          />
        )}
        {data && data.invitations.length > 0 && (
          <div style={{ padding: 16, borderTop: '1px solid var(--divider)' }}>
            <div className="sb__group-label" style={{ padding: '0 0 8px' }}>
              Pending invitations
            </div>
            {data.invitations.map((inv) => (
              <div
                key={inv.id}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}
              >
                <Icon name="envelope-simple" size={16} />
                <span>{inv.email}</span>
                <Badge>{inv.role}</Badge>
                <span style={{ marginLeft: 'auto' }}>
                  <Button variant="ghost" size="sm">
                    Cancel
                  </Button>
                </span>
              </div>
            ))}
          </div>
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
    <div className="set-card">
      <div className="set-card__h">
        <h3>Workspace</h3>
        <p>Your workspace name and identity.</p>
      </div>
      <div className="set-card__body">
        <div className="stack" style={{ gap: 16, maxWidth: 440 }}>
          <Field label="Workspace name">
            <TextInput value={value} onChange={setName} leadIcon="buildings" />
          </Field>
          <Field label="Workspace URL" hint="Used for links and invites">
            <TextInput
              value={boot.data?.activeOrg?.slug ?? ''}
              onChange={() => undefined}
              leadAffix="northbeam.app/"
            />
          </Field>
          <div>
            <Button variant="primary">Save changes</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SimpleSection({ title, body, icon }: { title: string; body: string; icon: IconName }) {
  return (
    <div className="set-card">
      <div className="set-card__h">
        <h3>{title}</h3>
      </div>
      <div className="set-card__body">
        <EmptyState icon={icon} title={title} body={body} />
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [section, setSection] = useState<Section>('general');
  return (
    <>
      <div className="set">
        <nav className="set-nav">
          {SECTIONS.map((s) => (
            <button
              type="button"
              key={s.id}
              className="set-nav__item"
              data-active={section === s.id ? 'true' : undefined}
              onClick={() => setSection(s.id)}
            >
              <Icon name={s.icon} size={17} />
              {s.label}
            </button>
          ))}
        </nav>
        <div style={{ minWidth: 0 }}>
          {section === 'general' && <GeneralSection />}
          {section === 'members' && <MembersSection />}
          {section === 'billing' && (
            <SimpleSection
              title="Billing"
              body="Plans, payment methods, and invoices live here."
              icon="credit-card"
            />
          )}
          {section === 'notifications' && (
            <SimpleSection
              title="Notifications"
              body="Choose what Northbeam emails you about."
              icon="lightning"
            />
          )}
        </div>
      </div>
    </>
  );
}
