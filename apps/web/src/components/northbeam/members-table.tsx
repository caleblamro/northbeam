'use client';

import { EmptyState } from '@/components/northbeam/empty-state';
import { Avatar } from '@/components/northbeam/primitives';
import { RoleSelect } from '@/components/northbeam/role-select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { Role } from '@northbeam/core/roles';
import { Crown, Mail, MoreHorizontal, Users } from 'lucide-react';

type Member = { id: string; name: string | null; email: string; role: string };
type Invitation = { id: string; email: string; role: string };

export function MembersTable({
  members,
  invitations,
  perms,
  setRolePending,
  cancelPending,
  onSetRole,
  onCancelInvite,
  onTransfer,
  onRemove,
}: {
  members: Member[];
  invitations: Invitation[];
  perms: { setRole: boolean; remove: boolean; transfer: boolean };
  setRolePending: boolean;
  cancelPending: boolean;
  onSetRole: (memberId: string, role: Exclude<Role, 'owner'>) => void;
  onCancelInvite: (invitationId: string) => void;
  onTransfer: (target: { id: string; label: string }) => void;
  onRemove: (target: { id: string; label: string }) => void;
}) {
  if (members.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="No members yet"
        body="Invite teammates and they'll show up here."
        size="sm"
      />
    );
  }

  return (
    <>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Member</TableHead>
            <TableHead className="w-44">Role</TableHead>
            <TableHead className="w-1" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {members.map((m) => (
            <TableRow key={m.id}>
              <TableCell>
                <div className="flex items-center gap-3">
                  <Avatar name={m.name || m.email} className="size-8" />
                  <div className="min-w-0">
                    <div className="font-medium text-foreground">{m.name || m.email}</div>
                    <div className="text-muted-foreground text-xs">{m.email}</div>
                  </div>
                </div>
              </TableCell>
              <TableCell>
                <RoleSelect
                  value={m.role as Role}
                  disabled={m.role === 'owner' || setRolePending || !perms.setRole}
                  onChange={(role) => onSetRole(m.id, role)}
                />
              </TableCell>
              <TableCell>
                {(perms.remove || perms.transfer) && m.role !== 'owner' ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label="Member actions">
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48">
                      <DropdownMenuLabel>{m.email}</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {perms.transfer && (
                        <DropdownMenuItem
                          onSelect={() => onTransfer({ id: m.id, label: m.name || m.email })}
                        >
                          <Crown className="size-3.5 text-muted-foreground" />
                          Transfer ownership…
                        </DropdownMenuItem>
                      )}
                      {perms.remove && (
                        <DropdownMenuItem
                          onSelect={() => onRemove({ id: m.id, label: m.name || m.email })}
                          className="text-destructive focus:text-destructive"
                        >
                          Remove from workspace
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {invitations.length > 0 && (
        <div className="border-t px-5 py-4">
          <div className="mb-3 font-medium text-muted-foreground text-[0.6875rem] uppercase tracking-wider">
            Pending invitations
          </div>
          <div className="flex flex-col gap-1">
            {invitations.map((inv) => (
              <div key={inv.id} className="flex items-center gap-3 py-1.5 text-sm">
                <Mail className="size-4 text-muted-foreground" />
                <span className="text-foreground">{inv.email}</span>
                <Badge tone="neutral" size="sm" className="capitalize">
                  {inv.role}
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto"
                  disabled={cancelPending}
                  onClick={() => onCancelInvite(inv.id)}
                >
                  Cancel
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
