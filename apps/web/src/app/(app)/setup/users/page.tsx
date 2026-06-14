'use client';

// Users + invitations + role management. Reuses org.* tRPC procedures already
// wired through Better Auth on the API side; this page is the UI surface for
// admin+ members. Owner-only operations (transfer, delete) live in
// /setup/workspace.

import { EmptyState } from '@/components/northbeam/empty-state';
import { Field } from '@/components/northbeam/field';
import { Avatar } from '@/components/northbeam/primitives';
import { SectionCard } from '@/components/northbeam/section-card';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { trpc } from '@/lib/api';
// Import from the /roles subpath, not the barrel — the barrel pulls
// logger.ts (pino) and auth.ts (server-only chokepoints) which Turbopack
// can't bundle for the browser.
import { ROLES, ROLE_LABELS, type Role } from '@northbeam/core/roles';
import { Loader2, Mail, MoreHorizontal, ShieldAlert, UserPlus, Users } from 'lucide-react';
import { useState } from 'react';

const INVITABLE_ROLES: Role[] = ['admin', 'member', 'viewer'];

export default function UsersSetupPage() {
  const utils = trpc.useUtils();
  const members = trpc.org.members.useQuery();
  const data = members.data;

  const setRole = trpc.org.setMemberRole.useMutation({
    onSuccess: () => utils.org.members.invalidate(),
  });
  const remove = trpc.org.removeMember.useMutation({
    onSuccess: () => utils.org.members.invalidate(),
  });
  const cancelInvite = trpc.org.cancelInvite.useMutation({
    onSuccess: () => utils.org.members.invalidate(),
  });

  const [pendingRemove, setPendingRemove] = useState<{ id: string; label: string } | null>(null);

  return (
    <>
      <SectionCard
        icon={Users}
        title="Members"
        action={<InviteButton onInvited={() => utils.org.members.invalidate()} />}
        padding="none"
      >
        {data && data.members.length === 0 ? (
          <EmptyState
            icon={Users}
            title="No members yet"
            body="Invite teammates and they'll show up here."
            size="sm"
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Member</TableHead>
                <TableHead className="w-44">Role</TableHead>
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
                    <RoleSelect
                      value={m.role as Role}
                      disabled={m.role === 'owner' || setRole.isPending}
                      onChange={(role) => setRole.mutate({ memberId: m.id, role })}
                    />
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" aria-label="Member actions">
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuLabel>{m.email}</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          disabled={m.role === 'owner'}
                          onSelect={() =>
                            setPendingRemove({ id: m.id, label: m.name || m.email })
                          }
                          className="text-destructive focus:text-destructive"
                        >
                          Remove from workspace
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {data && data.invitations.length > 0 && (
          <div className="border-t px-5 py-4">
            <div className="mb-2 font-semibold text-muted-foreground text-xs uppercase tracking-wider">
              Pending invitations
            </div>
            {data.invitations.map((inv) => (
              <div key={inv.id} className="flex items-center gap-3 py-1.5 text-sm">
                <Mail className="size-4 text-muted-foreground" />
                <span>{inv.email}</span>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs capitalize">
                  {inv.role}
                </span>
                <span className="ml-auto">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={cancelInvite.isPending}
                    onClick={() => cancelInvite.mutate({ invitationId: inv.id })}
                  >
                    Cancel
                  </Button>
                </span>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <RemoveMemberDialog
        target={pendingRemove}
        pending={remove.isPending}
        onCancel={() => setPendingRemove(null)}
        onConfirm={async () => {
          if (!pendingRemove) return;
          await remove.mutateAsync({ memberIdOrEmail: pendingRemove.id });
          setPendingRemove(null);
        }}
      />
    </>
  );
}

function RoleSelect({
  value,
  onChange,
  disabled,
}: {
  value: Role;
  onChange: (role: Role) => void;
  disabled?: boolean;
}) {
  return (
    <Select value={value} disabled={disabled} onValueChange={(v) => onChange(v as Role)}>
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

function InviteButton({ onInvited }: { onInvited: () => void }) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('member');
  const invite = trpc.org.invite.useMutation({
    onSuccess: () => {
      setOpen(false);
      setEmail('');
      setRole('member');
      onInvited();
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus />
          Invite
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite a teammate</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Field label="Email" required htmlFor="invite-email">
            <Input
              id="invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@company.com"
              autoFocus
            />
          </Field>
          <Field label="Role" htmlFor="invite-role">
            <Select value={role} onValueChange={(v) => setRole(v as Role)}>
              <SelectTrigger id="invite-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INVITABLE_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          {invite.isError && (
            <p className="text-destructive text-sm">{invite.error.message}</p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={!email.trim() || invite.isPending}
            onClick={() => invite.mutate({ email: email.trim(), role })}
          >
            {invite.isPending && <Loader2 className="size-4 animate-spin" />}
            Send invite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RemoveMemberDialog({
  target,
  pending,
  onCancel,
  onConfirm,
}: {
  target: { id: string; label: string } | null;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={!!target} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="size-4 text-destructive" />
            Remove member
          </DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground text-sm leading-relaxed">
          <span className="font-medium text-foreground">{target?.label}</span> will lose access to
          this workspace. They keep ownership of records they created, but they can't sign in here
          again until you re-invite them.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={pending} onClick={onConfirm}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            Remove
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
