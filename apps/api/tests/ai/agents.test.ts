// The agent-chat policy math and thread plumbing — every helper here is pure
// (no LLM, no DB): model resolution against the catalog, agent tool
// narrowing, role gating of agent lists, prior-thread → model-message
// mapping, and compose/patch chaining through the turn's artifact state.

import { AVAILABLE_AI_MODELS, type ArtifactLike, type EffectiveTool } from '@northbeam/core';
import type { AiSessionMessage } from '@northbeam/db';
import { describe, expect, it } from 'vitest';
import {
  agentVisibleToRole,
  createArtifactState,
  intersectTools,
  mapThreadToModelMessages,
  pickChatModel,
  resolveAgentModels,
} from '../../src/ai/chat-loop.js';

const DEFAULT = 'org-default-model';
const known = AVAILABLE_AI_MODELS.map((m) => m.id);
const knownA = known[0] as string;
const knownB = known[1] as string;

describe('resolveAgentModels', () => {
  it('empty list falls back to the org default', () => {
    expect(resolveAgentModels([], DEFAULT)).toEqual([DEFAULT]);
  });

  it('unknown ids are filtered out, order preserved', () => {
    expect(resolveAgentModels([knownB, 'made-up-model', knownA], DEFAULT)).toEqual([
      knownB,
      knownA,
    ]);
  });

  it('an entirely-unknown list falls back to the default (never empty)', () => {
    expect(resolveAgentModels(['nope', 'also-nope'], DEFAULT)).toEqual([DEFAULT]);
  });
});

describe('pickChatModel', () => {
  it('honors the request when the agent allows that model', () => {
    expect(pickChatModel([knownA, knownB], DEFAULT, knownB)).toBe(knownB);
  });

  it('falls back to the first resolved model when the request is not allowed', () => {
    expect(pickChatModel([knownA], DEFAULT, knownB)).toBe(knownA);
    expect(pickChatModel([knownA], DEFAULT, 'made-up-model')).toBe(knownA);
  });

  it('no request → the first resolved model; no models → the default', () => {
    expect(pickChatModel([knownB, knownA], DEFAULT)).toBe(knownB);
    expect(pickChatModel([], DEFAULT, null)).toBe(DEFAULT);
  });

  it('a request for the default works only when the agent list is empty', () => {
    expect(pickChatModel([], DEFAULT, DEFAULT)).toBe(DEFAULT);
    expect(pickChatModel([knownA], DEFAULT, DEFAULT)).toBe(knownA);
  });
});

describe('intersectTools', () => {
  const effective: EffectiveTool[] = [
    { id: 'search_records', title: 'Search', description: '', kind: 'read', autoApprove: true },
    { id: 'get_record', title: 'Get', description: '', kind: 'read', autoApprove: true },
  ];

  it('null allowlist means the agent does not narrow', () => {
    expect(intersectTools(effective, null)).toEqual(effective);
  });

  it('narrows to the agent subset', () => {
    expect(intersectTools(effective, ['get_record']).map((t) => t.id)).toEqual(['get_record']);
  });

  it('cannot GRANT a tool the caller lacks — only remove', () => {
    const out = intersectTools(effective, ['get_record', 'delete_record']);
    expect(out.map((t) => t.id)).toEqual(['get_record']);
  });

  it('an empty allowlist strips everything', () => {
    expect(intersectTools(effective, [])).toEqual([]);
  });
});

describe('agentVisibleToRole', () => {
  it('null roleKeys = visible to everyone', () => {
    expect(agentVisibleToRole(null, 'viewer', false)).toBe(true);
  });

  it('a listed role sees it; an unlisted one does not', () => {
    expect(agentVisibleToRole(['admin', 'member'], 'member', false)).toBe(true);
    expect(agentVisibleToRole(['admin'], 'member', false)).toBe(false);
  });

  it('owners see every agent regardless of roleKeys', () => {
    expect(agentVisibleToRole(['some-custom-role'], 'owner', true)).toBe(true);
  });
});

describe('mapThreadToModelMessages', () => {
  it('text turns pass through, including legacy rows without kind', () => {
    const thread: AiSessionMessage[] = [
      { role: 'user', content: 'show me deals' },
      { kind: 'text', role: 'assistant', content: 'here they are' },
    ];
    expect(mapThreadToModelMessages(thread)).toEqual([
      { role: 'user', content: 'show me deals' },
      { role: 'assistant', content: 'here they are' },
    ]);
  });

  it('blank text turns are dropped', () => {
    expect(mapThreadToModelMessages([{ kind: 'text', role: 'assistant', content: '   ' }])).toEqual(
      [],
    );
  });

  it('tool turns become short assistant markers with non-done status', () => {
    const thread: AiSessionMessage[] = [
      { kind: 'tool', toolId: 'search_records', title: 'Search records', status: 'done' },
      { kind: 'tool', toolId: 'delete_record', title: 'Delete a record', status: 'denied' },
    ];
    expect(mapThreadToModelMessages(thread)).toEqual([
      { role: 'assistant', content: '[ran tool search_records]' },
      { role: 'assistant', content: '[ran tool delete_record — denied]' },
    ]);
  });

  it('artifact turns summarize instead of replaying the tree', () => {
    const thread: AiSessionMessage[] = [
      { kind: 'artifact', note: '4 components' },
      { kind: 'artifact' },
    ];
    expect(mapThreadToModelMessages(thread)).toEqual([
      { role: 'assistant', content: '[composed dashboard: 4 components]' },
      { role: 'assistant', content: '[composed dashboard]' },
    ]);
  });
});

describe('createArtifactState — compose/patch chaining', () => {
  // Static components only: repairArtifact passes them through untouched even
  // with an empty metadata map, so these tests exercise CHAINING, not repair.
  const base: ArtifactLike = {
    version: '1',
    components: [
      { component: 'PageHeader', props: { title: 'Pipeline' } },
      { component: 'Text', props: { value: 'hello' } },
      { component: 'Divider', props: {} },
    ],
  };
  const opts = { objectFields: new Map(), mode: 'dashboard' as const };

  it('patching before anything exists is a no-op null', () => {
    const state = createArtifactState(opts);
    expect(state.applyPatch([{ op: 'remove', index: 0 }])).toBeNull();
    expect(state.repaired).toBeNull();
  });

  it('successive patches chain off the latest artifact, not the input', () => {
    const state = createArtifactState({ ...opts, initial: base });
    const first = state.applyPatch([{ op: 'remove', index: 2 }]);
    expect(first?.artifact.components.map((c) => c.component)).toEqual(['PageHeader', 'Text']);

    // Index 1 now targets Text (post-removal indexing) — proof we chained.
    const second = state.applyPatch([{ op: 'props', index: 1, props: { value: 'updated' } }]);
    expect(second?.artifact.components[1]?.props?.value).toBe('updated');
    expect(state.repaired?.components).toHaveLength(2);
  });

  it('applyGeneration with a full artifact replaces the base for later patches', () => {
    const state = createArtifactState({ ...opts, initial: base });
    const composed = state.applyGeneration({
      artifact: {
        version: '1',
        components: [{ component: 'Callout', props: { body: 'fresh' } }],
      },
    });
    expect(composed?.artifact.components.map((c) => c.component)).toEqual(['Callout']);

    const patched = state.applyPatch([
      { op: 'insert', index: 1, node: { component: 'Divider', props: {} } },
    ]);
    expect(patched?.artifact.components.map((c) => c.component)).toEqual(['Callout', 'Divider']);
  });

  it('a patch-mode generation applies against the current tree', () => {
    const state = createArtifactState({ ...opts, initial: base });
    const out = state.applyGeneration({ patch: [{ op: 'remove', index: 0 }] });
    expect(out?.artifact.components.map((c) => c.component)).toEqual(['Text', 'Divider']);
  });

  it('a note-only generation (no artifact, no patch) returns null and keeps state', () => {
    const state = createArtifactState({ ...opts, initial: base });
    expect(state.applyGeneration({})).toBeNull();
    expect(state.repaired).toBeNull();
    expect(state.current).toEqual(base);
  });

  it('stale patch ops surface as repair notes and accumulate', () => {
    const state = createArtifactState({ ...opts, initial: base });
    const out = state.applyPatch([{ op: 'remove', index: 9 }]);
    expect(out?.repairs).toEqual(['1 edit(s) referenced components that no longer exist']);
    expect(state.repairs).toEqual(['1 edit(s) referenced components that no longer exist']);
  });
});
