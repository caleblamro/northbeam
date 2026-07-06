// Engine dry-run traces — pure. Every graph here uses only nodes whose
// dry-run path is db-free (assignment, decision, wait, send_email,
// webhook_out, create_record with simulated writes), and the injected `tx`
// throws, proving no executor sneaks a read past the fixture.

import type { FlowGraph } from '@northbeam/core';
import type { DbExecutor } from '@northbeam/db';
import { describe, expect, it } from 'vitest';
import { dryRunGraph } from '../../src/automation/engine.js';

const NOW = new Date('2026-07-01T12:00:00.000Z');

const noDb = async <T>(_fn: (tx: DbExecutor) => Promise<T>): Promise<T> => {
  throw new Error('dry-run fixture must not touch the db');
};

const flow = { id: 'flow-1', name: 'Test flow', objectId: 'obj-1' };

function baseOptions(graph: FlowGraph, context: Record<string, unknown>) {
  return {
    orgId: 'org-1',
    flow,
    graph,
    context,
    tx: noDb,
    user: { id: 'user-1', email: 'a@b.co' },
    fields: [
      { key: 'name', type: 'text' },
      { key: 'amount', type: 'currency' },
      { key: 'stage', type: 'picklist' },
    ],
    now: () => NOW,
  };
}

const decisionGraph: FlowGraph = {
  nodes: [
    { id: 't', type: 'trigger_record', config: { event: 'created_or_updated' } },
    {
      id: 'a1',
      type: 'assignment',
      config: {
        assignments: [{ target: { scope: 'vars', name: 'greeting' }, value: 'Hi {{record.name}}' }],
      },
    },
    {
      id: 'd1',
      type: 'decision',
      config: {
        outcomes: [
          {
            id: 'big',
            label: 'Big deal',
            condition: {
              mode: 'filters',
              logic: 'and',
              filters: [{ fieldKey: 'amount', op: 'gt', value: 100 }],
            },
          },
        ],
      },
    },
    {
      id: 'email_big',
      type: 'send_email',
      config: { to: ['{{user.email}}'], subject: 'Big: {{vars.greeting}}', body: 'B' },
    },
    {
      id: 'email_small',
      type: 'send_email',
      config: { to: ['a@b.co'], subject: 'Small', body: 'S' },
    },
  ],
  edges: [
    { id: 'e1', source: 't', target: 'a1' },
    { id: 'e2', source: 'a1', target: 'd1' },
    { id: 'e3', source: 'd1', target: 'email_big', sourceHandle: 'big' },
    { id: 'e4', source: 'd1', target: 'email_small', sourceHandle: 'default' },
  ],
};

describe('dryRunGraph — linear + decision routing', () => {
  it('takes the first truthy outcome and records the ordered trace', async () => {
    const result = await dryRunGraph(
      baseOptions(decisionGraph, { record: { name: 'Acme', amount: 250 }, vars: {} }),
    );
    expect(result.status).toBe('completed');
    expect(result.steps.map((s) => s.nodeId)).toEqual(['t', 'a1', 'd1', 'email_big']);
    expect(result.steps.map((s) => s.status)).toEqual([
      'completed',
      'completed',
      'completed',
      'completed',
    ]);
    expect(result.steps[2]?.summary).toMatchObject({ outcome: 'big' });
    // assignment interpolated through the record scope
    expect(result.vars.greeting).toBe('Hi Acme');
    // side effects simulated, with the interpolated payload in the summary
    expect(result.steps[3]?.summary).toMatchObject({
      simulated: true,
      to: ['a@b.co'],
      subject: 'Big: Hi Acme',
    });
  });

  it('falls through to the default edge when no outcome matches', async () => {
    const result = await dryRunGraph(
      baseOptions(decisionGraph, { record: { name: 'Acme', amount: 50 }, vars: {} }),
    );
    expect(result.status).toBe('completed');
    expect(result.steps.map((s) => s.nodeId)).toEqual(['t', 'a1', 'd1', 'email_small']);
    expect(result.steps[2]?.summary).toMatchObject({ outcome: 'default' });
  });
});

const loopGraph: FlowGraph = {
  nodes: [
    { id: 't', type: 'trigger_record', config: { event: 'created' } },
    { id: 'l', type: 'loop', config: { sourceVar: 'items' } },
    {
      id: 'body',
      type: 'assignment',
      config: {
        assignments: [{ target: { scope: 'vars', name: 'last' }, value: '{{loopItem.name}}' }],
      },
    },
    {
      id: 'after',
      type: 'assignment',
      config: { assignments: [{ target: { scope: 'vars', name: 'done' }, value: true }] },
    },
  ],
  edges: [
    { id: 'e1', source: 't', target: 'l' },
    { id: 'e2', source: 'l', target: 'body', sourceHandle: 'body' },
    { id: 'e3', source: 'body', target: 'l' }, // back-edge
    { id: 'e4', source: 'l', target: 'after', sourceHandle: 'done' },
  ],
};

describe('dryRunGraph — loops', () => {
  it('iterates the body once per item, tracing the loop entry once', async () => {
    const result = await dryRunGraph(
      baseOptions(loopGraph, {
        record: {},
        vars: { items: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] },
      }),
    );
    expect(result.status).toBe('completed');
    expect(result.steps.map((s) => s.nodeId)).toEqual(['t', 'l', 'body', 'body', 'body', 'after']);
    const loopSteps = result.steps.filter((s) => s.nodeId === 'l');
    expect(loopSteps).toHaveLength(1);
    expect(loopSteps[0]?.summary).toMatchObject({ items: 3, sourceVar: 'items' });
    expect(result.vars.last).toBe('c'); // loopItem advanced through all items
    expect(result.vars.done).toBe(true);
  });

  it('takes the done edge immediately for an empty collection', async () => {
    const result = await dryRunGraph(baseOptions(loopGraph, { record: {}, vars: { items: [] } }));
    expect(result.status).toBe('completed');
    expect(result.steps.map((s) => s.nodeId)).toEqual(['t', 'l', 'after']);
    expect(result.vars.last).toBeUndefined();
  });
});

const waitGraph: FlowGraph = {
  nodes: [
    { id: 't', type: 'trigger_record', config: { event: 'updated' } },
    { id: 'w', type: 'wait', config: { kind: 'duration', amount: 60, unit: 'minutes' } },
    {
      id: 'after',
      type: 'create_record',
      config: {
        objectKey: 'deal',
        fields: { name: 'Follow-up for {{record.name}}' },
        assignTo: 'created',
      },
    },
  ],
  edges: [
    { id: 'e1', source: 't', target: 'w' },
    { id: 'e2', source: 'w', target: 'after' },
  ],
};

describe('dryRunGraph — waits short-circuit, writes simulate', () => {
  it('records the simulated wake-up and continues past the wait', async () => {
    const result = await dryRunGraph(
      baseOptions(waitGraph, { record: { name: 'Acme' }, vars: {} }),
    );
    expect(result.status).toBe('completed');
    expect(result.steps.map((s) => s.nodeId)).toEqual(['t', 'w', 'after']);
    expect(result.steps[1]?.summary).toMatchObject({
      simulated: true,
      kind: 'duration',
      wouldResumeAt: new Date(NOW.getTime() + 60 * 60_000).toISOString(),
    });
    // create_record simulated: no db touched, var seeded for downstream refs
    expect(result.steps[2]?.summary).toMatchObject({ simulated: true, objectKey: 'deal' });
    expect(result.vars.created).toMatchObject({
      id: 'dry-run',
      objectKey: 'deal',
      name: 'Follow-up for Acme',
    });
  });
});

describe('dryRunGraph — failures', () => {
  it('fails the run at a webhook whose url interpolates to non-https', async () => {
    const graph: FlowGraph = {
      nodes: [
        { id: 't', type: 'trigger_record', config: { event: 'created' } },
        {
          id: 'hook',
          type: 'webhook_out',
          config: { url: '{{vars.target}}', method: 'POST', body: '{}' },
        },
      ],
      edges: [{ id: 'e1', source: 't', target: 'hook' }],
    };
    const result = await dryRunGraph(
      baseOptions(graph, { record: {}, vars: { target: 'http://internal.example/' } }),
    );
    expect(result.status).toBe('failed');
    expect(result.errorNodeId).toBe('hook');
    expect(result.error).toMatch(/https/);
    const hookStep = result.steps.find((s) => s.nodeId === 'hook');
    expect(hookStep?.status).toBe('failed');
    // partial trace preserved: trigger step still present before the failure
    expect(result.steps[0]?.nodeId).toBe('t');
  });

  it('fails cleanly on a graph with no trigger', async () => {
    const graph = {
      nodes: [
        {
          id: 'a',
          type: 'assignment',
          config: { assignments: [{ target: { scope: 'vars', name: 'x' }, value: 1 }] },
        },
      ],
      edges: [],
    } as unknown as FlowGraph;
    const result = await dryRunGraph(baseOptions(graph, { vars: {} }));
    expect(result.status).toBe('failed');
    expect(result.error).toMatch(/no trigger/);
    expect(result.steps).toEqual([]);
  });
});
