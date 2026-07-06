// Fixture matrix for the pure walker: linear advancement, decision routing,
// loop enter/iterate/exit with iteration + nesting caps, wait-cursor resume,
// step budget, and hostile-graph guards. Graph fixtures go through
// FlowGraphSchema.parse so a contract change breaks these loudly.

import { FLOW_LIMITS, type FlowGraph, FlowGraphSchema } from '@northbeam/core';
import { describe, expect, it } from 'vitest';
import {
  type WalkState,
  type WalkStep,
  activeLoopFrame,
  advance,
  initialWalkState,
  triggerNodeOf,
} from '../../src/automation/walker.js';

/* ── fixtures ───────────────────────────────────────────────────────────── */

const trigger = { id: 't', type: 'trigger_record', config: { event: 'created' } };
const assign = (id: string) => ({
  id,
  type: 'assignment',
  config: { assignments: [{ target: { scope: 'vars', name: 'x' }, value: 1 }] },
});
const wait = (id: string) => ({
  id,
  type: 'wait',
  config: { kind: 'duration', amount: 5, unit: 'minutes' },
});
const loop = (id: string, sourceVar = 'items') => ({ id, type: 'loop', config: { sourceVar } });
const decision = (id: string, outcomes: string[]) => ({
  id,
  type: 'decision',
  config: {
    outcomes: outcomes.map((o) => ({
      id: o,
      label: o,
      condition: { mode: 'formula', formula: 'TRUE' },
    })),
  },
});
const edge = (source: string, target: string, sourceHandle?: string) => ({
  id: `${source}->${target}${sourceHandle ? `#${sourceHandle}` : ''}`,
  source,
  target,
  ...(sourceHandle ? { sourceHandle } : {}),
});
const graph = (nodes: unknown[], edges: unknown[]): FlowGraph =>
  FlowGraphSchema.parse({ nodes, edges });

const nextOf = (step: WalkStep): { nodeId: string; state: WalkState } => {
  if (step.kind !== 'next') throw new Error(`expected next, got ${JSON.stringify(step)}`);
  return step;
};

/* ── linear ─────────────────────────────────────────────────────────────── */

describe('linear advancement', () => {
  const g = graph([trigger, assign('a1'), assign('a2')], [edge('t', 'a1'), edge('a1', 'a2')]);

  it('finds the trigger', () => {
    expect(triggerNodeOf(g)?.id).toBe('t');
  });

  it('walks trigger → a1 → a2 → done, counting steps', () => {
    const s1 = nextOf(advance(g, initialWalkState(), 't', { kind: 'linear' }));
    expect(s1.nodeId).toBe('a1');
    expect(s1.state.stepCount).toBe(1);
    const s2 = nextOf(advance(g, s1.state, 'a1', { kind: 'linear' }));
    expect(s2.nodeId).toBe('a2');
    const end = advance(g, s2.state, 'a2', { kind: 'linear' });
    expect(end).toEqual({ kind: 'done', state: { loopFrames: [], stepCount: 3 } });
  });

  it('never mutates the input state', () => {
    const state = initialWalkState();
    advance(g, state, 't', { kind: 'linear' });
    expect(state).toEqual({ loopFrames: [], stepCount: 0 });
  });

  it('rejects unknown nodes and kind mismatches', () => {
    expect(advance(g, initialWalkState(), 'nope', { kind: 'linear' }).kind).toBe('error');
    expect(advance(g, initialWalkState(), 'a1', { kind: 'decision', outcomeId: null }).kind).toBe(
      'error',
    );
    expect(advance(g, initialWalkState(), 'a1', { kind: 'loop', itemCount: 1 }).kind).toBe('error');
  });

  it('errors on a linear node with two outgoing edges (invalid graph)', () => {
    const bad = graph(
      [trigger, assign('a1'), assign('a2'), assign('a3')],
      [edge('t', 'a1'), edge('a1', 'a2'), edge('a1', 'a3')],
    );
    const step = advance(bad, initialWalkState(), 'a1', { kind: 'linear' });
    expect(step.kind).toBe('error');
  });
});

describe('wait-cursor resume', () => {
  it('a resumed wait advances like any linear node', () => {
    const g = graph([trigger, wait('w'), assign('a1')], [edge('t', 'w'), edge('w', 'a1')]);
    // Resume path: the engine claims the parked run at cursorNodeId 'w' and
    // asks for the node after it.
    const resumed: WalkState = { loopFrames: [], stepCount: 2 };
    const step = nextOf(advance(g, resumed, 'w', { kind: 'linear' }));
    expect(step.nodeId).toBe('a1');
    expect(step.state.stepCount).toBe(3);
  });
});

/* ── decisions ──────────────────────────────────────────────────────────── */

describe('decision routing', () => {
  const g = graph(
    [trigger, decision('d', ['big', 'small']), assign('a1'), assign('a2'), assign('a3')],
    [edge('t', 'd'), edge('d', 'a1', 'big'), edge('d', 'a2', 'small'), edge('d', 'a3', 'default')],
  );

  it('follows the chosen outcome edge', () => {
    expect(
      nextOf(advance(g, initialWalkState(), 'd', { kind: 'decision', outcomeId: 'big' })).nodeId,
    ).toBe('a1');
    expect(
      nextOf(advance(g, initialWalkState(), 'd', { kind: 'decision', outcomeId: 'small' })).nodeId,
    ).toBe('a2');
  });

  it('null outcome takes the default edge', () => {
    expect(
      nextOf(advance(g, initialWalkState(), 'd', { kind: 'decision', outcomeId: null })).nodeId,
    ).toBe('a3');
  });

  it('null outcome with no default edge ends the run', () => {
    const noDefault = graph(
      [trigger, decision('d', ['big']), assign('a1')],
      [edge('t', 'd'), edge('d', 'a1', 'big')],
    );
    expect(
      advance(noDefault, initialWalkState(), 'd', { kind: 'decision', outcomeId: null }).kind,
    ).toBe('done');
  });

  it('rejects an outcome id the node does not declare', () => {
    const step = advance(g, initialWalkState(), 'd', { kind: 'decision', outcomeId: 'huge' });
    expect(step.kind).toBe('error');
  });

  it('errors when a declared outcome has no edge (invalid graph)', () => {
    const missing = graph(
      [trigger, decision('d', ['big', 'small']), assign('a1')],
      [edge('t', 'd'), edge('d', 'a1', 'big')],
    );
    const step = advance(missing, initialWalkState(), 'd', {
      kind: 'decision',
      outcomeId: 'small',
    });
    expect(step.kind).toBe('error');
  });
});

/* ── loops ──────────────────────────────────────────────────────────────── */

// t → l ⇄ b, l →done→ after
const loopGraph = graph(
  [trigger, loop('l'), assign('b'), assign('after')],
  [edge('t', 'l'), edge('l', 'b', 'body'), edge('b', 'l'), edge('l', 'after', 'done')],
);

describe('loop frames', () => {
  it('enters the body and pushes a frame with the sourceVar snapshot', () => {
    const step = nextOf(
      advance(loopGraph, initialWalkState(), 'l', { kind: 'loop', itemCount: 3 }),
    );
    expect(step.nodeId).toBe('b');
    expect(activeLoopFrame(step.state)).toEqual({
      loopNodeId: 'l',
      sourceVar: 'items',
      index: 0,
      total: 3,
    });
  });

  it('iterates on back-edge return using the frame total, not the new itemCount', () => {
    const enter = nextOf(
      advance(loopGraph, initialWalkState(), 'l', { kind: 'loop', itemCount: 2 }),
    );
    // Mutating the collection mid-loop must not extend the iteration.
    const iter = nextOf(advance(loopGraph, enter.state, 'l', { kind: 'loop', itemCount: 999 }));
    expect(iter.nodeId).toBe('b');
    expect(activeLoopFrame(iter.state)?.index).toBe(1);
    const exit = nextOf(advance(loopGraph, iter.state, 'l', { kind: 'loop', itemCount: 999 }));
    expect(exit.nodeId).toBe('after');
    expect(exit.state.loopFrames).toEqual([]);
  });

  it('an empty collection skips straight to done with no frame', () => {
    const step = nextOf(
      advance(loopGraph, initialWalkState(), 'l', { kind: 'loop', itemCount: 0 }),
    );
    expect(step.nodeId).toBe('after');
    expect(step.state.loopFrames).toEqual([]);
  });

  it('caps entry at maxLoopIterations', () => {
    const step = advance(loopGraph, initialWalkState(), 'l', {
      kind: 'loop',
      itemCount: FLOW_LIMITS.maxLoopIterations + 1,
    });
    expect(step.kind).toBe('error');
    if (step.kind === 'error') expect(step.message).toContain('iteration');
  });

  it('runs a full 3-item loop end to end', () => {
    let state = initialWalkState();
    const visits: string[] = [];
    let at = 'l';
    for (let guard = 0; guard < 20; guard++) {
      const step = advance(
        loopGraph,
        state,
        at,
        at === 'l' ? { kind: 'loop', itemCount: 3 } : { kind: 'linear' },
      );
      if (step.kind !== 'next') throw new Error('unexpected terminal');
      visits.push(step.nodeId);
      state = step.state;
      at = step.nodeId;
      if (step.nodeId === 'after') break;
    }
    expect(visits).toEqual(['b', 'l', 'b', 'l', 'b', 'l', 'after']);
  });
});

describe('loop nesting + corruption guards', () => {
  const nested = graph(
    [trigger, loop('l1', 'outer'), loop('l2', 'inner'), loop('l3', 'deepest'), assign('b')],
    [
      edge('t', 'l1'),
      edge('l1', 'l2', 'body'),
      edge('l1', 'b', 'done'),
      edge('l2', 'l3', 'body'),
      edge('l2', 'l1', 'done'),
      edge('l3', 'b', 'body'),
      edge('l3', 'l2', 'done'),
      edge('b', 'l3'),
    ],
  );

  it('allows two live frames, rejects the third with the nesting message', () => {
    const one = nextOf(advance(nested, initialWalkState(), 'l1', { kind: 'loop', itemCount: 2 }));
    const two = nextOf(advance(nested, one.state, 'l2', { kind: 'loop', itemCount: 2 }));
    expect(two.state.loopFrames).toHaveLength(2);
    const three = advance(nested, two.state, 'l3', { kind: 'loop', itemCount: 2 });
    expect(three.kind).toBe('error');
    if (three.kind === 'error') expect(three.message).toContain('nest 2 deep');
  });

  it('rejects re-entering an outer loop while an inner frame is live', () => {
    const one = nextOf(advance(nested, initialWalkState(), 'l1', { kind: 'loop', itemCount: 2 }));
    const two = nextOf(advance(nested, one.state, 'l2', { kind: 'loop', itemCount: 2 }));
    const jump = advance(nested, two.state, 'l1', { kind: 'loop', itemCount: 2 });
    expect(jump.kind).toBe('error');
  });
});

/* ── budgets ────────────────────────────────────────────────────────────── */

describe('step budget', () => {
  it('errors once the run would exceed maxSteps', () => {
    const g = graph([trigger, assign('a1')], [edge('t', 'a1')]);
    const exhausted: WalkState = { loopFrames: [], stepCount: FLOW_LIMITS.maxSteps };
    const step = advance(g, exhausted, 't', { kind: 'linear' });
    expect(step.kind).toBe('error');
    if (step.kind === 'error') expect(step.message).toContain('step budget');
    // One below the ceiling still advances.
    const last: WalkState = { loopFrames: [], stepCount: FLOW_LIMITS.maxSteps - 1 };
    expect(advance(g, last, 't', { kind: 'linear' }).kind).toBe('next');
  });
});
