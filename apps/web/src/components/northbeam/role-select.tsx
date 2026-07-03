'use client';

import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { trpc } from '@/lib/api';

/** Role picker for the members table. Lists every role defined in the org —
 *  the 4 system roles plus any custom ones — fetched from trpc.role.list.
 *  `owner` is shown (so an owner row renders its label) but never selectable;
 *  ownership moves through Transfer ownership. `value`/`onChange` are role KEYS. */
export function RoleSelect({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (roleKey: string) => void;
  disabled?: boolean;
}) {
  const rolesQ = trpc.role.list.useQuery(undefined, { staleTime: 30_000 });
  const roles = rolesQ.data ?? [];
  const system = roles.filter((r) => r.isSystem);
  const custom = roles.filter((r) => !r.isSystem);
  // Fallback label when the current key isn't in the (still-loading) list.
  const current = roles.find((r) => r.key === value);

  return (
    <Select
      value={value}
      disabled={disabled}
      onValueChange={(v) => {
        if (v === 'owner') return; // owner is display-only here
        onChange(v);
      }}
    >
      <SelectTrigger className="h-8 w-40">
        <SelectValue placeholder={current?.name ?? value} />
      </SelectTrigger>
      <SelectContent>
        {system.map((r) => (
          <SelectItem key={r.key} value={r.key} disabled={r.key === 'owner'}>
            {r.name}
          </SelectItem>
        ))}
        {custom.length > 0 && <SelectSeparator />}
        {custom.map((r) => (
          <SelectItem key={r.key} value={r.key}>
            {r.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
