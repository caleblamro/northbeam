'use client';

// Users + invitations + role management. Reuses org.* tRPC procedures already
// wired through Better Auth on the API side; this page is the UI surface for
// admin+ members. Owner-only operations (transfer, delete) live in
// /setup/workspace.

import { InviteMemberDialog } from '@/components/northbeam/invite-member-dialog';
import { MemberConfirmDialogs } from '@/components/northbeam/member-confirm-dialogs';
import { MembersTable } from '@/components/northbeam/members-table';
import { SectionCard } from '@/components/northbeam/section-card';
import { trpc } from '@/lib/api';
import { useCan } from '@/lib/can';
import { useState } from 'react';

type Target = { id: string; label: string };

export default function UsersSetupPage() {
  const utils = trpc.useUtils();
  const data = trpc.org.members.useQuery().data;

  const canInvite = useCan('org.members.invite');
  const perms = {
    setRole: useCan('org.members.role'),
    remove: useCan('org.members.remove'),
    transfer: useCan('org.transfer'),
  };

  const invalidate = () => utils.org.members.invalidate();
  const setRole = trpc.org.setMemberRole.useMutation({ onSuccess: invalidate });
  const remove = trpc.org.removeMember.useMutation({ onSuccess: invalidate });
  const cancelInvite = trpc.org.cancelInvite.useMutation({ onSuccess: invalidate });
  const transferOwnership = trpc.org.transferOwnership.useMutation({
    meta: { context: "Couldn't transfer ownership" },
    onSuccess: invalidate,
  });

  const [pendingRemove, setPendingRemove] = useState<Target | null>(null);
  const [pendingTransfer, setPendingTransfer] = useState<Target | null>(null);

  return (
    <>
      <SectionCard
        title="Members"
        action={canInvite ? <InviteMemberDialog onInvited={invalidate} /> : null}
        padding="none"
      >
        {data && (
          <MembersTable
            members={data.members}
            invitations={data.invitations}
            perms={perms}
            setRolePending={setRole.isPending}
            cancelPending={cancelInvite.isPending}
            onSetRole={(memberId, role) => setRole.mutate({ memberId, role })}
            onCancelInvite={(invitationId) => cancelInvite.mutate({ invitationId })}
            onTransfer={setPendingTransfer}
            onRemove={setPendingRemove}
          />
        )}
      </SectionCard>

      <MemberConfirmDialogs
        removeTarget={pendingRemove}
        transferTarget={pendingTransfer}
        removePending={remove.isPending}
        transferPending={transferOwnership.isPending}
        onClose={(kind) => (kind === 'remove' ? setPendingRemove(null) : setPendingTransfer(null))}
        onRemove={async (t) => {
          await remove.mutateAsync({ memberIdOrEmail: t.id });
          setPendingRemove(null);
        }}
        onTransfer={async (t) => {
          await transferOwnership.mutateAsync({ memberId: t.id });
          setPendingTransfer(null);
        }}
      />
    </>
  );
}
