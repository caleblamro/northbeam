'use client';

// Users + invitations + role management. Reuses org.* tRPC procedures already
// wired through Better Auth on the API side; this page is the UI surface for
// admin+ members. Owner-only operations (transfer, delete) live in
// /setup/workspace.

import { EmptyState } from '@/components/northbeam/empty-state';
import { Field } from '@/components/northbeam/field';
import { Avatar } from '@/components/northbeam/primitives';
import { SectionCard } from '@/components/northbeam/section-card';
import { Badge } from '@/components/ui/badge';
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
import { useCan } from '@/lib/can';
import { zodResolver } from '@hookform/resolvers/zod';
// Import from the /roles subpath, not the barrel — the barrel pulls
// logger.ts (pino) and auth.ts (server-only chokepoints) which Turbopack
// can't bundle for the browser.
import { ROLES, ROLE_LABELS, type Role } from '@northbeam/core/roles';
import {
  Crown,
  Loader2,
  Mail,
  MoreHorizontal,
  ShieldAlert,
  UserPlus,
  Users,
} from 'lucide-react';
import { Controller, useForm } from 'react-hook-form';
import { z } from 'zod';
// Users icon stays — used by the empty state below.
import { useState } from 'react';

const INVITABLE_ROLES: Role[] = ['admin', 'member', 'viewer'];

export default function UsersSetupPage() {
  const utils = trpc.useUtils();
  const members = trpc.org.members.useQuery();
  const data = members.data;

  const canInvite = useCan('org.members.invite');
  const canSetRole = useCan('org.members.role');
  const canRemove = useCan('org.members.remove');
  const canTransfer = useCan('org.transfer');

  const setRole = trpc.org.setMemberRole.useMutation({
    onSuccess: () => utils.org.members.invalidate(),
  });
  const remove = trpc.org.removeMember.useMutation({
    onSuccess: () => utils.org.members.invalidate(),
  });
  const cancelInvite = trpc.org.cancelInvite.useMutation({
    onSuccess: () => utils.org.members.invalidate(),
  });
  const transferOwnership = trpc.org.transferOwnership.useMutation({
    meta: { context: "Couldn't transfer ownership" },
    onSuccess: () => utils.org.members.invalidate(),
  });

  const [pendingRemove, setPendingRemove] = useState<{ id: string; label: string } | null>(null);
  const [pendingTransfer, setPendingTransfer] = useState<{ id: string; label: string } | null>(
    null,
  );

  return (
    <>
      <SectionCard
        title="Members"
        action={
          canInvite ? (
            <InviteButton onInvited={() => utils.org.members.invalidate()} />
          ) : null
        }
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
                        <div className="font-medium text-foreground">{m.name || m.email}</div>
                        <div className="text-muted-foreground text-xs">{m.email}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <RoleSelect
                      value={m.role as Role}
                      disabled={m.role === 'owner' || setRole.isPending || !canSetRole}
                      onChange={(role) => setRole.mutate({ memberId: m.id, role })}
                    />
                  </TableCell>
                  <TableCell>
                    {(canRemove || canTransfer) && m.role !== 'owner' ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon-sm" aria-label="Member actions">
                            <MoreHorizontal />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuLabel>{m.email}</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          {canTransfer && (
                            <DropdownMenuItem
                              onSelect={() =>
                                setPendingTransfer({ id: m.id, label: m.name || m.email })
                              }
                            >
                              <Crown className="size-3.5 text-muted-foreground" />
                              Transfer ownership…
                            </DropdownMenuItem>
                          )}
                          {canRemove && (
                            <DropdownMenuItem
                              onSelect={() =>
                                setPendingRemove({ id: m.id, label: m.name || m.email })
                              }
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
        )}

        {data && data.invitations.length > 0 && (
          <div className="border-t px-5 py-4">
            <div className="mb-3 font-medium text-muted-foreground text-[0.6875rem] uppercase tracking-wider">
              Pending invitations
            </div>
            <div className="flex flex-col gap-1">
              {data.invitations.map((inv) => (
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
                    disabled={cancelInvite.isPending}
                    onClick={() => cancelInvite.mutate({ invitationId: inv.id })}
                  >
                    Cancel
                  </Button>
                </div>
              ))}
            </div>
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
      <TransferOwnershipDialog
        target={pendingTransfer}
        pending={transferOwnership.isPending}
        onCancel={() => setPendingTransfer(null)}
        onConfirm={async () => {
          if (!pendingTransfer) return;
          await transferOwnership.mutateAsync({ memberId: pendingTransfer.id });
          setPendingTransfer(null);
        }}
      />
    </>
  );
}

function TransferOwnershipDialog({
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
            <Crown className="size-4 text-amber-600 dark:text-amber-400" />
            Transfer ownership
          </DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground text-sm leading-relaxed">
          <span className="font-medium text-foreground">{target?.label}</span> will become the
          new owner of this workspace. You'll be demoted to an admin and will keep the ability
          to manage members and settings, but you will{' '}
          <span className="font-medium text-foreground">no longer be able to</span> delete the
          workspace, manage billing, or transfer ownership again.
        </p>
        <p className="text-muted-foreground text-xs">
          The change is immediate and recorded in the audit log.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button disabled={pending} onClick={onConfirm}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            Make them the owner
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

type AssignableRole = Exclude<Role, 'owner'>;

function RoleSelect({
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

const InviteSchema = z.object({
  email: z.string().email("That doesn't look like an email address."),
  role: z.enum(['admin', 'member', 'viewer'] as const),
});
type InviteFormValues = z.infer<typeof InviteSchema>;

function InviteButton({ onInvited }: { onInvited: () => void }) {
  const [open, setOpen] = useState(false);
  const form = useForm<InviteFormValues>({
    resolver: zodResolver(InviteSchema),
    mode: 'onBlur',
    defaultValues: { email: '', role: 'member' },
  });
  const invite = trpc.org.invite.useMutation({
    meta: { context: "Couldn't send invite" },
    onSuccess: () => {
      setOpen(false);
      form.reset({ email: '', role: 'member' });
      onInvited();
    },
  });
  const onSubmit = form.handleSubmit((values) =>
    invite.mutateAsync({ email: values.email.trim(), role: values.role }),
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) form.reset({ email: '', role: 'member' });
      }}
    >
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
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <Field
            label="Email"
            required
            htmlFor="invite-email"
            error={form.formState.errors.email?.message}
          >
            <Input
              id="invite-email"
              type="email"
              placeholder="teammate@company.com"
              autoFocus
              {...form.register('email')}
            />
          </Field>
          <Field
            label="Role"
            htmlFor="invite-role"
            error={form.formState.errors.role?.message}
          >
            <Controller
              control={form.control}
              name="role"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
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
              )}
            />
          </Field>
          <DialogFooter className="px-0 pb-0">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={invite.isPending}>
              {invite.isPending && <Loader2 className="size-4 animate-spin" />}
              Send invite
            </Button>
          </DialogFooter>
        </form>
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
