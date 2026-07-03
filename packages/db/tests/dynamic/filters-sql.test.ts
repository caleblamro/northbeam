// The operator-table parity test referenced by src/dynamic/filters-sql.ts.
//
// buildFilterPredicates / buildOrderBy are the SQL twin of the web matcher
// (apps/web/src/lib/filters.ts `matchesFilter` + `compareValues`). These tests
// render the generated SQL with PgDialect and pin down, per FilterOp × field
// type: the exact predicate shape, which values are bound as params (never
// inlined), and which op/type/value combinations are DROPPED rather than
// emitted — the drop rules are what keep a crafted `?filters=` URL or a stale
// saved view from producing a query-killing cast (`'null'::timestamptz`,
// `text::numeric`, `IS TRUE` on a non-boolean). When you change the operator
// table here or in the web matcher, update both plus these assertions.

import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import {
  type FilterField,
  buildFilterPredicates,
  buildOrderBy,
} from '../../src/dynamic/filters-sql.js';
import type { Filter } from '../../src/views.js';

const dialect = new PgDialect();
const render = (q: SQL) => dialect.sqlToQuery(q);

const name: FilterField = { key: 'name', columnName: 'f_name', type: 'text' };
const amount: FilterField = { key: 'amount', columnName: 'f_amount', type: 'currency' };
const closeDate: FilterField = { key: 'close_date', columnName: 'f_close_date', type: 'date' };
const active: FilterField = { key: 'active', columnName: 'f_active', type: 'checkbox' };
const tags: FilterField = { key: 'tags', columnName: 'f_tags', type: 'multipicklist' };
const stage: FilterField = { key: 'stage', columnName: 'f_stage', type: 'picklist' };

const FIELDS: FilterField[] = [name, amount, closeDate, active, tags, stage];

/** Render the single predicate a filter produces (asserting it produced one). */
function one(f: Filter) {
  const [pred, ...rest] = buildFilterPredicates(FIELDS, [f]);
  expect(pred).toBeDefined();
  expect(rest).toHaveLength(0);
  // biome-ignore lint/style/noNonNullAssertion: asserted defined just above
  return render(pred!);
}

/** Assert a filter is dropped entirely (the web matcher skips it too). */
function dropped(f: Filter) {
  expect(buildFilterPredicates(FIELDS, [f])).toHaveLength(0);
}

describe('buildFilterPredicates — text ops', () => {
  it('eq/neq on text columns compare case-folded behind the non-empty guard', () => {
    const q = one({ fieldKey: 'name', op: 'eq', value: 'Acme' });
    expect(q.sql).toBe(
      `("f_name" is not null and "f_name" <> '' and lower("f_name"::text) = lower($1))`,
    );
    expect(q.params).toEqual(['Acme']);

    const nq = one({ fieldKey: 'name', op: 'neq', value: 'Acme' });
    expect(nq.sql).toContain(`lower("f_name"::text) <> lower($1)`);
  });

  it('contains/startsWith/endsWith bind escaped ILIKE patterns', () => {
    const q = one({ fieldKey: 'name', op: 'contains', value: '50%_a\\b' });
    expect(q.sql).toContain(`"f_name"::text ilike $1`);
    expect(q.params).toEqual(['%50\\%\\_a\\\\b%']);

    expect(one({ fieldKey: 'name', op: 'startsWith', value: 'ac' }).params).toEqual(['ac%']);
    expect(one({ fieldKey: 'name', op: 'endsWith', value: 'me' }).params).toEqual(['%me']);
  });
});

describe('buildFilterPredicates — numeric ops', () => {
  it('eq on a numeric column compares numerically, not by rendered text (5000 matches 5000.00)', () => {
    // numeric(18,2)::text renders '5000.00'; text equality against '5000'
    // would match nothing while the web matcher (Number-normalized) matches.
    const q = one({ fieldKey: 'amount', op: 'eq', value: '5000' });
    expect(q.sql).toBe(`"f_amount"::numeric = $1`);
    expect(q.params).toEqual([5000]);

    const nq = one({ fieldKey: 'amount', op: 'neq', value: 5000 });
    expect(nq.sql).toBe(`"f_amount"::numeric <> $1`);
  });

  it('gt/lt/gte/lte bind the parsed number', () => {
    for (const [op, sym] of [
      ['gt', '>'],
      ['lt', '<'],
      ['gte', '>='],
      ['lte', '<='],
    ] as const) {
      const q = one({ fieldKey: 'amount', op, value: '10.5' });
      expect(q.sql).toBe(`"f_amount"::numeric ${sym} $1`);
      expect(q.params).toEqual([10.5]);
    }
  });

  it('drops numeric ops when the value is not a finite number', () => {
    dropped({ fieldKey: 'amount', op: 'eq', value: 'abc' });
    dropped({ fieldKey: 'amount', op: 'lte', value: 'Infinity' });
    // …but null/'' coerce to 0 (Number(null) === 0), exactly like the web
    // matcher's Number(fv), so those still emit a `= 0` / `> 0` predicate.
    expect(one({ fieldKey: 'amount', op: 'gt', value: null }).params).toEqual([0]);
  });

  it('drops gt/lt on non-numeric, non-date columns (would be a per-row ::numeric cast error)', () => {
    dropped({ fieldKey: 'name', op: 'gt', value: '5' });
    dropped({ fieldKey: 'close_date', op: 'lt', value: 'not a date' });
  });
});

describe('buildFilterPredicates — date ops', () => {
  it('before/after bind the parsed instant as ISO and cast the column', () => {
    const q = one({ fieldKey: 'close_date', op: 'before', value: '2026-01-15' });
    expect(q.sql).toBe(`"f_close_date"::timestamptz < $1::timestamptz`);
    expect(q.params).toEqual([new Date('2026-01-15').toISOString()]);

    const after = one({ fieldKey: 'close_date', op: 'after', value: '2026-01-15' });
    expect(after.sql).toContain('::timestamptz > $1::timestamptz');
  });

  it('drops before/after when the value does not parse as a date (empty FilterDialog value)', () => {
    // addBlank() seeds `value: null` and apply() does not require a value —
    // String(null)::timestamptz used to 500 the whole record.list call.
    dropped({ fieldKey: 'close_date', op: 'before', value: null });
    dropped({ fieldKey: 'close_date', op: 'after', value: '' });
    dropped({ fieldKey: 'close_date', op: 'before', value: 'not a date' });
  });

  it('drops before/after on non-date columns', () => {
    dropped({ fieldKey: 'name', op: 'before', value: '2026-01-15' });
    dropped({ fieldKey: 'amount', op: 'after', value: '2026-01-15' });
  });

  it('gte/lte on date columns compare as instants (inclusive relative windows)', () => {
    const q = one({ fieldKey: 'close_date', op: 'gte', value: '2026-01-15' });
    expect(q.sql).toBe(`"f_close_date"::timestamptz >= $1::timestamptz`);
    expect(q.params).toEqual([new Date('2026-01-15').toISOString()]);

    const lte = one({ fieldKey: 'close_date', op: 'lte', value: '2026-01-15' });
    expect(lte.sql).toContain('::timestamptz <= $1::timestamptz');
  });

  it('resolves relative-date tokens through the shared module and binds ISO', () => {
    const q = one({ fieldKey: 'close_date', op: 'gte', value: '@-30d' });
    expect(q.sql).toBe(`"f_close_date"::timestamptz >= $1::timestamptz`);
    const bound = String(q.params[0]);
    // Start-of-UTC-day anchor, 30 days back — exact instant depends on the
    // wall clock, so assert the shape + midnight anchor.
    expect(bound).toMatch(/T00:00:00\.000Z$/);
    expect(Date.parse(bound)).toBeLessThan(Date.now());

    const before = one({ fieldKey: 'close_date', op: 'before', value: '@today' });
    expect(String(before.params[0])).toMatch(/T00:00:00\.000Z$/);
  });

  it('drops unknown relative tokens instead of comparing them as text', () => {
    dropped({ fieldKey: 'close_date', op: 'gte', value: '@yesterday' });
    dropped({ fieldKey: 'close_date', op: 'before', value: '@-30x' });
  });
});

describe('buildFilterPredicates — boolean ops', () => {
  it('isTrue matches only real TRUE; isFalse matches FALSE and NULL (Boolean(null) === false)', () => {
    expect(one({ fieldKey: 'active', op: 'isTrue' }).sql).toBe(`"f_active" is true`);
    expect(one({ fieldKey: 'active', op: 'isFalse' }).sql).toBe(`"f_active" is not true`);
  });

  it('drops isTrue/isFalse on non-checkbox columns (IS TRUE needs a boolean, PG 42804)', () => {
    dropped({ fieldKey: 'name', op: 'isTrue' });
    dropped({ fieldKey: 'amount', op: 'isFalse' });
  });
});

describe('buildFilterPredicates — emptiness per column type', () => {
  it('isEmpty: multipicklist counts empty arrays, text counts empty strings, numeric only NULL', () => {
    expect(one({ fieldKey: 'tags', op: 'isEmpty' }).sql).toBe(
      `("f_tags" is null or cardinality("f_tags") = 0)`,
    );
    expect(one({ fieldKey: 'name', op: 'isEmpty' }).sql).toBe(
      `("f_name" is null or "f_name" = '')`,
    );
    expect(one({ fieldKey: 'amount', op: 'isEmpty' }).sql).toBe(`"f_amount" is null`);
  });

  it('isSet is the negation of isEmpty', () => {
    expect(one({ fieldKey: 'name', op: 'isSet' }).sql).toBe(
      `not ("f_name" is null or "f_name" = '')`,
    );
  });
});

describe('buildFilterPredicates — multipicklist contains', () => {
  it('is case-insensitive array membership, not substring', () => {
    const q = one({ fieldKey: 'tags', op: 'contains', value: 'VIP' });
    expect(q.sql).toBe(`exists (select 1 from unnest("f_tags") as e where lower(e) = lower($1))`);
    expect(q.params).toEqual(['VIP']);
  });
});

describe('buildFilterPredicates — drop rules and combination', () => {
  it('drops filters whose fieldKey is unknown', () => {
    dropped({ fieldKey: 'ghost', op: 'eq', value: 'x' });
  });

  it('returns [] for an empty filter list', () => {
    expect(buildFilterPredicates(FIELDS, [])).toEqual([]);
  });

  it('keeps applicable predicates while dropping broken ones from the same list', () => {
    const preds = buildFilterPredicates(FIELDS, [
      { fieldKey: 'stage', op: 'eq', value: 'won' },
      { fieldKey: 'close_date', op: 'before', value: null }, // dropped, no crash
      { fieldKey: 'amount', op: 'gte', value: '100' },
    ]);
    expect(preds).toHaveLength(2);
  });
});

describe('buildOrderBy', () => {
  it('falls back to the created_at desc default when no sort is given', () => {
    expect(render(buildOrderBy(FIELDS, [])).sql).toBe(`order by "created_at" desc`);
  });

  it('sorts text case-folded with empty strings sunk as NULLs, tiebroken by created_at', () => {
    const q = render(buildOrderBy(FIELDS, [{ fieldKey: 'name', direction: 'asc' }]));
    expect(q.sql).toBe(
      `order by nullif(lower("f_name"::text), '') asc nulls last, "created_at" desc`,
    );
  });

  it('sorts numeric and date columns natively', () => {
    const q = render(
      buildOrderBy(FIELDS, [
        { fieldKey: 'amount', direction: 'desc' },
        { fieldKey: 'close_date', direction: 'asc' },
      ]),
    );
    expect(q.sql).toBe(
      `order by "f_amount" desc nulls last, "f_close_date" asc nulls last, "created_at" desc`,
    );
  });

  it('drops unknown sort keys but keeps the order total via the tiebreaker', () => {
    const q = render(buildOrderBy(FIELDS, [{ fieldKey: 'ghost', direction: 'asc' }]));
    expect(q.sql).toBe(`order by "created_at" desc`);
  });
});

describe('buildFilterPredicates — OR groups', () => {
  it('OR-combines surviving leaves inside a group, parenthesized', () => {
    const [pred] = buildFilterPredicates(FIELDS, [
      {
        any: [
          { fieldKey: 'stage', op: 'eq', value: 'Won' },
          { fieldKey: 'amount', op: 'gt', value: 50000 },
        ],
      },
    ]);
    expect(pred).toBeDefined();
    // biome-ignore lint/style/noNonNullAssertion: asserted above
    const q = render(pred!);
    expect(q.sql).toContain(' or ');
    expect(q.sql.startsWith('(')).toBe(true);
  });

  it('a group with one surviving leaf renders just that predicate', () => {
    const [pred, ...rest] = buildFilterPredicates(FIELDS, [
      {
        any: [
          { fieldKey: 'ghost', op: 'eq', value: 'x' },
          { fieldKey: 'stage', op: 'eq', value: 'Won' },
        ],
      },
    ]);
    expect(rest).toHaveLength(0);
    expect(pred).toBeDefined();
    // biome-ignore lint/style/noNonNullAssertion: asserted above
    expect(render(pred!).sql).not.toContain(' or ');
  });

  it('drops a group whose leaves all drop — it must not constrain the query', () => {
    expect(
      buildFilterPredicates(FIELDS, [
        {
          any: [
            { fieldKey: 'ghost', op: 'eq', value: 'x' },
            { fieldKey: 'close_date', op: 'before', value: 'not a date' },
          ],
        },
      ]),
    ).toHaveLength(0);
  });

  it('AND-combines groups with sibling leaves', () => {
    const preds = buildFilterPredicates(FIELDS, [
      { fieldKey: 'stage', op: 'eq', value: 'Won' },
      {
        any: [
          { fieldKey: 'amount', op: 'gt', value: 1 },
          { fieldKey: 'amount', op: 'lt', value: -1 },
        ],
      },
    ]);
    expect(preds).toHaveLength(2);
  });
});
