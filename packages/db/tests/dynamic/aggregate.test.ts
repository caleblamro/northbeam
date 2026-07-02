// buildAggregateQuery is the SQL twin of the report renderer: one statement,
// identifiers through qid()/qualified(), every value parameterized, and the
// SAME visibility (aclPredicate) + filter (buildFilterPredicates) clauses that
// listRecords applies — a report must never count a row a list would hide.
// These tests render the query with PgDialect and assert its shape + params,
// the same contract-guarding idea as the filters-sql parity test.

import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
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

describe('buildAggregateQuery', () => {
  it('builds a grouped sum with quoted identifiers and a bound limit', () => {
    const q = render(
      buildAggregateQuery({
        orgId: 'abc',
        object: object(),
        fields: [stage, amount],
        groupBy: stage,
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

  it('emits single-row totals without GROUP BY when groupBy is absent', () => {
    const q = render(
      buildAggregateQuery({
        orgId: 'abc',
        object: object(),
        fields: [stage, amount],
        groupBy: null,
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
        groupBy: stage,
        measure: { fn: 'count' },
        filters: [],
      }),
    );
    expect(q.sql).toContain('count(*)::numeric as v');
  });

  it('throws when sum/avg is missing its measure field', () => {
    expect(() =>
      buildAggregateQuery({
        orgId: 'abc',
        object: object(),
        fields: [stage],
        groupBy: stage,
        measure: { fn: 'sum' },
        filters: [],
      }),
    ).toThrow(/requires a measure field/);
  });

  it('pushes filters through buildFilterPredicates (params bound, unknown keys dropped)', () => {
    const q = render(
      buildAggregateQuery({
        orgId: 'abc',
        object: object(),
        fields: [stage, amount],
        groupBy: stage,
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
        groupBy: stage,
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
          groupBy: stage,
          measure: { fn: 'count' },
          filters: [],
          acl: { userId: 'u1', sharedRecordIds: [], isAdminish: opts.isAdminish },
        }),
      );
      expect(q.sql).not.toContain('owner_id');
    }
  });

  it('clamps the bucket limit to 200', () => {
    const q = render(
      buildAggregateQuery({
        orgId: 'abc',
        object: object(),
        fields: [stage],
        groupBy: stage,
        measure: { fn: 'count' },
        filters: [],
        limit: 9999,
      }),
    );
    expect(q.params).toEqual([200]);
  });
});
