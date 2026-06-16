// The identifier safety layer is the single thing standing between attacker-
// supplied object/field keys and live SQL DDL. Every character class, length
// boundary, and leading-character rule lives here; if any of these regress,
// the rest of the dynamic record layer is unsafe. Cover them exhaustively.

import { describe, expect, it } from 'vitest';
import {
  SYS,
  fieldColumnName,
  objectTableName,
  orgSchema,
  qid,
  qualified,
} from '../../src/dynamic/identifiers.js';

describe('sanitize (via the public name helpers)', () => {
  it('lowercases mixed-case input', () => {
    // objectTableName/orgSchema use a *fallback* prefix — only prepended when
    // the input would otherwise produce an invalid leading character. Pure
    // alphabetic input passes through unprefixed.
    expect(objectTableName('Account')).toBe('account');
    expect(objectTableName('OPPORTUNITY')).toBe('opportunity');
  });

  it('replaces non-[a-z0-9_] with underscore', () => {
    expect(objectTableName('foo-bar.baz!')).toBe('foo_bar_baz_');
    // fieldColumnName prepends f_ in the *input* (not the fallback), so the
    // resulting column always carries that prefix.
    expect(fieldColumnName('annual revenue ($)')).toBe('f_annual_revenue____');
  });

  it('keeps Salesforce custom __c suffix intact', () => {
    expect(objectTableName('project__c')).toBe('project__c');
    expect(fieldColumnName('renewal_date__c')).toBe('f_renewal_date__c');
  });

  it('prepends the fallback prefix when input does not start with letter or underscore', () => {
    expect(objectTableName('123abc')).toBe('t_123abc');
    expect(orgSchema('99zz')).toBe('org_99zz');
  });

  it('clamps to 63 bytes (Postgres identifier limit)', () => {
    const long = 'a'.repeat(120);
    const out = objectTableName(long);
    expect(out.length).toBeLessThanOrEqual(63);
    expect(out.startsWith('a')).toBe(true);
  });

  it('falls back deterministically when sanitization eats everything', () => {
    // Empty input → the fallback prefix alone ('t_'). Non-empty all-symbol
    // input → underscores (the leading '_' satisfies the start-character rule,
    // so no extra prefix is needed).
    expect(objectTableName('')).toBe('t_');
    expect(objectTableName('!!!')).toBe('___');
  });
});

describe('qid', () => {
  it('wraps in double quotes', () => {
    expect(qid('foo')).toBe('"foo"');
  });

  it('escapes embedded double quotes by doubling them', () => {
    expect(qid('a"b')).toBe('"a""b"');
  });

  it('cannot break out of an identifier with a closing quote', () => {
    // Sanitized identifiers won't contain quotes, but qid is defense-in-depth:
    // even if a quote slipped through, the doubling renders it inert. Postgres
    // still parses the whole thing as ONE identifier (with a literal `"` in
    // the middle), not as two SQL statements — that's what makes it safe.
    const quoted = qid('id"; DROP TABLE users; --');
    expect(quoted.startsWith('"')).toBe(true);
    expect(quoted.endsWith('"')).toBe(true);
    // Anywhere a `"` appears INSIDE the quoted region, it MUST be doubled —
    // a single bare `"` would terminate the identifier and let the trailing
    // SQL execute. Verify the inner string contains no un-doubled quotes.
    const inner = quoted.slice(1, -1);
    const naked = inner.replace(/""/g, ''); // remove escaped pairs
    expect(naked).not.toContain('"');
  });
});

describe('qualified', () => {
  it('produces "schema"."table" with both halves quoted and sanitized', () => {
    expect(qualified('abc', 't_account')).toBe('"org_abc"."t_account"');
  });

  it('survives a malicious orgId — the SQL stays inside the quoted identifier', () => {
    const bad = qualified('"; DROP SCHEMA public CASCADE; --', 't_x');
    // The dangerous chars are doubled (") and replaced (others → _), keeping
    // them INSIDE the quoted region. Postgres parses one big identifier with
    // garbage in the middle — no statement boundary escapes.
    const inner = bad.slice(1, bad.indexOf('"."'));
    const naked = inner.replace(/""/g, '');
    expect(naked).not.toContain('"'); // no un-doubled quote can escape
    expect(bad).toMatch(/^"org_[a-z0-9_]+"\."t_x"$/);
  });
});

describe('SYS', () => {
  it('exposes every system column the DDL engine creates', () => {
    expect(SYS).toMatchObject({
      id: 'id',
      ownerId: 'owner_id',
      recordTypeId: 'record_type_id',
      name: 'name',
      salesforceId: 'salesforce_id',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      createdById: 'created_by_id',
    });
  });
});
