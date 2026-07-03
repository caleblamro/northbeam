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
