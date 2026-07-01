'use client';

import { ConfirmDialog } from '@/components/northbeam/confirm-dialog';

type Target = { id: string; label: string };

export function MemberConfirmDialogs({
  removeTarget,
  transferTarget,
  removePending,
  transferPending,
  onRemove,
  onTransfer,
  onClose,
}: {
  removeTarget: Target | null;
  transferTarget: Target | null;
  removePending: boolean;
  transferPending: boolean;
  onRemove: (target: Target) => Promise<void>;
  onTransfer: (target: Target) => Promise<void>;
  onClose: (kind: 'remove' | 'transfer') => void;
}) {
  return (
    <>
      <ConfirmDialog
        open={!!removeTarget}
        onOpenChange={(o) => !o && onClose('remove')}
        title="Remove member"
        description={
          <>
            <span className="font-medium text-foreground">{removeTarget?.label}</span> will lose
            access to this workspace. They keep ownership of records they created, but they can't
            sign in here again until you re-invite them.
          </>
        }
        confirmLabel="Remove"
        tone="destructive"
        pending={removePending}
        onConfirm={() => removeTarget && onRemove(removeTarget)}
      />
      <ConfirmDialog
        open={!!transferTarget}
        onOpenChange={(o) => !o && onClose('transfer')}
        title="Transfer ownership"
        description={
          <>
            <span className="font-medium text-foreground">{transferTarget?.label}</span> will become
            the new owner. You'll be demoted to admin — keeping member and settings management, but
            losing the ability to delete the workspace, manage billing, or transfer ownership again.
          </>
        }
        confirmLabel="Make them the owner"
        pending={transferPending}
        onConfirm={() => transferTarget && onTransfer(transferTarget)}
      />
    </>
  );
}
