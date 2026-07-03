// Apply refinement patch ops to the current artifact. Pure and tolerant:
// out-of-range indices skip their op (the repair pass + walker degrade
// gracefully anyway; a stale index must not kill an otherwise-good edit).
// Ops apply SEQUENTIALLY — an insert shifts later indices, same as the model
// was taught in the refinement prompt.

import type { ArtifactLike, ArtifactNodeLike, ArtifactPatch } from '@northbeam/core';

const MAX_COMPONENTS = 20;

export function applyArtifactPatch(
  current: ArtifactLike,
  patch: ArtifactPatch,
): { artifact: ArtifactLike; applied: number; skipped: number } {
  const components: ArtifactNodeLike[] = current.components.map((c) => ({ ...c }));
  let applied = 0;
  let skipped = 0;

  for (const op of patch) {
    if (op.op === 'insert') {
      if (op.index < 0 || op.index > components.length || components.length >= MAX_COMPONENTS) {
        skipped++;
        continue;
      }
      components.splice(op.index, 0, op.node as ArtifactNodeLike);
      applied++;
      continue;
    }
    if (op.index < 0 || op.index >= components.length) {
      skipped++;
      continue;
    }
    if (op.op === 'set') {
      components[op.index] = op.node as ArtifactNodeLike;
      applied++;
    } else if (op.op === 'remove') {
      components.splice(op.index, 1);
      applied++;
    } else {
      const target = components[op.index];
      if (!target) {
        skipped++;
        continue;
      }
      const merged: Record<string, unknown> = { ...(target.props ?? {}) };
      for (const [k, v] of Object.entries(op.props)) {
        if (v === null) delete merged[k];
        else merged[k] = v;
      }
      components[op.index] = { ...target, props: merged };
      applied++;
    }
  }

  return { artifact: { version: '1', components }, applied, skipped };
}
