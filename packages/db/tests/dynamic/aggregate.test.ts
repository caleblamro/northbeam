// buildAggregateQuery is the SQL twin of the report renderer: one statement,
// identifiers through qid()/qualified(), every value parameterized, and the
// SAME visibility (aclPredicate) + filter (buildFilterPredicates) clauses that
// listRecords applies — a report must never count a row a list would hide.
// These tests render the query with PgDialect and assert its shape + params,
// the same contract-guarding idea as the filters-sql parity test.

import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import type { DateGrain } from '../../src/dynamic/aggregate.js';
import { buildAggregateQuery } from '../../src/dynamic/aggregate.js';
import type { FieldRow, ObjectRow } from '../../src/queries/crm.js';

const dialect = new PgDialect();
const render = (q: SQL) => dialect.sqlToQuery(q);

function object(overrides: Partial<ObjectRow> = {}): ObjectRow {
  // Minimal ObjectRow stub — only the keys the query builder reads.
  return {
    id: 'o1',
    organizationId: 'abc',
    key: 'deal',
    tableName: 't_deal',
    defaultVisibility: 'public',
    ...overrides,
  } as ObjectRow;
}

function field(overrides: Partial<FieldRow>): FieldRow {
  return {
    id: 'f1',
    organizationId: 'abc',
    objectId: 'o1',
    key: overrides.key ?? 'stage',
    columnName: overrides.columnName ?? 'f_stage',
    type: overrides.type ?? 'picklist',
    config: {},
    ...overrides,
  } as FieldRow;
}

const stage = field({ key: 'stage', columnName: 'f_stage', type: 'picklist' });
const amount = field({ key: 'amount', columnName: 'f_amount', type: 'currency' });
const closeDate = field({ key: 'close_date', columnName: 'f_close_date', type: 'date' });
const tags = field({ key: 'tags', columnName: 'f_tags', type: 'multipicklist' });

describe('buildAggregateQuery', () => {
  it('builds a grouped sum with quoted identifiers and a bound limit', () => {
    const q = render(
      buildAggregateQuery({
        orgId: 'abc',
        object: object(),
        fields: [stage, amount],
        groups: [{ field: stage }],
        measure: { fn: 'sum', field: amount },
        filters: [],
        limit: 10,
      }),
    );
    expect(q.sql).toContain(
      'select "f_stage" as g, coalesce(sum("f_amount"), 0)::numeric as v, count(*)::int as n from "org_abc"."t_deal"',
    );
    expect(q.sql).toContain('group by 1 order by v desc nulls last limit $1');
    expect(q.params).toEqual([10]);
  });

  it('emits single-row totals without GROUP BY when no grouping is given', () => {
    const q = render(
      buildAggregateQuery({
        orgId: 'abc',
        object: object(),
        fields: [stage, amount],
        groups: [],
        measure: { fn: 'avg', field: amount },
        filters: [],
      }),
    );
    expect(q.sql).toContain('select null as g, avg("f_amount")::numeric as v, count(*)::int as n');
    expect(q.sql).not.toContain('group by');
    expect(q.sql).not.toContain('limit');
  });

  it('counts rows without a measure field', () => {
    const q = render(
      buildAggregateQuery({
        orgId: 'abc',
        object: object(),
        fields: [stage],
        groups: [{ field: stage }],
        measure: { fn: 'count' },
        filters: [],
      }),
    );
    expect(q.sql).toContain('count(*)::numeric as v');
  });

  it('emits min/max aggregates over the measure column', () => {
    for (const fn of ['min', 'max'] as const) {
      const q = render(
        buildAggregateQuery({
          orgId: 'abc',
          object: object(),
          fields: [stage, amount],
          groups: [{ field: stage }],
          measure: { fn, field: amount },
          filters: [],
        }),
      );
      expect(q.sql).toContain(`${fn}("f_amount")::numeric as v`);
    }
  });

  it('throws when a non-count aggregate is missing its measure field', () => {
    for (const fn of ['sum', 'avg', 'min', 'max'] as const) {
      expect(() =>
        buildAggregateQuery({
          orgId: 'abc',
          object: object(),
          fields: [stage],
          groups: [{ field: stage }],
          measure: { fn },
          filters: [],
        }),
      ).toThrow(/requires a measure field/);
    }
  });

  it('buckets date fields with date_trunc, ordered chronologically', () => {
    const q = render(
      buildAggregateQuery({
        orgId: 'abc',
        object: object(),
        fields: [closeDate, amount],
        groups: [{ field: closeDate, grain: 'quarter' }],
        measure: { fn: 'sum', field: amount },
        filters: [],
      }),
    );
    expect(q.sql).toContain(`(date_trunc('quarter', "f_close_date"))::date::text as g`);
    expect(q.sql).toContain('group by 1 order by 1 asc nulls last limit $1');
  });

  it("defaults the date grain to 'month'", () => {
    const q = render(
      buildAggregateQuery({
        orgId: 'abc',
        object: object(),
        fields: [closeDate],
        groups: [{ field: closeDate }],
        measure: { fn: 'count' },
        filters: [],
      }),
    );
    expect(q.sql).toContain(`date_trunc('month', "f_close_date")`);
  });

  it('rejects a grain outside the whitelist (sql.raw injection guard)', () => {
    expect(() =>
      buildAggregateQuery({
        orgId: 'abc',
        object: object(),
        fields: [closeDate],
        groups: [{ field: closeDate, grain: "century', now()); drop table x; --" as DateGrain }],
        measure: { fn: 'count' },
        filters: [],
      }),
    ).toThrow(/unknown date grain/);
  });

  it('groups two levels in one pass, ranking whole primary groups by total', () => {
    const owner = field({ key: 'owner', columnName: 'f_owner', type: 'reference' });
    const q = render(
      buildAggregateQuery({
        orgId: 'abc',
        object: object(),
        fields: [stage, owner, amount],
        groups: [{ field: stage }, { field: owner }],
        measure: { fn: 'sum', field: amount },
        filters: [],
      }),
    );
    expect(q.sql).toContain('select "f_stage" as g, "f_owner" as g2,');
    expect(q.sql).toContain('group by 1, 2');
    expect(q.sql).toContain(
      'order by sum(coalesce(sum("f_amount"), 0)::numeric) over (partition by "f_stage") desc nulls last, 1 asc nulls last, v desc nulls last',
    );
  });

  it('orders two-level date primaries chronologically instead of by total', () => {
    const q = render(
      buildAggregateQuery({
        orgId: 'abc',
        object: object(),
        fields: [closeDate, stage],
        groups: [{ field: closeDate, grain: 'month' }, { field: stage }],
        measure: { fn: 'count' },
        filters: [],
      }),
    );
    expect(q.sql).toContain('group by 1, 2 order by 1 asc nulls last, v desc nulls last');
    expect(q.sql).not.toContain('partition by');
  });

  it('explodes multipicklist primaries with a LATERAL unnest, keeping the NULL bucket', () => {
    const q = render(
      buildAggregateQuery({
        orgId: 'abc',
        object: object(),
        fields: [tags, amount],
        groups: [{ field: tags }],
        measure: { fn: 'count' },
        filters: [],
        acl: { userId: 'u1', sharedRecordIds: [], isAdminish: false },
      }),
    );
    expect(q.sql).toContain(`left join lateral unnest(coalesce("f_tags", '{}')) as mp0(e) on true`);
    expect(q.sql).toContain('select mp0.e as g,');
  });

  it('rejects multipicklist as the secondary grouping', () => {
    expect(() =>
      buildAggregateQuery({
        orgId: 'abc',
        object: object(),
        fields: [stage, tags],
        groups: [{ field: stage }, { field: tags }],
        measure: { fn: 'count' },
        filters: [],
      }),
    ).toThrow(/primary grouping/);
  });

  it('pushes filters through buildFilterPredicates (params bound, unknown keys dropped)', () => {
    const q = render(
      buildAggregateQuery({
        orgId: 'abc',
        object: object(),
        fields: [stage, amount],
        groups: [{ field: stage }],
        measure: { fn: 'count' },
        filters: [
          { fieldKey: 'stage', op: 'eq', value: 'closed_won' },
          { fieldKey: 'ghost', op: 'eq', value: 'x' }, // unknown key → dropped
        ],
      }),
    );
    expect(q.sql).toContain('lower("f_stage"::text) = lower($1)');
    expect(q.params).toContain('closed_won');
    expect(q.sql).not.toContain('ghost');
  });

  it('applies the SAME ACL clause as listRecords on private objects', () => {
    const q = render(
      buildAggregateQuery({
        orgId: 'abc',
        object: object({ defaultVisibility: 'private' }),
        fields: [stage],
        groups: [{ field: stage }],
        measure: { fn: 'count' },
        filters: [],
        acl: { userId: 'u1', sharedRecordIds: ['s1'], isAdminish: false },
      }),
    );
    expect(q.sql).toContain('where ("owner_id" = $1 or "id" in ($2::uuid))');
    expect(q.params).toEqual(expect.arrayContaining(['u1', 's1']));
  });

  it('skips the ACL clause for admins and for public objects', () => {
    for (const opts of [
      { object: object({ defaultVisibility: 'private' }), isAdminish: true },
      { object: object({ defaultVisibility: 'public' }), isAdminish: false },
    ]) {
      const q = render(
        buildAggregateQuery({
          orgId: 'abc',
          object: opts.object,
          fields: [stage],
          groups: [{ field: stage }],
          measure: { fn: 'count' },
          filters: [],
          acl: { userId: 'u1', sharedRecordIds: [], isAdminish: opts.isAdminish },
        }),
      );
      expect(q.sql).not.toContain('owner_id');
    }
  });

  it('clamps the bucket limit to 200 with one grouping and 1000 with two', () => {
    const one = render(
      buildAggregateQuery({
        orgId: 'abc',
        object: object(),
        fields: [stage],
        groups: [{ field: stage }],
        measure: { fn: 'count' },
        filters: [],
        limit: 9999,
      }),
    );
    expect(one.params).toEqual([200]);
    const two = render(
      buildAggregateQuery({
        orgId: 'abc',
        object: object(),
        fields: [stage, closeDate],
        groups: [{ field: closeDate }, { field: stage }],
        measure: { fn: 'count' },
        filters: [],
        limit: 9999,
      }),
    );
    expect(two.params).toEqual([1000]);
  });
});

describe('buildAggregateQuery — countDistinct / median / having', () => {
  it('countDistinct emits count(distinct col)', () => {
    const q = render(
      buildAggregateQuery({
        orgId: 'abc',
        object: object(),
        fields: [stage],
        groups: [{ field: stage }],
        measure: { fn: 'countDistinct', field: stage },
        filters: [],
      }),
    );
    expect(q.sql).toContain('count(distinct "f_stage")::numeric');
  });

  it('median emits percentile_cont within group over the numeric cast', () => {
    const q = render(
      buildAggregateQuery({
        orgId: 'abc',
        object: object(),
        fields: [stage, amount],
        groups: [{ field: stage }],
        measure: { fn: 'median', field: amount },
        filters: [],
      }),
    );
    expect(q.sql).toContain(
      '(percentile_cont(0.5) within group (order by "f_amount"::numeric))::numeric',
    );
  });

  it('having binds the threshold and maps ops through the whitelist', () => {
    const q = render(
      buildAggregateQuery({
        orgId: 'abc',
        object: object(),
        fields: [stage],
        groups: [{ field: stage }],
        measure: { fn: 'count' },
        having: { target: 'count', op: 'gte', value: 5 },
        filters: [],
      }),
    );
    expect(q.sql).toContain('group by 1 having count(*) >= $');
    expect(q.params).toContain(5);
  });

  it('having on the measure repeats the aggregate expression', () => {
    const q = render(
      buildAggregateQuery({
        orgId: 'abc',
        object: object(),
        fields: [stage, amount],
        groups: [{ field: stage }],
        measure: { fn: 'sum', field: amount },
        having: { target: 'value', op: 'gt', value: 1000 },
        filters: [],
      }),
    );
    expect(q.sql).toContain('having coalesce(sum("f_amount"), 0)::numeric > $');
  });

  it('having is ignored without groupings', () => {
    const q = render(
      buildAggregateQuery({
        orgId: 'abc',
        object: object(),
        fields: [stage],
        groups: [],
        measure: { fn: 'count' },
        having: { target: 'count', op: 'gte', value: 5 },
        filters: [],
      }),
    );
    expect(q.sql).not.toContain('having');
  });

  it('OR-group filters land parenthesized in the WHERE clause', () => {
    const q = render(
      buildAggregateQuery({
        orgId: 'abc',
        object: object(),
        fields: [stage, amount],
        groups: [{ field: stage }],
        measure: { fn: 'count' },
        filters: [
          {
            any: [
              { fieldKey: 'stage', op: 'eq', value: 'Won' },
              { fieldKey: 'amount', op: 'gt', value: 50000 },
            ],
          },
        ],
      }),
    );
    expect(q.sql).toContain(' or ');
    expect(q.sql).toContain('where (');
  });
});

describe('buildAggregateQuery — dot paths (one-hop reference traversal)', () => {
  const accountObject = {
    id: 'o2',
    organizationId: 'abc',
    key: 'account',
    tableName: 't_account',
    defaultVisibility: 'public',
  } as ObjectRow;
  const accountRef = field({
    key: 'account',
    columnName: 'f_account',
    type: 'reference',
    config: { targetObject: 'account' },
  });
  const industry = field({
    key: 'industry',
    columnName: 'f_industry',
    type: 'picklist',
    objectId: 'o2',
  });
  const tier = field({ key: 'tier', columnName: 'f_tier', type: 'picklist', objectId: 'o2' });
  const via = {
    key: 'account.industry',
    refField: accountRef,
    targetObject: accountObject,
    targetField: industry,
  };

  it('groups by the lateral-exposed remote column with a correlated PK probe', () => {
    const q = render(
      buildAggregateQuery({
        orgId: 'abc',
        object: object(),
        fields: [stage, accountRef],
        groups: [{ field: industry, via }],
        measure: { fn: 'count' },
        filters: [],
      }),
    );
    expect(q.sql).toContain('"org_abc"."t_deal" b left join lateral');
    expect(q.sql).toContain('select t."f_industry" as "p0" from "org_abc"."t_account" t');
    expect(q.sql).toContain('t."id" = b."f_account"');
    expect(q.sql).toContain('select "r0"."p0" as g');
  });

  it('dedupes laterals: filter + group through the same reference share one join', () => {
    const tierPath = {
      key: 'account.tier',
      refField: accountRef,
      targetObject: accountObject,
      targetField: tier,
    };
    const q = render(
      buildAggregateQuery({
        orgId: 'abc',
        object: object(),
        fields: [stage, accountRef],
        groups: [{ field: industry, via }],
        measure: { fn: 'count' },
        filters: [{ fieldKey: 'account.tier', op: 'eq', value: 'Enterprise' }],
        refPaths: [tierPath],
      }),
    );
    const joins = q.sql.match(/left join lateral/g) ?? [];
    expect(joins).toHaveLength(1);
    expect(q.sql).toContain('t."f_tier" as "p1"');
    expect(q.sql).toContain('lower("r0"."p1"::text) = lower($');
  });

  it('no-path queries stay byte-identical to the pre-dot-path shape (no base alias)', () => {
    const q = render(
      buildAggregateQuery({
        orgId: 'abc',
        object: object(),
        fields: [stage, amount],
        groups: [{ field: stage }],
        measure: { fn: 'sum', field: amount },
        filters: [],
        limit: 10,
      }),
    );
    expect(q.sql).not.toContain(' b ');
    expect(q.sql).not.toContain('lateral');
  });

  it('remote date fields get date_trunc over the lateral column', () => {
    const renewal = field({
      key: 'renewal',
      columnName: 'f_renewal',
      type: 'date',
      objectId: 'o2',
    });
    const q = render(
      buildAggregateQuery({
        orgId: 'abc',
        object: object(),
        fields: [stage, accountRef],
        groups: [
          {
            field: renewal,
            grain: 'quarter' as DateGrain,
            via: {
              key: 'account.renewal',
              refField: accountRef,
              targetObject: accountObject,
              targetField: renewal,
            },
          },
        ],
        measure: { fn: 'count' },
        filters: [],
      }),
    );
    expect(q.sql).toContain(`date_trunc('quarter', "r0"."p0")`);
  });
});
