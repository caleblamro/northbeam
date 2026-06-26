'use client';

// Role × action permission matrix. Today it's a read-only view of the static
// PERMISSIONS map declared in @northbeam/core/roles — every cell is computed
// via `can(role, action)`. When #19 (Directus-style permission schema) lands,
// this same UI flips to writable cells backed by a DB-stored role/permission
// table, and the static map becomes the seed for the default policy.

import { SectionCard } from '@/components/northbeam/section-card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/cn';
// Import from the /roles subpath, not the barrel — the barrel pulls
// logger.ts (pino) and auth.ts (server-only chokepoints) which Turbopack
// can't bundle for the browser.
import {
  PERMISSION_GROUPS,
  ROLES,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
  type Role,
  can,
} from '@northbeam/core/roles';
import { Check, Info, Minus } from 'lucide-react';

export default function PermissionsSetupPage() {
  return (
    <>
      <div className="flex items-start gap-3 rounded-md border bg-card px-4 py-3">
        <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 text-sm">
          <div className="font-medium text-foreground">Roles are read-only for now</div>
          <p className="text-muted-foreground text-xs leading-relaxed">
            This matrix shows the current built-in policy. Custom roles, per-record sharing rules,
            and field-level security are coming in a follow-up.
          </p>
        </div>
      </div>

      <SectionCard title="Roles">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {ROLES.map((r) => (
            <RoleCard key={r} role={r} />
          ))}
        </div>
      </SectionCard>

      <SectionCard
        title="Permission matrix"
        action={
          <span className="text-muted-foreground text-xs">
            Who can do what across the workspace
          </span>
        }
        padding="none"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-[0.6875rem] uppercase tracking-wider">
                  Action
                </th>
                {ROLES.map((r) => (
                  <th
                    key={r}
                    className="w-24 px-3 py-2.5 text-center font-medium text-muted-foreground text-[0.6875rem] uppercase tracking-wider"
                  >
                    {ROLE_LABELS[r]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {PERMISSION_GROUPS.map((group) => (
                <PermissionGroupRows key={group.id} group={group} />
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>
    </>
  );
}

function RoleCard({ role }: { role: Role }) {
  return (
    <div className="rounded-md border bg-card p-4">
      <div className="flex items-center gap-2">
        <span className="font-medium text-foreground text-sm">{ROLE_LABELS[role]}</span>
        {role === 'owner' && (
          <Badge tone="accent" size="sm">
            Singleton
          </Badge>
        )}
      </div>
      <p className="mt-1.5 text-muted-foreground text-xs leading-relaxed">
        {ROLE_DESCRIPTIONS[role]}
      </p>
    </div>
  );
}

function PermissionGroupRows({
  group,
}: {
  group: (typeof PERMISSION_GROUPS)[number];
}) {
  return (
    <>
      <tr className="border-b bg-muted/20">
        <td
          colSpan={1 + ROLES.length}
          className="px-4 py-1.5 font-medium text-[0.6875rem] text-muted-foreground uppercase tracking-wider"
        >
          {group.label}
        </td>
      </tr>
      {group.permissions.map((p) => (
        <tr key={p.key} className="border-b last:border-b-0 hover:bg-muted/30">
          <td className="px-4 py-2.5">
            <div className="flex items-center gap-1.5">
              <span className="font-medium text-foreground">{p.label}</span>
              {p.description && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      aria-label="More info"
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <Info className="size-3.5" />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>{p.description}</TooltipContent>
                </Tooltip>
              )}
            </div>
            <code className="text-[10px] text-muted-foreground">{p.key}</code>
          </td>
          {ROLES.map((r) => (
            <td key={r} className="px-3 py-2.5 text-center">
              <PermissionCell allowed={can(r, p.key)} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

function PermissionCell({ allowed }: { allowed: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex size-6 items-center justify-center',
        allowed ? 'text-foreground' : 'text-muted-foreground/30',
      )}
      aria-label={allowed ? 'Allowed' : 'Not allowed'}
    >
      {allowed ? <Check className="size-4" /> : <Minus className="size-3.5" />}
    </span>
  );
}
