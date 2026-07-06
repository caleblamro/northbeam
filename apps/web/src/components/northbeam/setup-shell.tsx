'use client';

// Setup-section shell. A persistent left nav (grouped by area) + a content
// outlet. Modeled on Salesforce Setup, but flatter — every leaf is a real
// URL, so deep-linking, browser back, and refresh all behave as expected.
//
// Nav items declare an optional `permission`; items the current role can't
// perform are hidden so viewers don't see Billing / Users / Audit links
// they'd just bounce off of.

import { useCanCheck } from '@/lib/can';
import { cn } from '@/lib/cn';
import type { Permission } from '@northbeam/core/roles';
import {
  Building2,
  CreditCard,
  Database,
  FileClock,
  ListChecks,
  Plug,
  ShieldHalf,
  Sparkles,
  Users,
  Workflow,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

type SetupNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  soon?: boolean;
  /** Permission required to even see the entry. Omit for everyone. */
  permission?: Permission;
};
type SetupNavGroup = { label: string; items: SetupNavItem[] };

const SETUP_NAV: SetupNavGroup[] = [
  {
    label: 'Workspace',
    items: [
      { href: '/setup/workspace', label: 'General', icon: Building2 },
      {
        href: '/setup/billing',
        label: 'Billing & plan',
        icon: CreditCard,
        soon: true,
        permission: 'org.billing.manage',
      },
    ],
  },
  {
    label: 'People & access',
    items: [
      {
        href: '/setup/users',
        label: 'Users',
        icon: Users,
        permission: 'org.members.invite',
      },
      {
        href: '/setup/roles',
        label: 'Roles & permissions',
        icon: ShieldHalf,
        permission: 'org.roles.manage',
      },
    ],
  },
  {
    label: 'Customization',
    items: [
      { href: '/setup/objects', label: 'Object manager', icon: Database },
      {
        href: '/setup/picklists',
        label: 'Picklists',
        icon: ListChecks,
        permission: 'object.manage',
      },
    ],
  },
  {
    label: 'Automation',
    items: [
      {
        href: '/setup/automations',
        label: 'Flows',
        icon: Workflow,
        permission: 'automation.manage',
      },
      {
        href: '/setup/agents',
        label: 'Agents',
        icon: Sparkles,
        permission: 'ai.agents.manage',
      },
    ],
  },
  {
    label: 'Operations',
    items: [
      { href: '/setup/integrations', label: 'Integrations', icon: Plug },
      {
        href: '/setup/audit',
        label: 'Audit log',
        icon: FileClock,
        permission: 'org.settings.update',
      },
    ],
  },
];

export function SetupShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const check = useCanCheck();
  return (
    <div className="grid gap-7 lg:grid-cols-[220px_minmax(0,1fr)]">
      <nav aria-label="Setup navigation" className="flex flex-col gap-5 lg:sticky lg:top-0">
        {SETUP_NAV.map((group) => {
          const visible = group.items.filter((it) => !it.permission || check(it.permission));
          if (visible.length === 0) return null;
          return (
            <div key={group.label} className="flex flex-col gap-1">
              <div className="px-2 pb-1 font-medium text-[10px] text-muted-foreground uppercase tracking-wider">
                {group.label}
              </div>
              {visible.map((it) => {
                const active = pathname === it.href || pathname.startsWith(`${it.href}/`);
                const Icon = it.icon;
                return (
                  <Link
                    key={it.href}
                    href={it.href}
                    data-active={active ? 'true' : undefined}
                    className="group flex items-center gap-2.5 rounded-md px-2.5 py-1.5 font-medium text-muted-foreground text-sm transition-colors hover:bg-muted hover:text-foreground data-[active=true]:bg-muted data-[active=true]:text-foreground"
                  >
                    <Icon className="size-3.5" />
                    <span className="flex-1">{it.label}</span>
                    {it.soon && (
                      <span className="rounded-full bg-muted px-1.5 py-0.5 font-medium text-[9px] text-muted-foreground uppercase tracking-wider group-data-[active=true]:bg-background">
                        Soon
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </nav>
      <div className={cn('flex min-w-0 flex-col gap-5')}>{children}</div>
    </div>
  );
}
