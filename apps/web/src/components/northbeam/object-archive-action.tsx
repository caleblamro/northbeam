'use client';

// Archive / unarchive lifecycle control for the object-detail Overview.
// Soft-archive hides the object from pickers and blocks new record writes;
// reads stay live (see object.archive in apps/api/src/trpc/routers/object.ts).
// System objects can't be archived, so the control renders nothing for them
// (and for anyone without object.manage).

import { ConfirmDialog } from '@/components/northbeam/confirm-dialog';
import { Button } from '@/components/ui/button';
import { trpc } from '@/lib/api';
import { useCan } from '@/lib/can';
import { Archive, ArchiveRestore } from 'lucide-react';
import { useState } from 'react';

export function ObjectArchiveAction({
  objectId,
  objectKey,
  label,
  isSystem,
  archived,
}: {
  objectId: string;
  objectKey: string;
  label: string;
  isSystem: boolean;
  archived: boolean;
}) {
  const canManage = useCan('object.manage');
  const [confirming, setConfirming] = useState(false);
  const utils = trpc.useUtils();
  const invalidate = () => {
    utils.object.get.invalidate({ key: objectKey });
    utils.object.list.invalidate();
  };

  const archive = trpc.object.archive.useMutation({
    meta: { context: "Couldn't archive the object" },
    onSuccess: () => {
      setConfirming(false);
      invalidate();
    },
  });
  const unarchive = trpc.object.unarchive.useMutation({
    meta: { context: "Couldn't unarchive the object" },
    onSuccess: invalidate,
  });

  if (!canManage || isSystem) return null;

  if (archived) {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled={unarchive.isPending}
        onClick={() => unarchive.mutate({ objectId })}
      >
        <ArchiveRestore />
        {unarchive.isPending ? 'Restoring…' : 'Unarchive'}
      </Button>
    );
  }

  return (
    <ConfirmDialog
      open={confirming}
      onOpenChange={setConfirming}
      trigger={
        <Button variant="outline" size="sm">
          <Archive />
          Archive
        </Button>
      }
      title={`Archive ${label}?`}
      description="Archived objects disappear from pickers and new records can't be created. Existing records stay readable, and you can unarchive at any time."
      confirmLabel="Archive object"
      tone="destructive"
      onConfirm={() => archive.mutate({ objectId })}
      pending={archive.isPending}
    />
  );
}
