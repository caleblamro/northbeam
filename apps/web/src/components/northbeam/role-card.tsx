'use client';

// One role in the permissions grid: label, optional Singleton flag, description.
// Read-only today; flips writable when the DB-backed role schema lands.

import { Badge } from '@/components/ui/badge';
import { ROLE_DESCRIPTIONS, ROLE_LABELS, type Role } from '@northbeam/core/roles';

export function RoleCard({ role }: { role: Role }) {
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
