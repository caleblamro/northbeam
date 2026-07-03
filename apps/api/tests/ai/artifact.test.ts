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
    expect(prompt).not.toContain('Refinement mode');
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

  it('appends the refinement section with the current artifact', () => {
    const prompt = buildSystemPrompt(object, fields, summary, validArtifact);
    expect(prompt).toContain('# Refinement mode');
    expect(prompt).toContain(JSON.stringify(validArtifact));
    expect(prompt).toContain('keep every node the');
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
