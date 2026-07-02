// validation_rule CRUD — typed Drizzle only. The pure enforcement helpers
// (requiredIssues / ruleIssues) live in src/validation.ts; the record write
// path in apps/api fetches rules through here and runs them there.

import { and, asc, eq } from 'drizzle-orm';
import type { DbExecutor } from '../client.js';
import { validationRule } from '../schema.js';

export type ValidationRuleRow = typeof validationRule.$inferSelect;

export async function listValidationRules(
  db: DbExecutor,
  orgId: string,
  objectId: string,
): Promise<ValidationRuleRow[]> {
  return db
    .select()
    .from(validationRule)
    .where(and(eq(validationRule.organizationId, orgId), eq(validationRule.objectId, objectId)))
    .orderBy(asc(validationRule.name));
}

export async function getValidationRule(
  db: DbExecutor,
  orgId: string,
  id: string,
): Promise<ValidationRuleRow | null> {
  const [row] = await db
    .select()
    .from(validationRule)
    .where(and(eq(validationRule.organizationId, orgId), eq(validationRule.id, id)))
    .limit(1);
  return row ?? null;
}

export async function createValidationRule(
  db: DbExecutor,
  input: {
    organizationId: string;
    objectId: string;
    name: string;
    condition: string;
    errorMessage: string;
    errorFieldKey?: string | null;
    active?: boolean;
  },
): Promise<ValidationRuleRow> {
  const [row] = await db.insert(validationRule).values(input).returning();
  if (!row) throw new Error('validation rule insert returned no row');
  return row;
}

export async function updateValidationRule(
  db: DbExecutor,
  orgId: string,
  id: string,
  patch: {
    name?: string;
    condition?: string;
    errorMessage?: string;
    /** `null` clears the field anchor (record-level error). */
    errorFieldKey?: string | null;
    active?: boolean;
  },
): Promise<ValidationRuleRow | null> {
  const [row] = await db
    .update(validationRule)
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.condition !== undefined ? { condition: patch.condition } : {}),
      ...(patch.errorMessage !== undefined ? { errorMessage: patch.errorMessage } : {}),
      ...(patch.errorFieldKey !== undefined ? { errorFieldKey: patch.errorFieldKey } : {}),
      ...(patch.active !== undefined ? { active: patch.active } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(validationRule.organizationId, orgId), eq(validationRule.id, id)))
    .returning();
  return row ?? null;
}

export async function deleteValidationRule(
  db: DbExecutor,
  orgId: string,
  id: string,
): Promise<boolean> {
  const rows = await db
    .delete(validationRule)
    .where(and(eq(validationRule.organizationId, orgId), eq(validationRule.id, id)))
    .returning({ id: validationRule.id });
  return rows.length > 0;
}
