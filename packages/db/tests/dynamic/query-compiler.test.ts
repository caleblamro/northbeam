// QuerySpec compiler contract: the compiler is the security boundary, so
// these tests pin the SQL shape — bound values, generated-only identifiers,
// mandatory ACL, exists correlation, nullif-guarded division — and that
// resolution rejects anything that doesn't fully resolve.

import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  type QuerySpecLike,
  buildQuery,
  collectQueryTargetKeys,
  resolveQuerySpec,
} from '../../src/dynamic/query-compiler.js';
import type { FieldRow, ObjectRow, ObjectWithFields } from '../../src/queries/crm.js';

const dialect = new PgDialect();
const render = (q: SQL) => dialect.sqlToQuery(q);

function object(key: string, tableName: string): ObjectRow {
  return { id: `o_${key}`, organizationId: 'abc', key, tableName } as ObjectRow;
}
function field(overrides: Partial<FieldRow>): FieldRow {
  return { id: 'f', organizationId: 'abc', config: {}, ...overrides } as FieldRow;
}

const deal: ObjectWithFields = {
  object: object('deal', 't_deal'),
  fields: [
    field({ key: 'stage', columnName: 'f_stage', type: 'picklist' }),
    field({ key: 'amount', columnName: 'f_amount', type: 'currency' }),
    field({ key: 'owner', columnName: 'f_owner', type: 'reference', config: {} }),
  ],
};
const activity: ObjectWithFields = {
  object: object('activity', 't_activity'),
  fields: [
    field({
      key: 'deal',
      columnName: 'f_deal',
      type: 'reference',
      config: { targetObject: 'deal' },
    }),
    field({ key: 'subject', columnName: 'f_subject', type: 'text' }),
  ],
};
const targets = new Map([['activity', activity]]);
const ACL = { userId: 'u1', sharedRecordIds: [], isAdminish: true };

function plan(spec: QuerySpecLike) {
  const r = resolveQuerySpec(deal, targets, spec);
  if (!r.ok) throw new Error(r.message);
  return r.plan;
}

describe('resolveQuerySpec', () => {
  it('rejects unknown fields, paths, and measure refs', () => {
    const bad = (spec: QuerySpecLike) => {
      const r = resolveQuerySpec(deal, targets, spec);
      expect(r.ok).toBe(false);
      return r.ok ? '' : r.message;
    };
    expect(
      bad({ objectKey: 'deal', measures: [{ id: 'm', fn: 'sum', fieldKey: 'ghost' }] }),
    ).toContain("can't be sum'd");
    expect(
      bad({
        objectKey: 'deal',
        measures: [{ id: 'm', fn: 'count' }],
        groupBy: [{ fieldKey: 'ghost.path' }],
      }),
    ).toContain('reference path');
    expect(
      bad({
        objectKey: 'deal',
        measures: [{ id: 'm', fn: 'count' }],
        having: [{ measure: 'nope', op: 'gte', value: 1 }],
      }),
    ).toContain('unknown measure');
  });

  it('rejects an exists whose refFieldKey does not point back at the base', () => {
    const r = resolveQuerySpec(deal, targets, {
      objectKey: 'deal',
      measures: [{ id: 'm', fn: 'count' }],
      where: { exists: { objectKey: 'activity', refFieldKey: 'subject' } },
    });
    expect(r.ok).toBe(false);
  });

  it('collects exists children as load targets', () => {
    expect(
      collectQueryTargetKeys(deal, {
        objectKey: 'deal',
        measures: [{ id: 'm', fn: 'count' }],
        where: {
          all: [
            { fieldKey: 'stage', op: 'eq', value: 'Won' },
            { exists: { objectKey: 'activity', refFieldKey: 'deal' } },
          ],
        },
      }),
    ).toEqual(['activity']);
  });
});

describe('buildQuery', () => {
  it('always carries the acl predicate for restricted callers', () => {
    const restricted = { userId: 'u1', sharedRecordIds: ['r1'], isAdminish: false };
    const privateDeal: ObjectWithFields = {
      ...deal,
      object: { ...deal.object, defaultVisibility: 'private' } as ObjectRow,
    };
    const r = resolveQuerySpec(privateDeal, targets, {
      objectKey: 'deal',
      measures: [{ id: 'm', fn: 'count' }],
    });
    if (!r.ok) throw new Error(r.message);
    const q = render(buildQuery('abc', r.plan, restricted));
    expect(q.sql).toContain('"owner_id"');
  });

  it('compiles a negated exists with correlated child predicates', () => {
    const q = render(
      buildQuery(
        'abc',
        plan({
          objectKey: 'deal',
          measures: [{ id: 'total', fn: 'count' }],
          where: {
            exists: {
              objectKey: 'activity',
              refFieldKey: 'deal',
              where: { fieldKey: 'subject', op: 'contains', value: 'call' },
            },
            negate: true,
          },
        }),
        ACL,
      ),
    );
    expect(q.sql).toContain(
      'not exists (select 1 from "org_abc"."t_activity" c where c."f_deal" = b."id"',
    );
    expect(q.sql).toContain('"c"."f_subject"');
    expect(q.params).toContain('%call%');
  });

  it('inlines expression measures with a nullif-guarded division', () => {
    const q = render(
      buildQuery(
        'abc',
        plan({
          objectKey: 'deal',
          groupBy: [{ fieldKey: 'stage' }],
          measures: [
            { id: 'total', fn: 'sum', fieldKey: 'amount' },
            { id: 'n', fn: 'count' },
            { id: 'per', expr: { op: '/', left: { ref: 'total' }, right: { ref: 'n' } } },
          ],
        }),
        ACL,
      ),
    );
    // Positional aliases only — measure ids never become SQL identifiers.
    expect(q.sql).toContain('as "m0"');
    expect(q.sql).toContain('as "m2"');
    expect(q.sql).not.toContain('"per"');
    expect(q.sql).toContain('/ nullif(count(*)::numeric, 0)');
  });

  it('emits having over inlined aggregates and a bound limit', () => {
    const q = render(
      buildQuery(
        'abc',
        plan({
          objectKey: 'deal',
          groupBy: [{ fieldKey: 'stage' }],
          measures: [{ id: 'total', fn: 'sum', fieldKey: 'amount' }],
          having: [{ measure: 'count', op: 'gte', value: 5 }],
          limit: 25,
        }),
        ACL,
      ),
    );
    expect(q.sql).toContain('having count(*) >= $');
    expect(q.params).toContain(5);
    expect(q.params).toContain(25);
  });

  it('AND/OR trees parenthesize and bind every value', () => {
    const q = render(
      buildQuery(
        'abc',
        plan({
          objectKey: 'deal',
          measures: [{ id: 'm', fn: 'count' }],
          where: {
            any: [
              { fieldKey: 'stage', op: 'eq', value: 'Won' },
              {
                all: [
                  { fieldKey: 'amount', op: 'gt', value: 50000 },
                  { fieldKey: 'stage', op: 'neq', value: 'Lost' },
                ],
              },
            ],
          },
        }),
        ACL,
      ),
    );
    expect(q.sql).toContain(' or ');
    expect(q.sql).toContain(' and ');
    expect(q.params).toEqual(expect.arrayContaining(['Won', 50000, 'Lost']));
  });
});

describe('buildQuery — distribution fns + window measures', () => {
  const closeDate = field({ key: 'close_date', columnName: 'f_close_date', type: 'date' });
  const dealWithDate: ObjectWithFields = {
    object: deal.object,
    fields: [...deal.fields, closeDate],
  };
  const planFor = (spec: QuerySpecLike) => {
    const r = resolveQuerySpec(dealWithDate, targets, spec);
    if (!r.ok) throw new Error(r.message);
    return r.plan;
  };

  it('p90 and stddev compile to percentile_cont / stddev_samp', () => {
    const q = render(
      buildQuery(
        'abc',
        planFor({
          objectKey: 'deal',
          groupBy: [{ fieldKey: 'stage' }],
          measures: [
            { id: 'p', fn: 'p90', fieldKey: 'amount' },
            { id: 's', fn: 'stddev', fieldKey: 'amount' },
          ],
        }),
        ACL,
      ),
    );
    expect(q.sql).toContain('percentile_cont(0.9) within group');
    expect(q.sql).toContain('stddev_samp("f_amount"::numeric)');
  });

  it('share wraps the select expr in a grand-total window; having stays base', () => {
    const q = render(
      buildQuery(
        'abc',
        planFor({
          objectKey: 'deal',
          groupBy: [{ fieldKey: 'stage' }],
          measures: [{ id: 'total', fn: 'sum', fieldKey: 'amount', share: true }],
          having: [{ measure: 'total', op: 'gt', value: 0 }],
        }),
        ACL,
      ),
    );
    expect(q.sql).toContain('/ nullif(sum(coalesce(sum("f_amount"), 0)::numeric) over (), 0)');
    // HAVING references the base aggregate, never the window.
    expect(q.sql).toContain('having coalesce(sum("f_amount"), 0)::numeric > $');
  });

  it('cumulative runs a total over the date-group expression and forces chronological order', () => {
    const q = render(
      buildQuery(
        'abc',
        planFor({
          objectKey: 'deal',
          groupBy: [{ fieldKey: 'close_date', grain: 'month' }],
          measures: [{ id: 'run', fn: 'sum', fieldKey: 'amount', cumulative: true }],
          orderBy: { ref: 'run', direction: 'desc' },
        }),
        ACL,
      ),
    );
    expect(q.sql).toContain('over (order by (date_trunc(');
    expect(q.sql).toContain('order by 1 asc nulls last');
  });

  it('rejects cumulative without a single date grouping and share without groups', () => {
    expect(
      resolveQuerySpec(dealWithDate, targets, {
        objectKey: 'deal',
        groupBy: [{ fieldKey: 'stage' }],
        measures: [{ id: 'm', fn: 'count', cumulative: true }],
      }).ok,
    ).toBe(false);
    expect(
      resolveQuerySpec(dealWithDate, targets, {
        objectKey: 'deal',
        measures: [{ id: 'm', fn: 'count', share: true }],
      }).ok,
    ).toBe(false);
  });
});
