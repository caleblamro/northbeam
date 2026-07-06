'use client';

// useSaveArtifactAsView — the lean "Save as view" path shared by the /ai chat
// surface and the hub's artifact gallery. Same view.create shape the composer
// drawer's generic save uses: the artifact lands on the object it leans on
// most (dominant objectKey across live nodes) or workspace-level, then the
// browser navigates to the saved view.

import { trpc } from '@/lib/api';
import { dominantObjectKey } from '@/lib/artifact-info';
import type { ArtifactLike } from '@northbeam/core/artifact';
import type { ShareTarget, ViewIcon } from '@northbeam/db/views';
import { useRouter } from 'next/navigation';

export function useSaveArtifactAsView() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const objects = trpc.object.list.useQuery();
  const createView = trpc.view.create.useMutation({
    meta: { context: "Couldn't save the dashboard" },
  });

  const save = async (opts: {
    artifact: ArtifactLike;
    label: string;
    sharedWith: ShareTarget[];
    icon: ViewIcon;
    /** Provenance: the thread's user prompts (first one seeds refinement). */
    prompts: string[];
    model?: string | null;
  }) => {
    const targetKey = dominantObjectKey(opts.artifact);
    const target = targetKey ? objects.data?.find((o) => o.key === targetKey) : undefined;
    const slug =
      opts.label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48) || 'dashboard';
    const created = await createView.mutateAsync({
      objectId: target?.id ?? null,
      key: `${slug}-${Date.now().toString(36)}`,
      label: opts.label,
      type: 'dashboard',
      icon: opts.icon,
      filters: [],
      sort: [],
      columns: [],
      sharedWith: opts.sharedWith,
      config: {
        artifact: opts.artifact,
        prompt: opts.prompts[0] ?? '',
        prompts: opts.prompts,
        model: opts.model ?? undefined,
        generatedAt: new Date().toISOString(),
      },
    });
    await utils.view.list.invalidate();
    router.push(
      target ? `/${target.key}?view=${created?.id ?? ''}` : `/dashboards/${created?.id ?? ''}`,
    );
  };

  return { save, isSaving: createView.isPending };
}
