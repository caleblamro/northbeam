// aclPredicate composes two axes: the role's row-criteria (always applied) and
// the private-record visibility (owner/share, only for non-admin). This guards
// the criteria-scoping behavior added for row-level permissions.

import { sql } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { aclPredicate } from '../../src/dynamic/records.js';
import type { ObjectRow } from '../../src/queries/crm.js';

const publicObj = { defaultVisibility: 'public' } as ObjectRow;
const privateObj = { defaultVisibility: 'private' } as ObjectRow;
const criteria = sql`${sql.raw('"f_region"')} = 'west'`;
const base = { userId: 'u1', sharedRecordIds: [] as string[] };
const dialect = new PgDialect();

/** Render a predicate's SQL text for assertions. */
function text(p: ReturnType<typeof aclPredicate>): string {
  return p ? dialect.sqlToQuery(p).sql : 'NULL';
}

describe('aclPredicate criteria composition', () => {
  it('no acl → null (unrestricted)', () => {
    expect(aclPredicate(publicObj, undefined)).toBeNull();
  });

  it('public object, no criteria → null', () => {
    expect(aclPredicate(publicObj, { ...base, isAdminish: false })).toBeNull();
  });

  it('criteria applies even on a public object', () => {
    const p = aclPredicate(publicObj, { ...base, isAdminish: false, criteria });
    expect(text(p)).toContain('f_region');
    // Public object contributes no owner/share visibility clause.
    expect(text(p)).not.toContain('owner_id');
  });

  it('criteria applies even to a record-admin (grant-based see-all)', () => {
    const p = aclPredicate(privateObj, { ...base, isAdminish: true, criteria });
    expect(text(p)).toContain('f_region');
    // Admin bypasses ownership/share visibility…
    expect(text(p)).not.toContain('owner_id');
  });

  it('private + non-admin ANDs criteria with owner/share visibility', () => {
    const p = aclPredicate(privateObj, {
      ...base,
      isAdminish: false,
      criteria,
    });
    const s = text(p);
    expect(s).toContain('f_region'); // criteria
    expect(s).toContain('owner_id'); // visibility
    expect(s).toContain(' and '); // combined
  });

  it('private + non-admin, no criteria → just the visibility clause', () => {
    const p = aclPredicate(privateObj, { ...base, isAdminish: false });
    const s = text(p);
    expect(s).toContain('owner_id');
    expect(s).not.toContain(' and '); // single axis, unwrapped
  });
});
