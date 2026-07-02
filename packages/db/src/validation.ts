// Pure record-write validation: required-field checks + validation_rule
// conditions. No I/O — the write path (record.create/update/bulkCreate in
// apps/api) fetches fields + rules and passes them in, so create, update, and
// the bulk path all run the exact same checks.

import { COMPUTED } from './dynamic/pgtypes.js';
import { toBoolean } from './formula/helpers.js';
import { evaluateFormula } from './formula/index.js';
import { logger } from './logger.js';
import type { FieldRow } from './queries/crm.js';
import type { ValidationRuleRow } from './queries/validation-rules.js';

/** Mirror of @northbeam/core's ValidationIssue — core depends on db (not the
 *  other way around), so the shape is declared here too; the two are
 *  structurally identical and assignable in both directions. */
export type ValidationIssue = {
  kind: 'required' | 'rule' | 'type';
  fieldKey?: string;
  ruleId?: string;
  message: string;
};

/** Empty per emptyPredicate (dynamic/filters-sql.ts) and the web isEmptyValue:
 *  null | undefined | '' | []. 0 and false are real values. */
function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0);
}

/** One issue per required-but-empty field. Computed types (formula/rollup/
 *  ai/autonumber) are skipped — their values are engine-written after the
 *  save, so the user can never satisfy them in the form. Callers pass MERGED
 *  data (existing + patch) on update so clearing a required field is caught. */
export function requiredIssues(
  fields: FieldRow[],
  data: Record<string, unknown>,
): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  for (const field of fields) {
    if (!field.required || COMPUTED.has(field.type)) continue;
    if (isEmpty(data[field.key])) {
      out.push({ kind: 'required', fieldKey: field.key, message: `${field.label} is required` });
    }
  }
  return out;
}

/** One issue per active rule whose condition evaluates truthy — a truthy
 *  condition BLOCKS the save (Salesforce semantics). A rule whose formula
 *  fails to parse or evaluate is skipped (fail-open, logged): a broken rule
 *  must not brick every write to the object. */
export function ruleIssues(
  rules: ValidationRuleRow[],
  data: Record<string, unknown>,
  now: Date,
): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  for (const rule of rules) {
    if (!rule.active) continue;
    let result: unknown;
    try {
      result = evaluateFormula(rule.condition, data, { now });
    } catch (err) {
      logger.warn({ ruleId: rule.id, name: rule.name, err }, 'validation.rule_skipped');
      continue;
    }
    if (!toBoolean(result)) continue;
    out.push({
      kind: 'rule',
      ...(rule.errorFieldKey ? { fieldKey: rule.errorFieldKey } : {}),
      ruleId: rule.id,
      message: rule.errorMessage,
    });
  }
  return out;
}
