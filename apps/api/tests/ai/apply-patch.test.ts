// Patch application: sequential ops, index shifting on insert, tolerant
// skipping of stale indices, props merge with null-deletes, component cap.

import type { ArtifactLike } from '@northbeam/core';
import { describe, expect, it } from 'vitest';
import { applyArtifactPatch } from '../../src/ai/apply-patch.js';

const base: ArtifactLike = {
  version: '1',
  components: [
    { component: 'PageHeader', props: { title: 'Pipeline' } },
    { component: 'Metric', props: { label: 'Deals', objectKey: 'deal', fn: 'count' } },
    { component: 'Text', props: { value: 'hello' } },
  ],
};

describe('applyArtifactPatch', () => {
  it('set / remove / insert apply sequentially with index shifting', () => {
    const { artifact, applied, skipped } = applyArtifactPatch(base, [
      { op: 'remove', index: 2 },
      { op: 'insert', index: 1, node: { component: 'Divider', props: {} } },
      { op: 'set', index: 2, node: { component: 'Callout', props: { body: 'x' } } },
    ]);
    expect(applied).toBe(3);
    expect(skipped).toBe(0);
    expect(artifact.components.map((c) => c.component)).toEqual([
      'PageHeader',
      'Divider',
      'Callout',
    ]);
  });

  it('props merges shallowly and null deletes a key', () => {
    const { artifact } = applyArtifactPatch(base, [
      { op: 'props', index: 1, props: { label: 'Open deals', fn: null } },
    ]);
    expect(artifact.components[1]?.props).toEqual({
      label: 'Open deals',
      objectKey: 'deal',
    });
  });

  it('stale indices skip without killing the rest of the patch', () => {
    const { artifact, applied, skipped } = applyArtifactPatch(base, [
      { op: 'remove', index: 9 },
      { op: 'props', index: 0, props: { title: 'Renamed' } },
    ]);
    expect(applied).toBe(1);
    expect(skipped).toBe(1);
    expect(artifact.components[0]?.props?.title).toBe('Renamed');
  });

  it('insert respects the 20-component cap', () => {
    const full: ArtifactLike = {
      version: '1',
      components: Array.from({ length: 20 }, () => ({ component: 'Text', props: {} })),
    };
    const { skipped } = applyArtifactPatch(full, [
      { op: 'insert', index: 0, node: { component: 'Divider', props: {} } },
    ]);
    expect(skipped).toBe(1);
  });

  it('does not mutate the input artifact', () => {
    applyArtifactPatch(base, [{ op: 'props', index: 0, props: { title: 'Changed' } }]);
    expect(base.components[0]?.props?.title).toBe('Pipeline');
  });
});
