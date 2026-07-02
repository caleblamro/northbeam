// Pure edit helpers for dashboard-view artifact configs. A dashboard view's
// `config.artifact` holds the { version, components } tree rendered by
// views/artifact-walker.tsx — pin-to-dashboard appends nodes here.

import type { ArtifactNode } from '@/components/northbeam/views/artifact-walker';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Append `node` to `config.artifact.components`, returning a NEW config —
 *  the input is never mutated. Missing/malformed artifact slots are healed to
 *  `{ version: '1', components: [] }` first. Nodes without an explicit
 *  `props.span` land at span 6 (half of the walker's 12-column grid) so a
 *  pinned chart reads as a tile, not a full-width band. */
export function appendArtifactNode(config: unknown, node: ArtifactNode): Record<string, unknown> {
  const cfg = asRecord(config);
  const artifact = asRecord(cfg.artifact);
  const components = Array.isArray(artifact.components)
    ? (artifact.components as ArtifactNode[])
    : [];
  const withSpan: ArtifactNode = { ...node, props: { span: 6, ...(node.props ?? {}) } };
  return {
    ...cfg,
    artifact: { version: '1', ...artifact, components: [...components, withSpan] },
  };
}
