// Dispatch matrix: trigger-event matching, watchedFieldKeys ∩ changedKeys,
// entry conditions (filters + formula, fail-open skip), the depth cap with
// its parent-run forensics note, and the post-commit enqueue closure. Pure —
// the db query helpers and the queue module are mocked, so no Postgres or
// Redis is touched.

import type { FlowNodeOfType } from '@northbeam/core';
import type { DbExecutor, FlowRow, FlowRunRow, NewFlowRunInput } from '@northbeam/db';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@northbeam/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@northbeam/db')>();
  return {
    ...actual,
    listActiveFlowsForObject: vi.fn(),
    createRuns: vi.fn(),
    insertStep: vi.fn(),
  };
});
vi.mock('../../src/queue/flows.js', () => ({
  enqueueFlowRun: vi.fn(async () => {}),
}));

import { createRuns, insertStep, listActiveFlowsForObject } from '@northbeam/db';
import {
  type RecordEvent,
  dispatchRecordEvent,
  matchesRecordTrigger,
} from '../../src/automation/dispatch.js';
import { enqueueFlowRun } from '../../src/queue/flows.js';

type RecordTrigger = FlowNodeOfType<'trigger_record'>;

const trig = (config: RecordTrigger['config']): RecordTrigger => ({
  id: 'trigger',
  type: 'trigger_record',
  config,
});

// Only the columns dispatch reads; the rest of FlowRow is irrelevant here.
const flowRow = (id: string, over: Record<string, unknown> = {}): FlowRow =>
  ({
    id,
    organizationId: 'org1',
    activeVersionId: `${id}-v1`,
    activeTriggerType: 'trigger_record',
    activeTrigger: trig({ event: 'created_or_updated' }),
    ...over,
  }) as unknown as FlowRow;

const tx = {} as unknown as DbExecutor;

const baseEvent: RecordEvent = {
  organizationId: 'org1',
  objectId: 'obj1',
  objectKey: 'deal',
  recordId: 'rec1',
  kind: 'updated',
  record: { stage: 'closed_won', amount: 250 },
  oldRecord: { stage: 'open', amount: 250 },
  changedKeys: ['stage'],
  fields: [
    { key: 'stage', type: 'picklist' },
    { key: 'amount', type: 'currency' },
  ],
  actorUserId: 'user1',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listActiveFlowsForObject).mockResolvedValue([]);
  vi.mocked(createRuns).mockImplementation(async (_db, inputs: NewFlowRunInput[]) =>
    inputs.map((input, i) => ({ ...input, id: `run-${i}` }) as unknown as FlowRunRow),
  );
});

describe('matchesRecordTrigger — event matrix', () => {
  const evt = (kind: RecordEvent['kind']): RecordEvent => ({ ...baseEvent, kind });

  it('matches each event literal against the right kinds', () => {
    expect(matchesRecordTrigger(trig({ event: 'created' }), evt('created')).matched).toBe(true);
    expect(matchesRecordTrigger(trig({ event: 'created' }), evt('updated')).matched).toBe(false);
    expect(matchesRecordTrigger(trig({ event: 'updated' }), evt('updated')).matched).toBe(true);
    expect(matchesRecordTrigger(trig({ event: 'updated' }), evt('created')).matched).toBe(false);
    expect(
      matchesRecordTrigger(trig({ event: 'created_or_updated' }), evt('created')).matched,
    ).toBe(true);
    expect(
      matchesRecordTrigger(trig({ event: 'created_or_updated' }), evt('updated')).matched,
    ).toBe(true);
    expect(
      matchesRecordTrigger(trig({ event: 'created_or_updated' }), evt('deleted')).matched,
    ).toBe(false);
    expect(matchesRecordTrigger(trig({ event: 'deleted' }), evt('deleted')).matched).toBe(true);
    expect(matchesRecordTrigger(trig({ event: 'deleted' }), evt('updated')).matched).toBe(false);
  });

  it('watchedFieldKeys constrain updates via changedKeys intersection', () => {
    const watching = trig({ event: 'updated', watchedFieldKeys: ['amount', 'stage'] });
    expect(matchesRecordTrigger(watching, { ...baseEvent, changedKeys: ['stage'] }).matched).toBe(
      true,
    );
    expect(matchesRecordTrigger(watching, { ...baseEvent, changedKeys: ['name'] }).matched).toBe(
      false,
    );
    expect(matchesRecordTrigger(watching, { ...baseEvent, changedKeys: [] }).matched).toBe(false);
  });

  it('watchedFieldKeys never block a create (SF semantics)', () => {
    const watching = trig({ event: 'created_or_updated', watchedFieldKeys: ['amount'] });
    expect(
      matchesRecordTrigger(watching, { ...evt('created'), changedKeys: undefined }).matched,
    ).toBe(true);
  });

  it('evaluates filter entry conditions against the new record data', () => {
    const gated = trig({
      event: 'updated',
      entryCondition: {
        mode: 'filters',
        logic: 'and',
        filters: [{ fieldKey: 'stage', op: 'eq', value: 'closed_won' }],
      },
    });
    expect(matchesRecordTrigger(gated, baseEvent).matched).toBe(true);
    expect(matchesRecordTrigger(gated, { ...baseEvent, record: { stage: 'open' } }).matched).toBe(
      false,
    );
  });

  it('formula entry conditions see oldRecord.* keys', () => {
    const gated = trig({
      event: 'updated',
      entryCondition: { mode: 'formula', formula: '{stage} <> {oldRecord.stage}' },
    });
    expect(matchesRecordTrigger(gated, baseEvent).matched).toBe(true);
    expect(
      matchesRecordTrigger(gated, { ...baseEvent, oldRecord: { stage: 'closed_won' } }).matched,
    ).toBe(false);
  });

  it('delete events evaluate the condition against oldRecord', () => {
    const gated = trig({
      event: 'deleted',
      entryCondition: {
        mode: 'filters',
        logic: 'and',
        filters: [{ fieldKey: 'stage', op: 'eq', value: 'open' }],
      },
    });
    const deleteEvt: RecordEvent = { ...baseEvent, kind: 'deleted', record: undefined };
    expect(matchesRecordTrigger(gated, deleteEvt).matched).toBe(true);
  });

  it('a broken condition skips the flow with a warning (fail-open)', () => {
    const broken = trig({
      event: 'updated',
      entryCondition: { mode: 'formula', formula: 'SYNTAX(((' },
    });
    const result = matchesRecordTrigger(broken, baseEvent);
    expect(result.matched).toBe(false);
    expect(result.warning).toBeDefined();
  });
});

describe('dispatchRecordEvent', () => {
  it('creates one queued run per matching flow, atomically via createRuns', async () => {
    vi.mocked(listActiveFlowsForObject).mockResolvedValue([
      flowRow('f-match'),
      flowRow('f-create-only', { activeTrigger: trig({ event: 'created' }) }),
    ]);
    const result = await dispatchRecordEvent(tx, baseEvent);
    expect(result.runIds).toEqual(['run-0']);
    const inputs = vi.mocked(createRuns).mock.calls[0]?.[1];
    expect(inputs).toEqual([
      {
        organizationId: 'org1',
        flowId: 'f-match',
        flowVersionId: 'f-match-v1',
        triggerType: 'record_updated',
        objectId: 'obj1',
        recordId: 'rec1',
        context: {
          record: baseEvent.record,
          oldRecord: baseEvent.oldRecord,
          changedKeys: ['stage'],
          vars: {},
          actorUserId: 'user1',
        },
        depth: 0,
        triggeredByRunId: null,
      },
    ]);
  });

  it('skips flows without an active version, wrong trigger type, or invalid trigger json', async () => {
    vi.mocked(listActiveFlowsForObject).mockResolvedValue([
      flowRow('f-no-version', { activeVersionId: null }),
      flowRow('f-scheduled', { activeTriggerType: 'trigger_scheduled' }),
      flowRow('f-bad-json', { activeTrigger: { id: 'x', type: 'trigger_record', config: {} } }),
    ]);
    const result = await dispatchRecordEvent(tx, baseEvent);
    expect(result.runIds).toEqual([]);
    expect(createRuns).not.toHaveBeenCalled();
  });

  it('maps event kinds to run trigger types', async () => {
    vi.mocked(listActiveFlowsForObject).mockResolvedValue([
      flowRow('f', { activeTrigger: trig({ event: 'created' }) }),
    ]);
    await dispatchRecordEvent(tx, { ...baseEvent, kind: 'created', oldRecord: undefined });
    expect(vi.mocked(createRuns).mock.calls[0]?.[1]?.[0]?.triggerType).toBe('record_created');
  });

  it('stops at maxDepth with a skipped forensics step on the parent run', async () => {
    const result = await dispatchRecordEvent(tx, {
      ...baseEvent,
      depth: 5,
      triggeredByRunId: 'parent-run',
    });
    expect(result.runIds).toEqual([]);
    expect(listActiveFlowsForObject).not.toHaveBeenCalled();
    expect(createRuns).not.toHaveBeenCalled();
    expect(insertStep).toHaveBeenCalledWith(tx, {
      organizationId: 'org1',
      runId: 'parent-run',
      nodeId: 'dispatch',
      nodeType: 'dispatch',
      status: 'skipped',
      summary: {
        reason: 'max_depth',
        depth: 5,
        maxDepth: 5,
        objectKey: 'deal',
        recordId: 'rec1',
        event: 'updated',
      },
    });
    // Below the cap, dispatch proceeds and stamps the child depth.
    vi.mocked(listActiveFlowsForObject).mockResolvedValue([flowRow('f')]);
    await dispatchRecordEvent(tx, { ...baseEvent, depth: 4, triggeredByRunId: 'parent-run' });
    const input = vi.mocked(createRuns).mock.calls[0]?.[1]?.[0];
    expect(input?.depth).toBe(4);
    expect(input?.triggeredByRunId).toBe('parent-run');
  });

  it('writes no forensics step at maxDepth without a parent run (user write cannot hit it)', async () => {
    await dispatchRecordEvent(tx, { ...baseEvent, depth: 5 });
    expect(insertStep).not.toHaveBeenCalled();
  });

  it('enqueue closure fires one job per run, post-commit only', async () => {
    vi.mocked(listActiveFlowsForObject).mockResolvedValue([flowRow('f1'), flowRow('f2')]);
    const result = await dispatchRecordEvent(tx, baseEvent);
    expect(result.runIds).toEqual(['run-0', 'run-1']);
    expect(enqueueFlowRun).not.toHaveBeenCalled(); // nothing enqueued inside the tx
    await result.enqueue();
    expect(vi.mocked(enqueueFlowRun).mock.calls.map((c) => c[0])).toEqual([
      { orgId: 'org1', runId: 'run-0' },
      { orgId: 'org1', runId: 'run-1' },
    ]);
  });

  it('enqueue is a no-op when nothing matched', async () => {
    const result = await dispatchRecordEvent(tx, baseEvent);
    await result.enqueue();
    expect(enqueueFlowRun).not.toHaveBeenCalled();
  });
});
