// Small pure helpers over artifact trees, shared by the AI hub gallery and
// the full chat surface. (The composer drawer keeps its own private copies —
// it predates this module and stays untouched.)

import type { ArtifactLike, ArtifactNodeLike } from '@northbeam/core/artifact';

/** A stored/streamed artifact payload → something the walker can render:
 *  needs a components array; nodes (and one level of children) without a
 *  `component` string yet are dropped. Null when nothing renderable. */
export function coerceArtifact(value: unknown): ArtifactLike | null {
  if (!value || typeof value !== 'object') return null;
  const components = (value as { components?: unknown }).components;
  if (!Array.isArray(components)) return null;
  const isNode = (n: unknown): n is ArtifactNodeLike =>
    !!n && typeof n === 'object' && typeof (n as { component?: unknown }).component === 'string';
  const nodes = components.filter(isNode).map((n) => ({
    ...n,
    children: Array.isArray(n.children) ? n.children.filter(isNode) : undefined,
  }));
  if (nodes.length === 0) return null;
  return { version: '1', components: nodes };
}

/** Most-used objectKey across the artifact's live nodes — where a saved
 *  dashboard most plausibly belongs. Null = workspace-level. */
export function dominantObjectKey(artifact: ArtifactLike | null): string | null {
  if (!artifact) return null;
  const counts = new Map<string, number>();
  const visit = (node: ArtifactNodeLike) => {
    const key = (node.props as { objectKey?: unknown } | undefined)?.objectKey;
    if (typeof key === 'string' && key.length > 0) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const child of node.children ?? []) visit(child);
  };
  for (const node of artifact.components) visit(node);
  let best: string | null = null;
  let bestCount = 0;
  for (const [key, count] of counts) {
    if (count > bestCount) {
      best = key;
      bestCount = count;
    }
  }
  return best;
}

/** Display title for a gallery card: the first PageHeader/Greeting-ish node's
 *  title/label prop. Null when no node carries one. */
export function artifactTitle(artifact: ArtifactLike | null): string | null {
  if (!artifact) return null;
  const fromNode = (node: ArtifactNodeLike): string | null => {
    const props = (node.props ?? {}) as { title?: unknown; label?: unknown };
    if (typeof props.title === 'string' && props.title.trim()) return props.title.trim();
    if (typeof props.label === 'string' && props.label.trim()) return props.label.trim();
    return null;
  };
  // PageHeader wins; otherwise the first node with a title/label at all.
  for (const node of artifact.components) {
    if (node.component === 'PageHeader') {
      const t = fromNode(node);
      if (t) return t;
    }
  }
  for (const node of artifact.components) {
    const t = fromNode(node);
    if (t) return t;
  }
  return null;
}

/** Top-level component count — the gallery card's one-glance size cue. */
export function artifactComponentCount(artifact: ArtifactLike | null): number {
  return artifact?.components.length ?? 0;
}
