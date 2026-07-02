// requiredIssues + ruleIssues gate every record write. The empty-value
// semantics must stay in lockstep with emptyPredicate (dynamic/filters-sql.ts)
// and the web isEmptyValue — null | undefined | '' | [] are empty, 0 and false
// are real values. ruleIssues must fail OPEN on a broken formula: one bad rule
// must never brick every write to the object.

import { describe, expect, it } from 'vitest';
import type { FieldRow } from '../src/queries/crm.js';
import type { ValidationRuleRow } from '../src/queries/validation-rules.js';
import { requiredIssues, ruleIssues } from '../src/validation.js';

function field(overrides: Partial<FieldRow>): FieldRow {
  // Minimal FieldRow stub — only the keys requiredIssues reads.
  return {
    id: 'f1',
    organizationId: 'org_test',
    objectId: 'o1',
    key: overrides.key ?? 'name',
    columnName: overrides.columnName ?? 'f_name',
    pgType: overrides.pgType ?? 'text',
    indexed: false,
    label: overrides.label ?? 'Name',
    type: overrides.type ?? 'text',
    config: overrides.config ?? {},
    required: false,
    unique: false,
    isSystem: false,
    source: 'system',
    orderIndex: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as FieldRow;
}

function rule(overrides: Partial<ValidationRuleRow>): ValidationRuleRow {
  return {
    id: 'r1',
    organizationId: 'org_test',
    objectId: 'o1',
    name: overrides.name ?? 'Amount must be positive',
    condition: overrides.condition ?? '{amount} < 0',
    errorMessage: overrides.errorMessage ?? 'Amount cannot be negative',
    errorFieldKey: null,
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as ValidationRuleRow;
}

const NOW = new Date('2026-07-01T12:00:00Z');

describe('requiredIssues', () => {
  const name = field({ key: 'name', label: 'Name', required: true });

  it('flags every empty shape: missing, undefined, null, empty string, empty array', () => {
    const tags = field({ key: 'tags', label: 'Tags', type: 'multipicklist', required: true });
    for (const data of [
      {},
      { name: undefined, tags: undefined },
      { name: null, tags: null },
      { name: '', tags: [] },
    ]) {
      const issues = requiredIssues([name, tags], data as Record<string, unknown>);
      expect(issues.map((i) => i.fieldKey)).toEqual(['name', 'tags']);
      expect(issues.every((i) => i.kind === 'required')).toBe(true);
    }
  });

  it('treats 0 and false as real values (mirroring emptyPredicate)', () => {
    const amount = field({ key: 'amount', label: 'Amount', type: 'currency', required: true });
    const done = field({ key: 'done', label: 'Done', type: 'checkbox', required: true });
    expect(requiredIssues([amount, done], { amount: 0, done: false })).toEqual([]);
  });

  it('accepts non-empty values, including a whitespace-only string', () => {
    expect(requiredIssues([name], { name: 'Acme' })).toEqual([]);
    expect(requiredIssues([name], { name: ' ' })).toEqual([]);
    const tags = field({ key: 'tags', label: 'Tags', type: 'multipicklist', required: true });
    expect(requiredIssues([tags], { tags: ['a'] })).toEqual([]);
  });

  it('skips fields that are not required', () => {
    expect(requiredIssues([field({ key: 'notes', required: false })], {})).toEqual([]);
  });

  it('skips computed types even when marked required', () => {
    const computed = (['formula', 'rollup', 'ai', 'autonumber'] as const).map((type) =>
      field({ key: `${type}_field`, label: type, type, required: true }),
    );
    expect(requiredIssues(computed, {})).toEqual([]);
  });

  it('carries the field label in the message', () => {
    const [issue] = requiredIssues([field({ key: 'amount', label: 'Amount', required: true })], {});
    expect(issue?.message).toBe('Amount is required');
  });
});

describe('ruleIssues', () => {
  it('emits an issue when the condition is truthy', () => {
    const issues = ruleIssues([rule({ condition: '{amount} < 0' })], { amount: -5 }, NOW);
    expect(issues).toEqual([{ kind: 'rule', ruleId: 'r1', message: 'Amount cannot be negative' }]);
  });

  it('stays silent when the condition is falsy or null', () => {
    expect(ruleIssues([rule({ condition: '{amount} < 0' })], { amount: 5 }, NOW)).toEqual([]);
    // {missing} is null → comparison short-circuits to null → not truthy.
    expect(ruleIssues([rule({ condition: '{missing} > 5' })], {}, NOW)).toEqual([]);
  });

  it('anchors the issue to errorFieldKey when set', () => {
    const issues = ruleIssues(
      [rule({ errorFieldKey: 'amount', condition: '{amount} < 0' })],
      { amount: -5 },
      NOW,
    );
    expect(issues[0]?.fieldKey).toBe('amount');
  });

  it('skips inactive rules', () => {
    expect(
      ruleIssues([rule({ active: false, condition: '{amount} < 0' })], { amount: -5 }, NOW),
    ).toEqual([]);
  });

  it('uses the injected clock for TODAY()', () => {
    const closesPast = rule({
      id: 'r_date',
      condition: '{close_date} < TODAY()',
      errorMessage: 'Close date is in the past',
    });
    expect(ruleIssues([closesPast], { close_date: '2026-06-30' }, NOW)).toHaveLength(1);
    expect(ruleIssues([closesPast], { close_date: '2026-07-02' }, NOW)).toEqual([]);
  });

  it('fails open on a condition that does not parse', () => {
    const broken = rule({ id: 'r_broken', condition: '{{{' });
    expect(ruleIssues([broken], { amount: -5 }, NOW)).toEqual([]);
  });

  it('fails open on a condition that throws at evaluation', () => {
    const broken = rule({ id: 'r_eval', condition: 'NOTAFUNCTION({amount})' });
    expect(ruleIssues([broken], { amount: -5 }, NOW)).toEqual([]);
  });

  it('a broken rule does not mask the others', () => {
    const issues = ruleIssues(
      [rule({ id: 'r_broken', condition: '{{{' }), rule({ id: 'r_ok', condition: '{amount} < 0' })],
      { amount: -5 },
      NOW,
    );
    expect(issues.map((i) => i.ruleId)).toEqual(['r_ok']);
  });
});
