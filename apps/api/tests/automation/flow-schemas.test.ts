// Accept/reject matrix for the flow contract in @northbeam/core (flow.ts):
// per-node config schemas, the trigger union, edges + graph caps, and the
// FLOW_FILTER_OPS ⇄ @northbeam/db FilterOp sync pin.

import {
  FLOW_FILTER_OPS,
  FLOW_LIMITS,
  FLOW_NODE_TYPES,
  FlowConditionSchema,
  FlowEdgeSchema,
  FlowGraphSchema,
  FlowNodeSchema,
  FlowTriggerSchema,
} from '@northbeam/core';
import type { FilterOp } from '@northbeam/db';
import { describe, expect, it } from 'vitest';

type FlowOp = (typeof FLOW_FILTER_OPS)[number];
type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
// Compile-time sync pin — `pnpm typecheck` fails if FLOW_FILTER_OPS and the db
// FilterOp union drift in EITHER direction (op added or removed on one side).
const opsInSync: MutuallyAssignable<FlowOp, FilterOp> = true;

describe('FLOW_FILTER_OPS ⇄ @northbeam/db FilterOp', () => {
  it('mirrors FilterOp verbatim (compile-time pin) with no duplicates', () => {
    expect(opsInSync).toBe(true);
    expect(new Set(FLOW_FILTER_OPS).size).toBe(FLOW_FILTER_OPS.length);
  });
});

describe('FLOW_LIMITS', () => {
  it('pins the locked budget values', () => {
    expect(FLOW_LIMITS).toMatchObject({
      maxNodes: 100,
      maxEdges: 200,
      maxSteps: 500,
      maxLoopIterations: 200,
      maxLoopNesting: 2,
      maxDepth: 5,
      maxGetRecords: 200,
      maxScheduledFanout: 1000,
    });
  });
});

const node = (type: string, config: unknown, id = 'n1') => ({ id, type, config });
const accepts = (n: unknown) => {
  const parsed = FlowNodeSchema.safeParse(n);
  expect(parsed.error?.message ?? '').toBe('');
  expect(parsed.success).toBe(true);
};
const rejects = (n: unknown) => expect(FlowNodeSchema.safeParse(n).success).toBe(false);

const filtersCondition = {
  mode: 'filters',
  logic: 'and',
  filters: [{ fieldKey: 'stage', op: 'eq', value: 'closed_won' }],
} as const;

describe('FlowConditionSchema', () => {
  it('accepts filters mode and formula mode', () => {
    expect(FlowConditionSchema.safeParse(filtersCondition).success).toBe(true);
    expect(
      FlowConditionSchema.safeParse({ mode: 'formula', formula: 'amount > 100' }).success,
    ).toBe(true);
  });

  it('rejects empty filters, >10 filters, unknown ops, and empty formulas', () => {
    expect(
      FlowConditionSchema.safeParse({ mode: 'filters', logic: 'and', filters: [] }).success,
    ).toBe(false);
    const eleven = Array.from({ length: 11 }, () => ({ fieldKey: 'a', op: 'isSet' }));
    expect(
      FlowConditionSchema.safeParse({ mode: 'filters', logic: 'or', filters: eleven }).success,
    ).toBe(false);
    expect(
      FlowConditionSchema.safeParse({
        mode: 'filters',
        logic: 'and',
        filters: [{ fieldKey: 'a', op: 'like' }],
      }).success,
    ).toBe(false);
    expect(FlowConditionSchema.safeParse({ mode: 'formula', formula: '' }).success).toBe(false);
  });
});

describe('FlowNodeSchema per node type', () => {
  it('covers all 18 node types', () => {
    expect(FLOW_NODE_TYPES).toHaveLength(18);
  });

  it('trigger_record', () => {
    accepts(
      node('trigger_record', {
        event: 'updated',
        watchedFieldKeys: ['stage'],
        entryCondition: filtersCondition,
      }),
    );
    rejects(node('trigger_record', { event: 'upserted' }));
    rejects(node('trigger_record', {}));
  });

  it('trigger_scheduled', () => {
    accepts(
      node('trigger_scheduled', {
        schedule: { frequency: 'daily', time: '09:30' },
        timezone: 'America/Los_Angeles',
      }),
    );
    accepts(
      node('trigger_scheduled', {
        schedule: { frequency: 'once', at: '2026-08-01T09:00:00Z' },
        timezone: 'UTC',
      }),
    );
    accepts(
      node('trigger_scheduled', {
        schedule: { frequency: 'weekly', weekday: 1, time: '08:00' },
        timezone: 'UTC',
      }),
    );
    accepts(
      node('trigger_scheduled', {
        schedule: { frequency: 'cron', expression: '0 9 * * 1' },
        timezone: 'UTC',
      }),
    );
    rejects(
      node('trigger_scheduled', {
        schedule: { frequency: 'daily', time: '25:00' },
        timezone: 'UTC',
      }),
    );
    rejects(
      node('trigger_scheduled', {
        schedule: { frequency: 'cron', expression: '0 9 *' },
        timezone: 'UTC',
      }),
    );
    rejects(node('trigger_scheduled', { schedule: { frequency: 'daily', time: '09:00' } }));
  });

  it('trigger_webhook', () => {
    accepts(node('trigger_webhook', {}));
  });

  it('decision', () => {
    accepts(
      node('decision', {
        outcomes: [
          { id: 'big', label: 'Big deal', condition: { mode: 'formula', formula: 'amount>1' } },
          { id: 'small', label: 'Small deal', condition: filtersCondition },
        ],
      }),
    );
    rejects(node('decision', { outcomes: [] }));
    const dup = { id: 'won', label: 'Won', condition: filtersCondition };
    rejects(node('decision', { outcomes: [dup, dup] }));
    rejects(
      node('decision', {
        outcomes: [{ id: 'default', label: 'Default', condition: filtersCondition }],
      }),
    );
  });

  it('assignment', () => {
    accepts(
      node('assignment', {
        assignments: [
          { target: { scope: 'vars', name: 'total' }, value: 42 },
          { target: { scope: 'record', fieldKey: 'stage' }, value: '{{vars.stage}}' },
        ],
      }),
    );
    rejects(node('assignment', { assignments: [] }));
    rejects(
      node('assignment', {
        assignments: [{ target: { scope: 'vars', name: '1bad' }, value: 1 }],
      }),
    );
  });

  it('get_records', () => {
    accepts(
      node('get_records', {
        objectKey: 'deal',
        filters: [{ fieldKey: 'stage', op: 'eq', value: 'open' }],
        logic: 'and',
        sort: { fieldKey: 'amount', direction: 'desc' },
        limit: 200,
        assignTo: 'deals',
      }),
    );
    rejects(node('get_records', { objectKey: 'deal', limit: 201, assignTo: 'deals' }));
    rejects(node('get_records', { objectKey: 'deal', limit: 0, assignTo: 'deals' }));
    rejects(node('get_records', { objectKey: 'deal', assignTo: 'deals' }));
  });

  it('loop', () => {
    accepts(node('loop', { sourceVar: 'deals' }));
    rejects(node('loop', {}));
  });

  it('wait', () => {
    accepts(node('wait', { kind: 'duration', amount: 2, unit: 'hours' }));
    accepts(node('wait', { kind: 'until', at: '{{record.close_date}}' }));
    accepts(
      node('wait', { kind: 'relative_to_field', fieldKey: 'close_date', offset: -1, unit: 'days' }),
    );
    rejects(node('wait', { kind: 'duration', amount: 0, unit: 'hours' }));
    rejects(node('wait', { kind: 'duration', amount: 1, unit: 'weeks' }));
    rejects(node('wait', { kind: 'relative_to_field', offset: 1, unit: 'days' }));
  });

  it('update_records', () => {
    accepts(
      node('update_records', {
        target: { kind: 'trigger_record' },
        fields: { stage: 'closed_won', amount: 100 },
      }),
    );
    accepts(
      node('update_records', {
        target: {
          kind: 'query',
          objectKey: 'deal',
          filters: [{ fieldKey: 'stage', op: 'eq', value: 'open' }],
          logic: 'and',
          limit: 50,
        },
        fields: { stage: 'stale' },
      }),
    );
    rejects(node('update_records', { target: { kind: 'trigger_record' }, fields: {} }));
    rejects(
      node('update_records', {
        target: { kind: 'query', objectKey: 'deal', filters: [], logic: 'and', limit: 50 },
        fields: { stage: 'x' },
      }),
    );
  });

  it('create_record', () => {
    accepts(
      node('create_record', {
        objectKey: 'activity',
        fields: { subject: 'Follow up on {{record.name}}' },
        assignTo: 'task',
      }),
    );
    rejects(node('create_record', { objectKey: 'activity', fields: {} }));
  });

  it('delete_record', () => {
    accepts(node('delete_record', { target: { kind: 'var', name: 'stale' } }));
    accepts(node('delete_record', { target: { kind: 'loop_item' } }));
    rejects(
      node('delete_record', {
        target: { kind: 'query', objectKey: 'deal', filters: [], logic: 'and', limit: 1 },
      }),
    );
  });

  it('assign_owner', () => {
    accepts(
      node('assign_owner', {
        target: { kind: 'trigger_record' },
        owner: { kind: 'user', userId: 'u1' },
      }),
    );
    accepts(
      node('assign_owner', {
        target: { kind: 'loop_item' },
        owner: { kind: 'template', value: '{{record.owner_id}}' },
      }),
    );
    rejects(node('assign_owner', { target: { kind: 'trigger_record' }, owner: { kind: 'user' } }));
  });

  it('send_email', () => {
    accepts(
      node('send_email', {
        to: ['{{record.email}}', 'ops@example.com'],
        subject: 'Deal {{record.name}} closed',
        body: 'Amount: {{record.amount}}',
      }),
    );
    rejects(node('send_email', { to: [], subject: 'x', body: 'y' }));
    rejects(node('send_email', { to: ['a@b.c'], subject: '', body: 'y' }));
  });

  it('post_timeline', () => {
    accepts(node('post_timeline', { target: { kind: 'trigger_record' }, body: 'Flow ran.' }));
    rejects(node('post_timeline', { target: { kind: 'trigger_record' }, body: '' }));
  });

  it('notify', () => {
    accepts(
      node('notify', {
        recipients: [{ kind: 'record_owner' }, { kind: 'user', userId: 'u1' }],
        title: 'Deal closed',
        body: '{{record.name}} closed for {{record.amount}}',
        link: '/deals',
      }),
    );
    rejects(node('notify', { recipients: [], title: 'x' }));
  });

  it('webhook_out', () => {
    accepts(
      node('webhook_out', {
        url: 'https://example.com/hook',
        method: 'POST',
        headers: { 'X-Token': '{{vars.token}}' },
        body: '{"id": "{{record.id}}"}',
      }),
    );
    accepts(node('webhook_out', { url: '{{vars.url}}', method: 'GET' }));
    rejects(node('webhook_out', { url: 'http://example.com/hook', method: 'POST' }));
    rejects(node('webhook_out', { url: 'https://example.com', method: 'HEAD' }));
  });

  it('ai_step', () => {
    accepts(
      node('ai_step', {
        mode: 'classify',
        prompt: 'Classify this deal: {{record.name}}',
        options: ['hot', 'cold'],
        output: { scope: 'vars', name: 'temperature' },
      }),
    );
    accepts(
      node('ai_step', {
        mode: 'draft',
        prompt: 'Draft a follow-up email',
        output: { scope: 'record', fieldKey: 'next_step' },
      }),
    );
    rejects(
      node('ai_step', { mode: 'classify', prompt: 'x', output: { scope: 'vars', name: 'v' } }),
    );
    rejects(
      node('ai_step', { mode: 'summarize', prompt: 'x', output: { scope: 'vars', name: 'v' } }),
    );
  });

  it('agent_step', () => {
    accepts(
      node('agent_step', {
        mission: 'Summarize {{record.name}} account health',
        toolIds: ['search_records', 'get_record'],
        maxToolCalls: 5,
        output: { scope: 'vars', name: 'agent_report' },
      }),
    );
    // Preset + writes allowlisted, no output (report is discardable).
    accepts(
      node('agent_step', {
        agentKey: 'pipeline-analyst',
        mission: 'Fix the stage on stale deals',
        toolIds: ['search_records', 'update_record'],
      }),
    );
    // Empty allowlist, unknown tool id, and out-of-range budgets reject.
    rejects(node('agent_step', { mission: 'x', toolIds: [] }));
    rejects(node('agent_step', { mission: 'x', toolIds: ['run_apex'] }));
    rejects(node('agent_step', { mission: 'x', toolIds: ['get_record'], maxToolCalls: 11 }));
    rejects(node('agent_step', { toolIds: ['get_record'] }));
  });

  it('rejects unknown node types and missing ids', () => {
    rejects(node('apex_step', {}));
    rejects({ type: 'assignment', config: { assignments: [] } });
  });
});

describe('FlowTriggerSchema', () => {
  it('accepts the three trigger nodes and rejects non-trigger nodes', () => {
    expect(FlowTriggerSchema.safeParse(node('trigger_record', { event: 'created' })).success).toBe(
      true,
    );
    expect(FlowTriggerSchema.safeParse(node('trigger_webhook', {})).success).toBe(true);
    expect(
      FlowTriggerSchema.safeParse(
        node('trigger_scheduled', {
          schedule: { frequency: 'daily', time: '09:00' },
          timezone: 'UTC',
        }),
      ).success,
    ).toBe(true);
    expect(
      FlowTriggerSchema.safeParse(
        node('assignment', { assignments: [{ target: { scope: 'vars', name: 'x' }, value: 1 }] }),
      ).success,
    ).toBe(false);
  });
});

describe('FlowEdgeSchema + FlowGraphSchema', () => {
  const trigger = node('trigger_record', { event: 'created' }, 't');
  const assign = (id: string) =>
    node('assignment', { assignments: [{ target: { scope: 'vars', name: 'x' }, value: 1 }] }, id);

  it('accepts a minimal graph and edges with/without sourceHandle', () => {
    expect(
      FlowEdgeSchema.safeParse({ id: 'e1', source: 't', target: 'a', sourceHandle: 'body' })
        .success,
    ).toBe(true);
    expect(FlowEdgeSchema.safeParse({ id: 'e1', source: 't', target: 'a' }).success).toBe(true);
    const graph = {
      nodes: [trigger, assign('a')],
      edges: [{ id: 'e1', source: 't', target: 'a' }],
    };
    expect(FlowGraphSchema.safeParse(graph).success).toBe(true);
  });

  it('rejects empty graphs, duplicate ids, and over-cap sizes', () => {
    expect(FlowGraphSchema.safeParse({ nodes: [], edges: [] }).success).toBe(false);
    expect(FlowGraphSchema.safeParse({ nodes: [trigger, assign('t')], edges: [] }).success).toBe(
      false,
    );
    expect(
      FlowGraphSchema.safeParse({
        nodes: [trigger, assign('a')],
        edges: [
          { id: 'e1', source: 't', target: 'a' },
          { id: 'e1', source: 't', target: 'a' },
        ],
      }).success,
    ).toBe(false);
    const tooManyNodes = {
      nodes: [trigger, ...Array.from({ length: FLOW_LIMITS.maxNodes }, (_, i) => assign(`a${i}`))],
      edges: [],
    };
    expect(FlowGraphSchema.safeParse(tooManyNodes).success).toBe(false);
    const tooManyEdges = {
      nodes: [trigger, assign('a')],
      edges: Array.from({ length: FLOW_LIMITS.maxEdges + 1 }, (_, i) => ({
        id: `e${i}`,
        source: 't',
        target: 'a',
      })),
    };
    expect(FlowGraphSchema.safeParse(tooManyEdges).success).toBe(false);
  });
});
