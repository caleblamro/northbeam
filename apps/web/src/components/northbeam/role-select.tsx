'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
// Import from the /roles subpath, not the barrel — the barrel pulls
// logger.ts (pino) and auth.ts (server-only chokepoints) which Turbopack
// can't bundle for the browser.
import { ROLES, ROLE_LABELS, type Role } from '@northbeam/core/roles';

type AssignableRole = Exclude<Role, 'owner'>;

export function RoleSelect({
  value,
  onChange,
  disabled,
}: {
  value: Role;
  onChange: (role: AssignableRole) => void;
  disabled?: boolean;
}) {
  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(v) => {
        if (v === 'owner') return; // unreachable — owner option is disabled
        onChange(v as AssignableRole);
      }}
    >
      <SelectTrigger className="h-8 w-36">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {ROLES.map((r) => (
          <SelectItem key={r} value={r} disabled={r === 'owner'}>
            {ROLE_LABELS[r]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
