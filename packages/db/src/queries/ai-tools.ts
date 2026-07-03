// AI tool policy + preference rows. The catalog and the policy MATH live in
// @northbeam/core/ai-tools (code defaults: read tools allowed everywhere,
// write tools admin-only, read auto-approves) — these queries only move the
// override rows.

import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from '../client.js';
import { aiToolPolicy, aiToolPref } from '../schema.js';

export type AiToolPolicyRow = typeof aiToolPolicy.$inferSelect;
export type AiToolPrefRow = typeof aiToolPref.$inferSelect;

export async function listAiToolPolicies(
  db: DbExecutor,
  orgId: string,
): Promise<AiToolPolicyRow[]> {
  return db.select().from(aiToolPolicy).where(eq(aiToolPolicy.organizationId, orgId));
}

export async function setAiToolPolicy(
  db: DbExecutor,
  opts: { orgId: string; roleKey: string; toolId: string; allowed: boolean },
): Promise<void> {
  await db
    .insert(aiToolPolicy)
    .values({
      organizationId: opts.orgId,
      roleKey: opts.roleKey,
      toolId: opts.toolId,
      allowed: opts.allowed,
    })
    .onConflictDoUpdate({
      target: [aiToolPolicy.organizationId, aiToolPolicy.roleKey, aiToolPolicy.toolId],
      set: { allowed: opts.allowed, updatedAt: new Date() },
    });
}

export async function listAiToolPrefs(
  db: DbExecutor,
  opts: { orgId: string; userId: string },
): Promise<AiToolPrefRow[]> {
  return db
    .select()
    .from(aiToolPref)
    .where(and(eq(aiToolPref.organizationId, opts.orgId), eq(aiToolPref.userId, opts.userId)));
}

export async function setAiToolPref(
  db: DbExecutor,
  opts: { orgId: string; userId: string; toolId: string; autoApprove: boolean },
): Promise<void> {
  await db
    .insert(aiToolPref)
    .values({
      organizationId: opts.orgId,
      userId: opts.userId,
      toolId: opts.toolId,
      autoApprove: opts.autoApprove,
    })
    .onConflictDoUpdate({
      target: [aiToolPref.organizationId, aiToolPref.userId, aiToolPref.toolId],
      set: { autoApprove: opts.autoApprove, updatedAt: new Date() },
    });
}
