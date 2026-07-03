// buildDataSummary must query through the caller's visibility. These tests
// capture the SQL each aggregate emits via a stub DbExecutor and assert the
// acl predicate (owner_id / shared-id clause from aclPredicate) is present
// for a restricted caller on a private object — and absent for adminish.

import type { FieldRow, ObjectRow } from '@northbeam/db';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { buildDataSummary } from '../../src/ai/data-summary.js';

const dialect = new PgDialect();

function object(overrides: Partial<ObjectRow> = {}): ObjectRow {
  return {
    id: 'o1',
    organizationId: 'abc',
    key: 'deal',
    tableName: 't_deal',
    defaultVisibility: 'private',
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

const fields = [
  field({ key: 'stage', columnName: 'f_stage', type: 'picklist' }),
  field({ key: 'amount', columnName: 'f_amount', type: 'currency' }),
  field({ key: 'close_date', columnName: 'f_close_date', type: 'date' }),
];

/** DbExecutor stub: records every rendered statement, answers each aggregate
 *  with one non-empty count row so all summary branches execute. */
function stubDb(captured: string[]) {
  return {
    execute: (q: SQL) => {
      captured.push(dialect.sqlToQuery(q).sql);
      return Promise.resolve([{ g: 'Won', v: '10', n: 4 }]);
    },
    // biome-ignore lint/suspicious/noExplicitAny: minimal test double for DbExecutor
  } as any;
}

describe('buildDataSummary acl', () => {
  it('applies the caller acl to every query on a private object', async () => {
    const captured: string[] = [];
    await buildDataSummary(stubDb(captured), {
      orgId: 'abc',
      object: object(),
      fields,
      acl: { userId: 'u1', sharedRecordIds: ['r1'], isAdminish: false },
    });
    expect(captured.length).toBeGreaterThan(0);
    for (const sql of captured) {
      expect(sql).toContain('"owner_id"');
    }
  });

  it('skips the visibility predicate for adminish callers', async () => {
    const captured: string[] = [];
    await buildDataSummary(stubDb(captured), {
      orgId: 'abc',
      object: object(),
      fields,
      acl: { userId: 'u1', sharedRecordIds: [], isAdminish: true },
    });
    expect(captured.length).toBeGreaterThan(0);
    for (const sql of captured) {
      expect(sql).not.toContain('"owner_id"');
    }
  });

  it('omitting acl leaves queries unscoped (public-object path)', async () => {
    const captured: string[] = [];
    await buildDataSummary(stubDb(captured), {
      orgId: 'abc',
      object: object({ defaultVisibility: 'public' }),
      fields,
    });
    for (const sql of captured) {
      expect(sql).not.toContain('"owner_id"');
    }
  });
});
