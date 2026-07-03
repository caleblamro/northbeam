// The artifact contract, guarded from three sides:
//   - ArtifactSchema (packages/core) — what the generator emits and what
//     view.create is willing to store under config.artifact
//   - assertDashboardConfig — the view router's save gate (validation only;
//     the original config object is what gets persisted)
//   - buildSystemPrompt — the prompt must carry the field list, the live data
//     summary, and (in refinement mode) the current artifact

import { type Artifact, ArtifactLikeSchema, ArtifactSchema } from '@northbeam/core';
import type { FieldRow, ObjectRow } from '@northbeam/db';
import { TRPCError } from '@trpc/server';
import { describe, expect, it } from 'vitest';
import { type DataSummary, buildSystemPrompt } from '../../src/ai/artifact-generator.js';
import { repairArtifact } from '../../src/ai/repair-artifact.js';
import { assertDashboardConfig } from '../../src/trpc/routers/view.js';

const validArtifact: Artifact = {
  version: '1',
  components: [
    { component: 'PageHeader', props: { title: 'Pipeline' } },
    { component: 'Metric', props: { label: 'Deals', objectKey: 'deal', fn: 'count', span: 3 } },
    {
      component: 'SectionCard',
      props: { title: 'Top deals' },
      children: [{ component: 'RecordTable', props: { objectKey: 'deal', limit: 5 } }],
    },
  ],
};

describe('ArtifactSchema', () => {
  it('accepts a canonical artifact', () => {
    expect(ArtifactSchema.safeParse(validArtifact).success).toBe(true);
  });

  it('rejects unknown components', () => {
    const bad = {
      version: '1',
      components: [{ component: 'Marquee', props: {} }],
    };
    expect(ArtifactSchema.safeParse(bad).success).toBe(false);
  });

  it('rejects a missing version and an empty tree', () => {
    expect(ArtifactSchema.safeParse({ components: validArtifact.components }).success).toBe(false);
    expect(ArtifactSchema.safeParse({ version: '1', components: [] }).success).toBe(false);
  });

  it('rejects more than 20 top-level components', () => {
    const bloated = {
      version: '1',
      components: Array.from({ length: 21 }, () => ({ component: 'Text', props: { value: 'x' } })),
    };
    expect(ArtifactSchema.safeParse(bloated).success).toBe(false);
  });

  it('rejects nested SectionCards (one level only)', () => {
    const nested = {
      version: '1',
      components: [
        { component: 'SectionCard', children: [{ component: 'SectionCard', children: [] }] },
      ],
    };
    expect(ArtifactSchema.safeParse(nested).success).toBe(false);
  });
});

describe('ArtifactLikeSchema (lenient refinement base)', () => {
  it('accepts drifted components the strict schema rejects', () => {
    const drifted = {
      version: '1',
      components: [
        { component: 'LegacyWidget', props: { anything: true } },
        {
          component: 'MetricGroup',
          children: [{ component: 'Metric', props: { label: 'x' } }],
        },
      ],
    };
    expect(ArtifactLikeSchema.safeParse(drifted).success).toBe(true);
    expect(ArtifactSchema.safeParse(drifted).success).toBe(false);
  });

  it('still rejects nodes without a component name', () => {
    const bad = { version: '1', components: [{ props: { title: 'orphan' } }] };
    expect(ArtifactLikeSchema.safeParse(bad).success).toBe(false);
  });
});

describe('assertDashboardConfig', () => {
  it('passes an empty config, a null config, and a valid artifact', () => {
    expect(() => assertDashboardConfig({})).not.toThrow();
    expect(() => assertDashboardConfig(null)).not.toThrow();
    expect(() =>
      assertDashboardConfig({
        artifact: validArtifact,
        prompt: 'pipeline overview',
        prompts: ['pipeline overview'],
        model: 'claude-opus-4-8',
        generatedAt: '2026-07-01T00:00:00.000Z',
      }),
    ).not.toThrow();
  });

  it('rejects a malformed artifact with BAD_REQUEST', () => {
    try {
      assertDashboardConfig({ artifact: { version: '2', components: [] } });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe('BAD_REQUEST');
    }
  });
});

/* ── Prompt assembly ────────────────────────────────────────────────────── */

const object = { key: 'deal', label: 'Deal' } as ObjectRow;
const fields = [
  { key: 'name', label: 'Name', type: 'text', isSystem: true },
  { key: 'stage', label: 'Stage', type: 'picklist', isSystem: false },
  { key: 'amount', label: 'Amount', type: 'currency', isSystem: false },
] as FieldRow[];
const summary: DataSummary = {
  recordCount: 42,
  picklistCounts: [
    {
      fieldKey: 'stage',
      fieldLabel: 'Stage',
      counts: [{ value: 'Won', count: 12 }],
    },
  ],
  numericSummary: { fieldKey: 'amount', fieldLabel: 'Amount', sum: 990000, avg: 23571 },
  dateSeries: {
    fieldKey: 'close_date',
    fieldLabel: 'Close date',
    points: [
      { bucket: '2026-05', count: 9 },
      { bucket: '2026-06', count: 14 },
    ],
  },
};

describe('buildSystemPrompt', () => {
  it('carries the object, non-system fields, and the live data summary', () => {
    const prompt = buildSystemPrompt(object, fields, summary);
    expect(prompt).toContain('**Deal** object (key: `deal`)');
    expect(prompt).toContain('- Stage (stage, type: picklist)');
    expect(prompt).toContain('- Name (name, type: text)'); // system `name` is kept
    expect(prompt).toContain('- Total records: 42');
    expect(prompt).toContain('Won (12)');
    expect(prompt).not.toContain('# Refinement mode');
  });

  it('caps the field list at 40', () => {
    const many = Array.from(
      { length: 60 },
      (_, i) => ({ key: `f${i}`, label: `Field ${i}`, type: 'text', isSystem: false }) as FieldRow,
    );
    const prompt = buildSystemPrompt(object, many, summary);
    expect(prompt).toContain('- Field 39 (f39, type: text)');
    expect(prompt).not.toContain('- Field 40 (f40, type: text)');
  });

  it('appends the refinement section: indexed components + patch ops', () => {
    const prompt = buildSystemPrompt(object, fields, summary, validArtifact);
    expect(prompt).toContain('# Refinement mode');
    // Each top-level component rides in BY INDEX so patch ops can address it.
    expect(prompt).toContain(`[0] ${JSON.stringify(validArtifact.components[0])}`);
    expect(prompt).toContain(`[2] ${JSON.stringify(validArtifact.components[2])}`);
    expect(prompt).toContain("PREFER returning \"patch\"");
    expect(prompt).toContain("{ op: 'props', index, props }");
  });

  it('teaches the expanded chart vocabulary', () => {
    const prompt = buildSystemPrompt(object, fields, summary);
    for (const t of ['bar', 'line', 'area', 'donut', 'scatter', 'funnel', 'table', 'matrix']) {
      expect(prompt, t).toContain(`'${t}'`);
    }
    expect(prompt).toContain('dateGrain');
    expect(prompt).toContain('groupBy2');
    expect(prompt).toContain("'min'");
    expect(prompt).toContain("'max'");
    expect(prompt).not.toContain("dates can't bucket");
  });

  it('injects the month-grain date series when the summary carries one', () => {
    const prompt = buildSystemPrompt(object, fields, summary);
    expect(prompt).toContain('Close date by month');
    expect(prompt).toContain('2026-06 (14)');
    const without = buildSystemPrompt(object, fields, { ...summary, dateSeries: null });
    expect(without).not.toContain('by month (fieldKey');
  });

  it('lists other objects with their field keys for cross-object components', () => {
    const account = { key: 'account', label: 'Account' } as ObjectRow;
    const accountFields = [
      { key: 'industry', label: 'Industry', type: 'picklist', isSystem: false },
    ] as FieldRow[];
    const prompt = buildSystemPrompt(object, fields, summary, undefined, [
      { object: account, fields: accountFields },
    ]);
    expect(prompt).toContain('# Other objects in this workspace');
    expect(prompt).toContain('## Account (key: `account`)');
    expect(prompt).toContain('- Industry (industry, type: picklist)');
  });
});

/* ── Metadata repair ────────────────────────────────────────────────────── */

const dealFields = [
  { key: 'stage', label: 'Stage', type: 'picklist' },
  { key: 'amount', label: 'Amount', type: 'currency' },
  { key: 'notes', label: 'Notes', type: 'longtext' },
  { key: 'close_date', label: 'Close date', type: 'date' },
] as FieldRow[];
const objectsByKey = new Map([['deal', dealFields]]);

/** One-Chart artifact helper for the repair cases below. */
function chartArtifact(props: Record<string, unknown>): Artifact {
  return { version: '1', components: [{ component: 'Chart', props }] };
}
function chartProps(a: Artifact): Record<string, unknown> {
  return (a.components[0]?.props ?? {}) as Record<string, unknown>;
}

describe('repairArtifact', () => {
  it('keeps a fully-valid artifact untouched', () => {
    const artifact: Artifact = {
      version: '1',
      components: [
        { component: 'PageHeader', props: { title: 'Pipeline' } },
        {
          component: 'Chart',
          props: { objectKey: 'deal', groupBy: 'stage', fn: 'sum', measure: 'amount' },
        },
      ],
    };
    const { artifact: repaired, notes } = repairArtifact(artifact, objectsByKey);
    expect(notes).toEqual([]);
    expect(repaired).toEqual(artifact);
  });

  it('removes live nodes targeting unknown objects', () => {
    const artifact: Artifact = {
      version: '1',
      components: [
        { component: 'RecordTable', props: { objectKey: 'invoice' } },
        { component: 'Text', props: { value: 'kept' } },
      ],
    };
    const { artifact: repaired, notes } = repairArtifact(artifact, objectsByKey);
    expect(repaired.components).toHaveLength(1);
    expect(repaired.components[0]?.component).toBe('Text');
    expect(notes.some((n) => n.includes("unknown object 'invoice'"))).toBe(true);
  });

  it('drops filters/sorts/columns on unknown fields but keeps the node', () => {
    const artifact: Artifact = {
      version: '1',
      components: [
        {
          component: 'RecordTable',
          props: {
            objectKey: 'deal',
            filters: [
              { fieldKey: 'stage', op: 'eq', value: 'Won' },
              { fieldKey: 'ghost', op: 'eq', value: 'x' },
            ],
            sort: [{ fieldKey: 'ghost', direction: 'desc' }],
            columns: ['stage', 'ghost', 'amount'],
          },
        },
      ],
    };
    const { artifact: repaired, notes } = repairArtifact(artifact, objectsByKey);
    const props = repaired.components[0]?.props as Record<string, unknown>;
    expect(props.filters).toEqual([{ fieldKey: 'stage', op: 'eq', value: 'Won' }]);
    expect(props.sort).toBeUndefined();
    expect(props.columns).toEqual(['stage', 'amount']);
    expect(notes.length).toBeGreaterThan(0);
  });

  it('downgrades non-numeric measures to count and drops ungroupable charts', () => {
    const artifact: Artifact = {
      version: '1',
      components: [
        {
          component: 'Metric',
          props: { label: 'x', objectKey: 'deal', fn: 'sum', fieldKey: 'notes' },
        },
        { component: 'Chart', props: { objectKey: 'deal', groupBy: 'amount', fn: 'count' } },
      ],
    };
    const { artifact: repaired, notes } = repairArtifact(artifact, objectsByKey);
    expect(repaired.components).toHaveLength(1);
    const metric = repaired.components[0]?.props as Record<string, unknown>;
    expect(metric.fn).toBe('count');
    expect(metric.fieldKey).toBeUndefined();
    expect(notes.some((n) => n.includes("isn't groupable"))).toBe(true);
  });

  it('accepts date group-bys, defaulting or stripping the grain as needed', () => {
    const valid = repairArtifact(
      chartArtifact({
        objectKey: 'deal',
        groupBy: 'close_date',
        dateGrain: 'quarter',
        fn: 'count',
        chartType: 'line',
      }),
      objectsByKey,
    );
    expect(valid.notes).toEqual([]);
    expect(chartProps(valid.artifact).dateGrain).toBe('quarter');

    const badGrain = repairArtifact(
      chartArtifact({ objectKey: 'deal', groupBy: 'close_date', dateGrain: 'decade', fn: 'count' }),
      objectsByKey,
    );
    expect(chartProps(badGrain.artifact).dateGrain).toBe('month');
    expect(badGrain.notes.some((n) => n.includes('dateGrain'))).toBe(true);

    const grainOnPicklist = repairArtifact(
      chartArtifact({ objectKey: 'deal', groupBy: 'stage', dateGrain: 'month', fn: 'count' }),
      objectsByKey,
    );
    expect(chartProps(grainOnPicklist.artifact).dateGrain).toBeUndefined();
  });

  it('validates groupBy2 and the chart-shape coherence rules', () => {
    const kept = repairArtifact(
      chartArtifact({
        objectKey: 'deal',
        groupBy: 'close_date',
        dateGrain: 'month',
        groupBy2: 'stage',
        fn: 'sum',
        measure: 'amount',
        chartType: 'bar',
        stacked: true,
      }),
      objectsByKey,
    );
    expect(kept.notes).toEqual([]);
    expect(chartProps(kept.artifact).groupBy2).toBe('stage');
    expect(chartProps(kept.artifact).stacked).toBe(true);

    const unknownGroup2 = repairArtifact(
      chartArtifact({
        objectKey: 'deal',
        groupBy: 'stage',
        groupBy2: 'ghost',
        fn: 'count',
        chartType: 'matrix',
      }),
      objectsByKey,
    );
    const p = chartProps(unknownGroup2.artifact);
    expect(p.groupBy2).toBeUndefined();
    expect(p.chartType).toBe('table'); // matrix without groupBy2 degrades
    expect(p.stacked).toBeUndefined();
  });

  it('normalizes unknown chart types and fn/shape mismatches', () => {
    const unknown = repairArtifact(
      chartArtifact({ objectKey: 'deal', groupBy: 'stage', fn: 'count', chartType: 'sparkline' }),
      objectsByKey,
    );
    expect(chartProps(unknown.artifact).chartType).toBe('bar');

    const scatterCount = repairArtifact(
      chartArtifact({ objectKey: 'deal', groupBy: 'stage', fn: 'count', chartType: 'scatter' }),
      objectsByKey,
    );
    expect(chartProps(scatterCount.artifact).chartType).toBe('bar');

    const donutMin = repairArtifact(
      chartArtifact({
        objectKey: 'deal',
        groupBy: 'stage',
        fn: 'min',
        measure: 'amount',
        chartType: 'donut',
      }),
      objectsByKey,
    );
    expect(chartProps(donutMin.artifact).chartType).toBe('bar');

    // min/max on a non-numeric measure downgrade to count (same as sum/avg).
    const minText = repairArtifact(
      chartArtifact({ objectKey: 'deal', groupBy: 'stage', fn: 'max', measure: 'notes' }),
      objectsByKey,
    );
    expect(chartProps(minText.artifact).fn).toBe('count');
  });

  it('strips the fold limit from time-series charts', () => {
    const r = repairArtifact(
      chartArtifact({
        objectKey: 'deal',
        groupBy: 'close_date',
        fn: 'count',
        chartType: 'line',
        limit: 8,
      }),
      objectsByKey,
    );
    expect(chartProps(r.artifact).limit).toBeUndefined();
  });

  it('repairs SectionCard children and collapses to an EmptyState when nothing survives', () => {
    const artifact: Artifact = {
      version: '1',
      components: [
        {
          component: 'SectionCard',
          props: { title: 'Broken' },
          children: [{ component: 'RecordGrid', props: { objectKey: 'nope' } }],
        },
      ],
    };
    const { artifact: repaired } = repairArtifact(artifact, objectsByKey);
    expect(repaired.components).toHaveLength(1);
    expect(repaired.components[0]?.component).toBe('EmptyState');
  });
});

/* ── Metric compare + relative-date tokens ──────────────────────────────── */

function metricArtifact(props: Record<string, unknown>): Artifact {
  return { version: '1', components: [{ component: 'Metric', props }] };
}
function metricProps(a: Artifact): Record<string, unknown> {
  return (a.components[0]?.props ?? {}) as Record<string, unknown>;
}

describe('repairArtifact — Metric compare', () => {
  it('keeps a valid compare and strips a co-existing free-text delta', () => {
    const r = repairArtifact(
      metricArtifact({
        objectKey: 'deal',
        fn: 'count',
        compare: { dateFieldKey: 'close_date', period: 'month' },
        delta: '+12% vs last month',
      }),
      objectsByKey,
    );
    expect(metricProps(r.artifact).compare).toEqual({
      dateFieldKey: 'close_date',
      period: 'month',
    });
    expect(metricProps(r.artifact).delta).toBeUndefined();
  });

  it('drops compare on a non-date field', () => {
    const r = repairArtifact(
      metricArtifact({
        objectKey: 'deal',
        fn: 'count',
        compare: { dateFieldKey: 'stage', period: 'month' },
      }),
      objectsByKey,
    );
    expect(metricProps(r.artifact).compare).toBeUndefined();
    expect(r.notes.some((n) => n.includes('compare'))).toBe(true);
  });

  it('drops compare with an unknown period', () => {
    const r = repairArtifact(
      metricArtifact({
        objectKey: 'deal',
        fn: 'count',
        compare: { dateFieldKey: 'close_date', period: 'fortnight' },
      }),
      objectsByKey,
    );
    expect(metricProps(r.artifact).compare).toBeUndefined();
  });

  it('leaves a legacy free-text delta alone when no compare exists', () => {
    const r = repairArtifact(
      metricArtifact({ objectKey: 'deal', fn: 'count', delta: '+3 this week' }),
      objectsByKey,
    );
    expect(metricProps(r.artifact).delta).toBe('+3 this week');
  });
});

describe('repairArtifact — relative-date filter tokens', () => {
  it('keeps a known token on a date field', () => {
    const r = repairArtifact(
      chartArtifact({
        objectKey: 'deal',
        groupBy: 'stage',
        fn: 'count',
        filters: [{ fieldKey: 'close_date', op: 'gte', value: '@-30d' }],
      }),
      objectsByKey,
    );
    expect(chartProps(r.artifact).filters).toEqual([
      { fieldKey: 'close_date', op: 'gte', value: '@-30d' },
    ]);
    expect(r.notes).toEqual([]);
  });

  it('drops unknown tokens and tokens on non-date fields', () => {
    const r = repairArtifact(
      chartArtifact({
        objectKey: 'deal',
        groupBy: 'stage',
        fn: 'count',
        filters: [
          { fieldKey: 'close_date', op: 'gte', value: '@yesterday' },
          { fieldKey: 'stage', op: 'eq', value: '@-30d' },
          { fieldKey: 'stage', op: 'eq', value: 'Won' },
        ],
      }),
      objectsByKey,
    );
    expect(chartProps(r.artifact).filters).toEqual([{ fieldKey: 'stage', op: 'eq', value: 'Won' }]);
    expect(r.notes).toHaveLength(2);
  });
});

describe('buildSystemPrompt — dates everywhere contract', () => {
  it('documents relative tokens and the compare spec, and forbids invented deltas', () => {
    const prompt = buildSystemPrompt(object, fields, summary);
    expect(prompt).toContain("'@-30d'");
    expect(prompt).toContain("'@startOfQuarter'");
    expect(prompt).toContain('compare?: { dateFieldKey: string');
    expect(prompt).toContain('NEVER write a `delta` string');
  });
});

/* ── Actions ────────────────────────────────────────────────────────────── */

const dealFieldsWithOptions = [
  ...dealFields.filter((f) => f.key !== 'stage'),
  {
    key: 'stage',
    label: 'Stage',
    type: 'picklist',
    config: { options: [{ value: 'Won' }, { value: 'Lost' }] },
  },
] as FieldRow[];
const objectsWithOptions = new Map([['deal', dealFieldsWithOptions]]);

describe('repairArtifact — ActionBar', () => {
  function actionBar(items: unknown[]): Artifact {
    return { version: '1', components: [{ component: 'ActionBar', props: { items } }] };
  }
  function items(a: Artifact): unknown[] {
    return (a.components[0]?.props as { items?: unknown[] })?.items ?? [];
  }

  it('keeps vocabulary actions and drops unknown kinds / objects', () => {
    const r = repairArtifact(
      actionBar([
        { kind: 'createRecord', label: 'New deal', objectKey: 'deal' },
        { kind: 'navigate', label: 'View ghosts', objectKey: 'ghost' },
        { kind: 'openComposer', label: 'Analyze', prompt: 'Analyze churn' },
        { kind: 'deleteEverything', label: 'Nope' },
      ]),
      objectsByKey,
    );
    expect(items(r.artifact)).toEqual([
      { kind: 'createRecord', label: 'New deal', objectKey: 'deal', defaults: undefined },
      { kind: 'openComposer', label: 'Analyze', prompt: 'Analyze churn' },
    ]);
    expect(r.notes).toHaveLength(2);
  });

  it('strips unknown default keys on createRecord', () => {
    const r = repairArtifact(
      actionBar([
        {
          kind: 'createRecord',
          label: 'New deal',
          objectKey: 'deal',
          defaults: { stage: 'Won', ghost_field: 'x' },
        },
      ]),
      objectsByKey,
    );
    expect(items(r.artifact)[0]).toMatchObject({ defaults: { stage: 'Won' } });
    expect(r.notes.some((n) => n.includes('default'))).toBe(true);
  });

  it('removes an ActionBar whose actions all fail (falls into EmptyState alone)', () => {
    const r = repairArtifact(
      actionBar([{ kind: 'navigate', label: 'x', objectKey: 'nope' }]),
      objectsByKey,
    );
    expect(r.artifact.components[0]?.component).toBe('EmptyState');
  });
});

describe('repairArtifact — rowAction', () => {
  function listWith(rowAction: unknown): Artifact {
    return {
      version: '1',
      components: [{ component: 'RecordList', props: { objectKey: 'deal', rowAction } }],
    };
  }
  function rowActionOf(a: Artifact): unknown {
    return (a.components[0]?.props as { rowAction?: unknown })?.rowAction;
  }

  it('keeps a setField whose picklist value is a real option', () => {
    const r = repairArtifact(
      listWith({ kind: 'setField', label: 'Mark won', fieldKey: 'stage', value: 'Won' }),
      objectsWithOptions,
    );
    expect(rowActionOf(r.artifact)).toEqual({
      kind: 'setField',
      label: 'Mark won',
      fieldKey: 'stage',
      value: 'Won',
    });
  });

  it('drops a setField with an invented picklist value', () => {
    const r = repairArtifact(
      listWith({ kind: 'setField', label: 'Mark maybe', fieldKey: 'stage', value: 'Maybe' }),
      objectsWithOptions,
    );
    expect(rowActionOf(r.artifact)).toBeUndefined();
    expect(r.notes.some((n) => n.includes("isn't an option"))).toBe(true);
  });

  it('drops a setField on an unsupported field type', () => {
    const r = repairArtifact(
      listWith({ kind: 'setField', label: 'Bump', fieldKey: 'amount', value: 100 }),
      objectsWithOptions,
    );
    expect(rowActionOf(r.artifact)).toBeUndefined();
  });
});

describe('buildSystemPrompt — actions contract', () => {
  it('documents the ActionBar vocabulary and restraint rules', () => {
    const prompt = buildSystemPrompt(object, fields, summary);
    expect(prompt).toContain('ActionBar');
    expect(prompt).toContain("kind: 'createRecord'");
    expect(prompt).toContain("kind: 'setField'");
    expect(prompt).toContain('Never invent option values');
    expect(prompt).toContain('Include ONE at most');
  });
});

/* ── Detail mode (record pages) ─────────────────────────────────────────── */

const accountFieldsForDetail = [
  { key: 'industry', label: 'Industry', type: 'picklist' },
] as FieldRow[];
const dealFieldsWithRef = [
  ...dealFields,
  {
    key: 'account',
    label: 'Account',
    type: 'reference',
    config: { targetObject: 'account' },
  },
] as FieldRow[];
const detailObjects = new Map([
  ['account', accountFieldsForDetail],
  ['deal', dealFieldsWithRef],
]);
const detailOpts = { mode: 'detail' as const, baseObjectKey: 'account' };

describe('repairArtifact — record-context components', () => {
  it('keeps a valid RelatedList and strips unknown RecordFields keys', () => {
    const artifact: Artifact = {
      version: '1',
      components: [
        { component: 'RecordFields', props: { fieldKeys: ['industry', 'ghost'] } },
        { component: 'RelatedList', props: { objectKey: 'deal', refFieldKey: 'account' } },
        { component: 'StagePath', props: {} },
      ],
    };
    const r = repairArtifact(artifact, detailObjects, detailOpts);
    expect(r.artifact.components).toHaveLength(3);
    expect(r.artifact.components[0]?.props?.fieldKeys).toEqual(['industry']);
  });

  it('removes a RelatedList whose refFieldKey does not point back at the base object', () => {
    const artifact: Artifact = {
      version: '1',
      components: [
        { component: 'RelatedList', props: { objectKey: 'deal', refFieldKey: 'stage' } },
      ],
    };
    const r = repairArtifact(artifact, detailObjects, detailOpts);
    expect(r.artifact.components[0]?.component).toBe('EmptyState');
    expect(r.notes.some((n) => n.includes('RelatedList'))).toBe(true);
  });

  it('drops record-context components entirely outside detail mode', () => {
    const artifact: Artifact = {
      version: '1',
      components: [
        { component: 'Text', props: { value: 'hi' } },
        { component: 'RecordFields', props: { fieldKeys: ['industry'] } },
      ],
    };
    const r = repairArtifact(artifact, detailObjects); // dashboard mode
    expect(r.artifact.components).toHaveLength(1);
    expect(r.artifact.components[0]?.component).toBe('Text');
  });
});

describe('buildSystemPrompt — detail mode contract', () => {
  const account = { key: 'account', label: 'Account', labelPlural: 'Accounts' } as ObjectRow;
  const deal = { key: 'deal', label: 'Deal', labelPlural: 'Deals' } as ObjectRow;

  it('teaches the record components, @record scoping, and RelatedList candidates', () => {
    const prompt = buildSystemPrompt(
      account,
      accountFieldsForDetail,
      null,
      undefined,
      [{ object: deal, fields: dealFieldsWithRef }],
      'detail',
    );
    expect(prompt).toContain('RECORD PAGE MODE');
    expect(prompt).toContain("value: '@record'");
    expect(prompt).toContain("{ objectKey: 'deal', refFieldKey: 'account' }");
    expect(prompt).toContain('do NOT emit PageHeader');
  });

  it('dashboard mode carries none of the record-page section', () => {
    const prompt = buildSystemPrompt(account, accountFieldsForDetail, null, undefined, [
      { object: deal, fields: dealFieldsWithRef },
    ]);
    expect(prompt).not.toContain('RECORD PAGE MODE');
  });
});

/* ── QueryBlock (advanced queries) ──────────────────────────────────────── */

describe('repairArtifact — QueryBlock', () => {
  function queryBlock(query: unknown): Artifact {
    return { version: '1', components: [{ component: 'QueryBlock', props: { query } }] };
  }

  it('keeps a resolvable spec (expression measure + having)', () => {
    const r = repairArtifact(
      queryBlock({
        objectKey: 'deal',
        groupBy: [{ fieldKey: 'stage' }],
        measures: [
          { id: 'total', fn: 'sum', fieldKey: 'amount' },
          { id: 'n', fn: 'count' },
          { id: 'per', expr: { op: '/', left: { ref: 'total' }, right: { ref: 'n' } } },
        ],
        having: [{ measure: 'count', op: 'gte', value: 3 }],
      }),
      objectsByKey,
    );
    expect(r.artifact.components[0]?.component).toBe('QueryBlock');
    expect(r.notes).toEqual([]);
  });

  it('drops a spec with an unknown measure field', () => {
    const r = repairArtifact(
      queryBlock({
        objectKey: 'deal',
        measures: [{ id: 'm', fn: 'sum', fieldKey: 'ghost' }],
      }),
      objectsByKey,
    );
    expect(r.artifact.components[0]?.component).toBe('EmptyState');
    expect(r.notes.some((n) => n.includes('QueryBlock'))).toBe(true);
  });

  it('drops a malformed spec (zod caps, e.g. expr chained off an expr)', () => {
    const r = repairArtifact(
      queryBlock({
        objectKey: 'deal',
        measures: [
          { id: 'a', fn: 'count' },
          { id: 'b', expr: { op: '+', left: { ref: 'a' }, right: { value: 1 } } },
          { id: 'c', expr: { op: '+', left: { ref: 'b' }, right: { value: 1 } } },
        ],
      }),
      objectsByKey,
    );
    expect(r.artifact.components[0]?.component).toBe('EmptyState');
  });
});

describe('buildSystemPrompt — QueryBlock contract', () => {
  it('teaches the advanced query shape with a prefer-Chart/Metric rule', () => {
    const prompt = buildSystemPrompt(object, fields, summary);
    expect(prompt).toContain('QueryBlock');
    expect(prompt).toContain('exists');
    expect(prompt).toContain('Prefer Chart/Metric');
  });
});
