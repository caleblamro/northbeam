// translateFlow / translateWorkflowRule are pure Tooling-metadata → flow-graph
// translators. Fixtures are inline synthetic payloads shaped like the verified
// raw dumps (fixture org, Tooling REST v67 — see the flow-mapper.ts header):
// explicit nulls on value-union keys, [] element arrays, connector objects.

import { validateFlowGraph } from '@northbeam/core';
import type {
  FlowMetadata,
  FlowVersionRecord,
  ToolingMetadataRecord,
  WorkflowRuleMetadata,
} from '@northbeam/salesforce';
import { describe, expect, it } from 'vitest';
import {
  emptyWorkflowActionBundle,
  flowKeyFrom,
  translateFlow,
  translateWorkflowRule,
  transpileFlowFormula,
} from '../../src/salesforce/flow-mapper.js';
import { type ObjectResolution, buildResolution } from '../../src/salesforce/report-mapper.js';

/* ── Fixtures ────────────────────────────────────────────────────────────── */

const dealResolution = buildResolution({
  obj: { sfObject: 'Opportunity', targetKey: 'deal', nameFieldSf: 'Name' },
  fields: [
    { sfField: 'StageName', key: 'stage', type: 'picklist', status: 'mapped' },
    { sfField: 'Amount', key: 'amount', type: 'currency', status: 'mapped' },
    { sfField: 'CloseDate', key: 'close_date', type: 'date', status: 'mapped' },
    { sfField: 'IsPrivate', key: 'is_private', type: 'checkbox', status: 'mapped' },
    { sfField: 'Description', key: 'description', type: 'textarea', status: 'mapped' },
  ],
});

const propertyResolution = buildResolution({
  obj: { sfObject: 'Property__c', targetKey: 'property', nameFieldSf: 'Name' },
  fields: [
    { sfField: 'Flow_Stamp__c', key: 'flow_stamp', type: 'text', status: 'mapped' },
    { sfField: 'Monthly_Rent__c', key: 'monthly_rent', type: 'currency', status: 'mapped' },
  ],
});

const resolutions = new Map<string, ObjectResolution>([
  ['Opportunity', dealResolution],
  ['Property__c', propertyResolution],
]);
const importedSfObjects = new Set(['Opportunity', 'Property__c']);

/** A record-triggered autolaunched flow shell mirroring the verified dump —
 *  Tooling REST returns every element array (as []) and explicit nulls. */
function flowVersion(meta: Partial<FlowMetadata>): FlowVersionRecord {
  return {
    Id: '301gK00001BvYcPQAV',
    FullName: 'Test_Flow-1',
    Metadata: {
      label: 'Test Flow',
      description: null,
      processType: 'AutoLaunchedFlow',
      status: 'Active',
      apiVersion: 62,
      start: {
        object: 'Opportunity',
        triggerType: 'RecordAfterSave',
        recordTriggerType: 'Update',
        connector: { targetReference: 'Check_Amount', isGoTo: null },
        scheduledPaths: [],
        schedule: null,
        filters: [],
        filterLogic: null,
        filterFormula: null,
        doesRequireRecordChangedToMeetCriteria: null,
      },
      startElementReference: null,
      actionCalls: [],
      assignments: [],
      decisions: [],
      loops: [],
      recordCreates: [],
      recordDeletes: [],
      recordLookups: [],
      recordUpdates: [],
      waits: [],
      screens: [],
      subflows: [],
      variables: [],
      formulas: [],
      constants: [],
      textTemplates: [],
      ...meta,
    },
  };
}

const stampUpdate = {
  name: 'Stamp',
  label: 'Stamp Deal',
  inputReference: '$Record',
  object: null,
  filters: [],
  filterLogic: null,
  inputAssignments: [
    { field: 'StageName', value: { stringValue: 'closed_won', numberValue: null } },
  ],
  connector: null,
  faultConnector: null,
};

/* ── flowKeyFrom ─────────────────────────────────────────────────────────── */

describe('flowKeyFrom', () => {
  it('produces prefixed, capped keys', () => {
    expect(flowKeyFrom('Property_Flow_Stamp')).toBe('property_flow_stamp');
    expect(flowKeyFrom('Opportunity.Escalate', 'wfr_')).toBe('wfr_opportunity_escalate');
    expect(flowKeyFrom(`${'Long_'.repeat(20)}Name`).length).toBeLessThanOrEqual(48);
  });
});

/* ── transpileFlowFormula ────────────────────────────────────────────────── */

describe('transpileFlowFormula', () => {
  it('maps $Record and $Record__Prior merges to brace refs', () => {
    const t = transpileFlowFormula('{!$Record.Amount} > {!$Record__Prior.Amount}', dealResolution);
    if (!t.ok) throw new Error(t.reason);
    expect(t.formula).toBe('({amount} > {oldRecord.amount})');
  });

  it('inlines named flow formulas', () => {
    const formulas = new Map([['Big_Amount', '$Record.Amount > 10000']]);
    const t = transpileFlowFormula(
      '{!Big_Amount} && {!$Record.IsPrivate}',
      dealResolution,
      formulas,
    );
    if (!t.ok) throw new Error(t.reason);
    expect(t.formula).toBe('(({amount} > 10000) AND {is_private})');
  });

  it('refuses residual merges and foreign globals', () => {
    expect(transpileFlowFormula('{!Unknown_Var} = 1', dealResolution).ok).toBe(false);
    expect(transpileFlowFormula('$User.Id = "x"', dealResolution).ok).toBe(false);
    expect(transpileFlowFormula('{!$Record.Account.Name} = "x"', dealResolution).ok).toBe(false);
  });
});

/* ── Flow translation ────────────────────────────────────────────────────── */

describe('translateFlow', () => {
  it('translates a record trigger + decision + update graph', () => {
    const t = translateFlow(
      flowVersion({
        decisions: [
          {
            name: 'Check_Amount',
            label: 'Check Amount',
            defaultConnector: null,
            defaultConnectorLabel: null,
            rules: [
              {
                name: 'Big_Deal',
                label: 'Big deal',
                conditionLogic: 'and',
                conditions: [
                  {
                    leftValueReference: '$Record.Amount',
                    operator: 'GreaterThan',
                    rightValue: { numberValue: 10000, stringValue: null },
                  },
                ],
                connector: { targetReference: 'Stamp', isGoTo: null },
              },
            ],
          },
        ],
        recordUpdates: [stampUpdate],
      }),
      resolutions,
      importedSfObjects,
    );
    if (!t.ok) throw new Error(t.reason);
    expect(t.key).toBe('test_flow');
    expect(t.targetObjectKey).toBe('deal');
    expect(t.status).toBe('paused'); // Active in SF → never auto-active here
    expect(t.trigger.type).toBe('trigger_record');
    expect(t.trigger.config).toMatchObject({ event: 'updated' });

    const decision = t.graph.nodes.find((n) => n.type === 'decision');
    if (decision?.type !== 'decision') throw new Error('decision node missing');
    expect(decision.config.outcomes[0]).toMatchObject({
      id: 'big_deal',
      label: 'Big deal',
      condition: {
        mode: 'filters',
        logic: 'and',
        filters: [{ fieldKey: 'amount', op: 'gt', value: 10000 }],
      },
    });
    const update = t.graph.nodes.find((n) => n.type === 'update_records');
    if (update?.type !== 'update_records') throw new Error('update node missing');
    expect(update.config).toEqual({
      target: { kind: 'trigger_record' },
      fields: { stage: 'closed_won' },
    });
    expect(t.graph.edges).toEqual([
      expect.objectContaining({ source: 'trigger', target: 'Check_Amount' }),
      expect.objectContaining({
        source: 'Check_Amount',
        target: 'Stamp',
        sourceHandle: 'big_deal',
      }),
    ]);
    expect(validateFlowGraph(t.graph).ok).toBe(true);
  });

  it('translates the verified before-save assignment flow (Property_Flow_Stamp shape)', () => {
    const t = translateFlow(
      flowVersion({
        label: 'Property Flow Stamp',
        start: {
          object: 'Property__c',
          triggerType: 'RecordBeforeSave',
          recordTriggerType: 'Create',
          connector: { targetReference: 'Stamp_Record', isGoTo: null },
          scheduledPaths: [],
          schedule: null,
          filters: [],
          filterLogic: null,
          filterFormula: null,
          doesRequireRecordChangedToMeetCriteria: null,
        },
        assignments: [
          {
            name: 'Stamp_Record',
            label: 'Stamp Record',
            connector: null, // terminal (verified)
            assignmentItems: [
              {
                assignToReference: '$Record.Flow_Stamp__c',
                operator: 'Assign',
                value: { stringValue: 'flow:stamped-on-create', numberValue: null },
              },
            ],
          },
        ],
      }),
      resolutions,
      importedSfObjects,
    );
    if (!t.ok) throw new Error(t.reason);
    expect(t.targetObjectKey).toBe('property');
    expect(t.trigger.config).toMatchObject({ event: 'created' });
    const assignment = t.graph.nodes.find((n) => n.type === 'assignment');
    if (assignment?.type !== 'assignment') throw new Error('assignment node missing');
    expect(assignment.config.assignments).toEqual([
      { target: { scope: 'record', fieldKey: 'flow_stamp' }, value: 'flow:stamped-on-create' },
    ]);
    expect(t.notes.join(' ')).toContain('before-save');
  });

  it('translates a scheduled path into a relative-to-field wait', () => {
    const t = translateFlow(
      flowVersion({
        start: {
          object: 'Opportunity',
          triggerType: 'RecordAfterSave',
          recordTriggerType: 'Create',
          connector: null,
          scheduledPaths: [
            {
              name: 'After_Close',
              label: 'After Close',
              offsetNumber: 3,
              offsetUnit: 'Days',
              recordField: 'CloseDate',
              timeSource: 'RecordField',
              connector: { targetReference: 'Stamp', isGoTo: null },
            },
          ],
          schedule: null,
          filters: [],
          filterLogic: null,
          filterFormula: null,
          doesRequireRecordChangedToMeetCriteria: null,
        },
        recordUpdates: [stampUpdate],
      }),
      resolutions,
      importedSfObjects,
    );
    if (!t.ok) throw new Error(t.reason);
    const wait = t.graph.nodes.find((n) => n.type === 'wait');
    if (wait?.type !== 'wait') throw new Error('wait node missing');
    expect(wait.config).toEqual({
      kind: 'relative_to_field',
      fieldKey: 'close_date',
      offset: 3,
      unit: 'days',
    });
    expect(t.graph.edges).toEqual([
      expect.objectContaining({ source: 'trigger', target: wait.id }),
      expect.objectContaining({ source: wait.id, target: 'Stamp' }),
    ]);
    expect(validateFlowGraph(t.graph).ok).toBe(true);
  });

  it('routes $Record__Prior conditions and filter formulas through the formula engine', () => {
    const t = translateFlow(
      flowVersion({
        start: {
          object: 'Opportunity',
          triggerType: 'RecordAfterSave',
          recordTriggerType: 'Update',
          connector: { targetReference: 'Check_Drop', isGoTo: null },
          scheduledPaths: [],
          schedule: null,
          filters: [],
          filterLogic: null,
          filterFormula: '{!$Record.Amount} > {!$Record__Prior.Amount}',
          doesRequireRecordChangedToMeetCriteria: null,
        },
        decisions: [
          {
            name: 'Check_Drop',
            label: 'Check Drop',
            defaultConnector: null,
            defaultConnectorLabel: null,
            rules: [
              {
                name: 'Dropped',
                label: 'Dropped',
                conditionLogic: 'and',
                conditions: [
                  {
                    leftValueReference: '$Record__Prior.Amount',
                    operator: 'LessThan',
                    rightValue: { elementReference: '$Record.Amount', stringValue: null },
                  },
                ],
                connector: { targetReference: 'Stamp', isGoTo: null },
              },
            ],
          },
        ],
        recordUpdates: [stampUpdate],
      }),
      resolutions,
      importedSfObjects,
    );
    if (!t.ok) throw new Error(t.reason);
    expect(t.trigger.config).toMatchObject({
      entryCondition: { mode: 'formula', formula: '({amount} > {oldRecord.amount})' },
    });
    const decision = t.graph.nodes.find((n) => n.type === 'decision');
    if (decision?.type !== 'decision') throw new Error('decision node missing');
    expect(decision.config.outcomes[0]?.condition).toEqual({
      mode: 'formula',
      formula: '({oldRecord.amount} < {amount})',
    });
  });

  it('references a flow containing an apex action call — never a partial import', () => {
    const t = translateFlow(
      flowVersion({
        start: {
          object: 'Opportunity',
          triggerType: 'RecordAfterSave',
          recordTriggerType: 'Update',
          connector: { targetReference: 'Call_Apex', isGoTo: null },
          scheduledPaths: [],
          schedule: null,
          filters: [],
          filterLogic: null,
          filterFormula: null,
          doesRequireRecordChangedToMeetCriteria: null,
        },
        actionCalls: [
          {
            name: 'Call_Apex',
            label: 'Call Apex',
            actionName: 'MyInvocable',
            actionType: 'apex',
            inputParameters: [],
            connector: null,
            faultConnector: null,
          },
        ],
      }),
      resolutions,
      importedSfObjects,
    );
    expect(t.ok).toBe(false);
    if (t.ok) throw new Error('expected reference');
    expect(t.sfType).toBe('flow');
    expect(t.reason).toContain('apex');
    expect(t.activeInSf).toBe(true);
  });

  it('references Process Builder process types', () => {
    const t = translateFlow(
      flowVersion({ processType: 'Workflow', status: 'Draft' }),
      resolutions,
      importedSfObjects,
    );
    expect(t.ok).toBe(false);
    if (t.ok) throw new Error('expected reference');
    expect(t.sfType).toBe('process-builder');
    expect(t.activeInSf).toBe(false);
  });

  it('references Add-operator assignments instead of dropping the mutation', () => {
    const t = translateFlow(
      flowVersion({
        start: {
          object: 'Opportunity',
          triggerType: 'RecordAfterSave',
          recordTriggerType: 'Update',
          connector: { targetReference: 'Increment', isGoTo: null },
          scheduledPaths: [],
          schedule: null,
          filters: [],
          filterLogic: null,
          filterFormula: null,
          doesRequireRecordChangedToMeetCriteria: null,
        },
        assignments: [
          {
            name: 'Increment',
            label: 'Increment',
            connector: null,
            assignmentItems: [
              {
                assignToReference: '$Record.Amount',
                operator: 'Add',
                value: { numberValue: 1, stringValue: null },
              },
            ],
          },
        ],
      }),
      resolutions,
      importedSfObjects,
    );
    expect(t.ok).toBe(false);
    if (t.ok) throw new Error('expected reference');
    expect(t.reason).toContain("'Add'");
  });

  it('degrades cross-object field values with a note, keeping the rest of the write', () => {
    const t = translateFlow(
      flowVersion({
        recordUpdates: [
          {
            ...stampUpdate,
            inputAssignments: [
              { field: 'StageName', value: { stringValue: 'closed_won', numberValue: null } },
              {
                field: 'Description',
                value: { elementReference: '$Record.Account.Industry', stringValue: null },
              },
            ],
          },
        ],
        start: {
          object: 'Opportunity',
          triggerType: 'RecordAfterSave',
          recordTriggerType: 'Update',
          connector: { targetReference: 'Stamp', isGoTo: null },
          scheduledPaths: [],
          schedule: null,
          filters: [],
          filterLogic: null,
          filterFormula: null,
          doesRequireRecordChangedToMeetCriteria: null,
        },
      }),
      resolutions,
      importedSfObjects,
    );
    if (!t.ok) throw new Error(t.reason);
    const update = t.graph.nodes.find((n) => n.type === 'update_records');
    if (update?.type !== 'update_records') throw new Error('update node missing');
    expect(update.config.fields).toEqual({ stage: 'closed_won' });
    expect(t.notes.some((n) => n.includes("'Description'") && n.includes('dropped'))).toBe(true);
  });

  it('references flows on objects outside the import set', () => {
    const t = translateFlow(
      flowVersion({
        start: {
          object: 'Case',
          triggerType: 'RecordAfterSave',
          recordTriggerType: 'Create',
          connector: null,
          scheduledPaths: [],
          schedule: null,
          filters: [],
          filterLogic: null,
          filterFormula: null,
          doesRequireRecordChangedToMeetCriteria: null,
        },
      }),
      resolutions,
      importedSfObjects,
    );
    expect(t.ok).toBe(false);
    if (t.ok) throw new Error('expected reference');
    expect(t.reason).toContain('Case');
    expect(t.sfObject).toBe('Case');
  });
});

/* ── Workflow rules ──────────────────────────────────────────────────────── */

describe('translateWorkflowRule', () => {
  const rule = (
    meta: Partial<WorkflowRuleMetadata>,
  ): ToolingMetadataRecord<WorkflowRuleMetadata> => ({
    Id: '01QgK0000004CAcUAM',
    FullName: 'Opportunity.Escalate_Big_Deals',
    Metadata: {
      fullName: 'Opportunity.Escalate_Big_Deals',
      active: true,
      triggerType: 'onCreateOnly',
      booleanFilter: null,
      criteriaItems: [{ field: 'Opportunity.Amount', operation: 'greaterThan', value: '50000' }],
      formula: null,
      description: null,
      actions: [{ name: 'SetStage', type: 'FieldUpdate' }],
      workflowTimeTriggers: [],
      ...meta,
    },
  });

  it('translates criteria + field update into a full flow', () => {
    const bundle = emptyWorkflowActionBundle();
    bundle.fieldUpdates.set('SetStage', {
      name: 'Set the stage',
      field: 'StageName',
      operation: 'Literal',
      literalValue: 'negotiation',
      formula: null,
      lookupValue: null,
    });
    const t = translateWorkflowRule(rule({}), 'Opportunity', resolutions, bundle);
    if (!t.ok) throw new Error(t.reason);
    expect(t.key).toBe('wfr_opportunity_escalate_big_deals');
    expect(t.status).toBe('paused');
    expect(t.trigger.config).toMatchObject({
      event: 'created',
      entryCondition: {
        mode: 'filters',
        logic: 'and',
        filters: [{ fieldKey: 'amount', op: 'gt', value: '50000' }],
      },
    });
    const update = t.graph.nodes.find((n) => n.type === 'update_records');
    if (update?.type !== 'update_records') throw new Error('update node missing');
    expect(update.config).toEqual({
      target: { kind: 'trigger_record' },
      fields: { stage: 'negotiation' },
    });
    expect(validateFlowGraph(t.graph).ok).toBe(true);
  });

  it('references untranslatable criteria operations (a dropped criterion would over-fire)', () => {
    const t = translateWorkflowRule(
      rule({
        criteriaItems: [{ field: 'Opportunity.StageName', operation: 'notContain', value: 'won' }],
      }),
      'Opportunity',
      resolutions,
      emptyWorkflowActionBundle(),
    );
    expect(t.ok).toBe(false);
    if (t.ok) throw new Error('expected reference');
    expect(t.sfType).toBe('workflow-rule');
    expect(t.reason).toContain('notContain');
  });

  it('translates a single time trigger into a wait path', () => {
    const bundle = emptyWorkflowActionBundle();
    bundle.fieldUpdates.set('SetStage', {
      field: 'StageName',
      operation: 'Literal',
      literalValue: 'stale',
    });
    const t = translateWorkflowRule(
      rule({
        actions: [],
        workflowTimeTriggers: [
          {
            offsetFromField: 'Opportunity.CloseDate',
            timeLength: '7',
            workflowTimeTriggerUnit: 'Days',
            actions: [{ name: 'SetStage', type: 'FieldUpdate' }],
          },
        ],
      }),
      'Opportunity',
      resolutions,
      bundle,
    );
    if (!t.ok) throw new Error(t.reason);
    const wait = t.graph.nodes.find((n) => n.type === 'wait');
    if (wait?.type !== 'wait') throw new Error('wait node missing');
    expect(wait.config).toEqual({
      kind: 'relative_to_field',
      fieldKey: 'close_date',
      offset: 7,
      unit: 'days',
    });
    expect(validateFlowGraph(t.graph).ok).toBe(true);
  });
});
