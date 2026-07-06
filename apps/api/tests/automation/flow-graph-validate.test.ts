// validateFlowGraph accept/reject matrix — the pure structural rules shared
// by the canvas mirror and the server's activate gate: single trigger, edge
// resolution, decision/loop exit rules, back-edge-only cycles, reachability,
// nesting caps, and the wait relative_to_field shape checks.

import { type FlowEdge, type FlowNode, validateFlowGraph } from '@northbeam/core';
import { describe, expect, it } from 'vitest';

const trigger = (id = 't', event: 'created' | 'updated' | 'deleted' = 'created'): FlowNode => ({
  id,
  type: 'trigger_record',
  config: { event },
});

const assign = (id: string): FlowNode => ({
  id,
  type: 'assignment',
  config: { assignments: [{ target: { scope: 'vars', name: 'x' }, value: 1 }] },
});

const getRecords = (id: string, assignTo: string): FlowNode => ({
  id,
  type: 'get_records',
  config: { objectKey: 'deal', limit: 10, assignTo },
});

const loop = (id: string, sourceVar: string): FlowNode => ({
  id,
  type: 'loop',
  config: { sourceVar },
});

const decision = (id: string, outcomeIds: string[]): FlowNode => ({
  id,
  type: 'decision',
  config: {
    outcomes: outcomeIds.map((oid) => ({
      id: oid,
      label: oid,
      condition: { mode: 'formula' as const, formula: 'true' },
    })),
  },
});

const edge = (id: string, source: string, target: string, sourceHandle?: string): FlowEdge => ({
  id,
  source,
  target,
  ...(sourceHandle === undefined ? {} : { sourceHandle }),
});

describe('validateFlowGraph — accepts', () => {
  it('a linear trigger → step flow with no issues', () => {
    const result = validateFlowGraph({
      nodes: [trigger(), assign('a')],
      edges: [edge('e1', 't', 'a')],
    });
    expect(result).toEqual({ ok: true, issues: [] });
  });

  it('a decision with all outcomes + default wired', () => {
    const result = validateFlowGraph({
      nodes: [trigger(), decision('d', ['won']), assign('a'), assign('b')],
      edges: [edge('e1', 't', 'd'), edge('e2', 'd', 'a', 'won'), edge('e3', 'd', 'b', 'default')],
    });
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('a loop whose back-edge is the only cycle', () => {
    const result = validateFlowGraph({
      nodes: [trigger(), getRecords('g', 'deals'), loop('l', 'deals'), assign('a'), assign('z')],
      edges: [
        edge('e1', 't', 'g'),
        edge('e2', 'g', 'l'),
        edge('e3', 'l', 'a', 'body'),
        edge('e4', 'a', 'l'),
        edge('e5', 'l', 'z', 'done'),
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });
});

describe('validateFlowGraph — rejects', () => {
  it('no trigger', () => {
    const result = validateFlowGraph({ nodes: [assign('a')], edges: [] });
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual({
      nodeId: undefined,
      message: 'flow has no trigger node',
      severity: 'error',
    });
  });

  it('two triggers — the extra one is flagged', () => {
    const result = validateFlowGraph({
      nodes: [trigger('t1'), trigger('t2'), assign('a')],
      edges: [edge('e1', 't1', 'a')],
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.nodeId === 't2' && i.severity === 'error')).toBe(true);
  });

  it('dangling edges (unknown source or target)', () => {
    const result = validateFlowGraph({
      nodes: [trigger(), assign('a')],
      edges: [edge('e1', 't', 'ghost'), edge('e2', 'ghost', 'a')],
    });
    expect(result.ok).toBe(false);
    expect(result.issues.filter((i) => i.severity === 'error').length).toBeGreaterThanOrEqual(2);
  });

  it('edges into the trigger', () => {
    const result = validateFlowGraph({
      nodes: [trigger(), assign('a')],
      edges: [edge('e1', 't', 'a'), edge('e2', 'a', 't')],
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes('triggers have no inputs'))).toBe(true);
  });

  it('decision outcome with no edge (orphan outcome)', () => {
    const result = validateFlowGraph({
      nodes: [trigger(), decision('d', ['won', 'lost']), assign('a')],
      edges: [edge('e1', 't', 'd'), edge('e2', 'd', 'a', 'won')],
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.nodeId === 'd' && i.message.includes("'lost'"))).toBe(true);
  });

  it('decision edge with an unknown outcome handle or no handle', () => {
    const noHandle = validateFlowGraph({
      nodes: [trigger(), decision('d', ['won']), assign('a'), assign('b')],
      edges: [edge('e1', 't', 'd'), edge('e2', 'd', 'a', 'won'), edge('e3', 'd', 'b')],
    });
    expect(noHandle.ok).toBe(false);
    const unknownHandle = validateFlowGraph({
      nodes: [trigger(), decision('d', ['won']), assign('a'), assign('b')],
      edges: [edge('e1', 't', 'd'), edge('e2', 'd', 'a', 'won'), edge('e3', 'd', 'b', 'ghost')],
    });
    expect(unknownHandle.ok).toBe(false);
  });

  it('missing default edge is a warning, not an error', () => {
    const result = validateFlowGraph({
      nodes: [trigger(), decision('d', ['won']), assign('a')],
      edges: [edge('e1', 't', 'd'), edge('e2', 'd', 'a', 'won')],
    });
    expect(result.ok).toBe(true);
    expect(result.issues).toContainEqual({
      nodeId: 'd',
      message: 'decision has no default edge; unmatched runs end here',
      severity: 'warning',
    });
  });

  it('loop with a missing back-edge', () => {
    const result = validateFlowGraph({
      nodes: [trigger(), getRecords('g', 'deals'), loop('l', 'deals'), assign('a'), assign('z')],
      edges: [
        edge('e1', 't', 'g'),
        edge('e2', 'g', 'l'),
        edge('e3', 'l', 'a', 'body'),
        edge('e5', 'l', 'z', 'done'),
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.nodeId === 'l' && i.message.includes('never returns'))).toBe(
      true,
    );
  });

  it('loop missing body/done edges', () => {
    const result = validateFlowGraph({
      nodes: [trigger(), loop('l', 'deals')],
      edges: [edge('e1', 't', 'l')],
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes("'body'"))).toBe(true);
    expect(result.issues.some((i) => i.message.includes("'done'"))).toBe(true);
  });

  it('illegal cycle between non-loop nodes', () => {
    const result = validateFlowGraph({
      nodes: [trigger(), assign('a'), assign('b')],
      edges: [edge('e1', 't', 'a'), edge('e2', 'a', 'b'), edge('e3', 'b', 'a')],
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes('cycle detected'))).toBe(true);
  });

  it('more than one outgoing edge from a single-exit node', () => {
    const result = validateFlowGraph({
      nodes: [trigger(), assign('a'), assign('b'), assign('c')],
      edges: [edge('e1', 't', 'a'), edge('e2', 'a', 'b'), edge('e3', 'a', 'c')],
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes('one outgoing edge'))).toBe(true);
  });

  it('unreachable node', () => {
    const result = validateFlowGraph({
      nodes: [trigger(), assign('a'), assign('orphan')],
      edges: [edge('e1', 't', 'a')],
    });
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual({
      nodeId: 'orphan',
      message: 'node is not reachable from the trigger',
      severity: 'error',
    });
  });

  it('loop nesting deeper than 2', () => {
    // l1 ⊃ l2 ⊃ l3 — l3 sits at depth 3.
    const result = validateFlowGraph({
      nodes: [
        trigger(),
        getRecords('g', 'deals'),
        loop('l1', 'deals'),
        loop('l2', 'deals'),
        loop('l3', 'deals'),
        assign('a3'),
        assign('z'),
      ],
      edges: [
        edge('e1', 't', 'g'),
        edge('e2', 'g', 'l1'),
        edge('e3', 'l1', 'l2', 'body'),
        edge('e4', 'l2', 'l3', 'body'),
        edge('e5', 'l3', 'a3', 'body'),
        edge('e6', 'a3', 'l3'),
        edge('e7', 'l3', 'l2', 'done'),
        edge('e8', 'l2', 'l1', 'done'),
        edge('e9', 'l1', 'z', 'done'),
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.nodeId === 'l3' && i.message.includes('nest 2 deep'))).toBe(
      true,
    );
  });

  it('nesting of exactly 2 is allowed', () => {
    const result = validateFlowGraph({
      nodes: [
        trigger(),
        getRecords('g', 'deals'),
        loop('l1', 'deals'),
        loop('l2', 'deals'),
        assign('a2'),
        assign('z'),
      ],
      edges: [
        edge('e1', 't', 'g'),
        edge('e2', 'g', 'l1'),
        edge('e3', 'l1', 'l2', 'body'),
        edge('e4', 'l2', 'a2', 'body'),
        edge('e5', 'a2', 'l2'),
        edge('e6', 'l2', 'l1', 'done'),
        edge('e7', 'l1', 'z', 'done'),
      ],
    });
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });
});

describe('validateFlowGraph — wait relative_to_field shape checks', () => {
  const waitRelative = (id: string): FlowNode => ({
    id,
    type: 'wait',
    config: { kind: 'relative_to_field', fieldKey: 'close_date', offset: -1, unit: 'days' },
  });

  it('requires a record trigger', () => {
    const result = validateFlowGraph({
      nodes: [{ id: 't', type: 'trigger_webhook', config: {} }, waitRelative('w'), assign('a')],
      edges: [edge('e1', 't', 'w'), edge('e2', 'w', 'a')],
    });
    expect(result.ok).toBe(false);
    expect(
      result.issues.some((i) => i.nodeId === 'w' && i.message.includes('record trigger')),
    ).toBe(true);
  });

  it('rejects delete triggers (the record is gone at fire time)', () => {
    const result = validateFlowGraph({
      nodes: [trigger('t', 'deleted'), waitRelative('w')],
      edges: [edge('e1', 't', 'w')],
    });
    expect(result.ok).toBe(false);
    expect(
      result.issues.some((i) => i.nodeId === 'w' && i.message.includes('delete trigger')),
    ).toBe(true);
  });

  it('accepts a record update trigger', () => {
    const result = validateFlowGraph({
      nodes: [trigger('t', 'updated'), waitRelative('w')],
      edges: [edge('e1', 't', 'w')],
    });
    expect(result.ok).toBe(true);
  });
});
