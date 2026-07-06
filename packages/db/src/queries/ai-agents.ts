// AI agent presets — CRUD over the `ai_agent` table plus the idempotent
// system-agent seed. Policy (which models exist, tool intersection, role
// gating) lives in @northbeam/core and the API layer; this module is pure
// storage. All queries are org-scoped: `ai_agent` is public-schema metadata,
// so every statement filters by organizationId (RLS backstops it).

import { and, asc, desc, eq } from 'drizzle-orm';
import type { DbExecutor } from '../client.js';
import { aiAgent } from '../schema.js';

export type AiAgentRow = typeof aiAgent.$inferSelect;

/** All agents for an org — system agents first, then alphabetical. */
export async function listAiAgents(db: DbExecutor, orgId: string): Promise<AiAgentRow[]> {
  return db
    .select()
    .from(aiAgent)
    .where(eq(aiAgent.organizationId, orgId))
    .orderBy(desc(aiAgent.isSystem), asc(aiAgent.name));
}

export async function getAiAgent(
  db: DbExecutor,
  orgId: string,
  id: string,
): Promise<AiAgentRow | null> {
  const [row] = await db
    .select()
    .from(aiAgent)
    .where(and(eq(aiAgent.organizationId, orgId), eq(aiAgent.id, id)))
    .limit(1);
  return row ?? null;
}

export type CreateAiAgentInput = {
  key: string;
  name: string;
  description?: string;
  systemPrompt?: string;
  /** Model ids the agent may run on. Empty = org default model only. */
  models?: string[];
  /** null = all of the caller's effective tools. */
  toolIds?: string[] | null;
  /** null = every role may use it. */
  roleKeys?: string[] | null;
  createdBy?: string | null;
};

export async function createAiAgent(
  db: DbExecutor,
  orgId: string,
  input: CreateAiAgentInput,
): Promise<AiAgentRow> {
  const [row] = await db
    .insert(aiAgent)
    .values({
      organizationId: orgId,
      key: input.key,
      name: input.name,
      description: input.description ?? '',
      systemPrompt: input.systemPrompt ?? '',
      models: input.models ?? [],
      toolIds: input.toolIds ?? null,
      roleKeys: input.roleKeys ?? null,
      isSystem: false,
      createdBy: input.createdBy ?? null,
    })
    .returning();
  if (!row) throw new Error('failed to create ai agent');
  return row;
}

export type UpdateAiAgentInput = Partial<
  Pick<
    CreateAiAgentInput,
    'name' | 'description' | 'systemPrompt' | 'models' | 'toolIds' | 'roleKeys'
  >
>;

/** Patch one agent; returns the updated row or null when not found. System
 *  agents are editable (rename, narrow tools) but never deletable. */
export async function updateAiAgent(
  db: DbExecutor,
  orgId: string,
  id: string,
  patch: UpdateAiAgentInput,
): Promise<AiAgentRow | null> {
  const [row] = await db
    .update(aiAgent)
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.systemPrompt !== undefined ? { systemPrompt: patch.systemPrompt } : {}),
      ...(patch.models !== undefined ? { models: patch.models } : {}),
      ...(patch.toolIds !== undefined ? { toolIds: patch.toolIds } : {}),
      ...(patch.roleKeys !== undefined ? { roleKeys: patch.roleKeys } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(aiAgent.organizationId, orgId), eq(aiAgent.id, id)))
    .returning();
  return row ?? null;
}

/** Delete one agent. System agents are protected — throws rather than
 *  silently skipping so callers surface the violation. */
export async function deleteAiAgent(db: DbExecutor, orgId: string, id: string): Promise<boolean> {
  const existing = await getAiAgent(db, orgId, id);
  if (!existing) return false;
  if (existing.isSystem) throw new Error('system agents cannot be deleted');
  await db.delete(aiAgent).where(and(eq(aiAgent.organizationId, orgId), eq(aiAgent.id, id)));
  return true;
}

/** The built-in agents every org gets. Kept here (not core) so the seed and
 *  the table stay in one package; the API layer supplies the composer's
 *  actual prompt/behavior at run time. */
const SYSTEM_AGENT_SEEDS = [
  {
    key: 'composer',
    name: 'Dashboard Composer',
    description: 'Researches your data and composes dashboards, reports, and record layouts.',
    systemPrompt: '',
    models: [] as string[],
    toolIds: null,
    roleKeys: null,
  },
] as const;

/** Idempotently seed the system agents (upsert-by-key). Runs on org create
 *  and lazily from the agent list endpoint for orgs seeded before agents
 *  existed. Existing rows are left untouched. */
export async function seedSystemAgents(db: DbExecutor, orgId: string): Promise<void> {
  await db
    .insert(aiAgent)
    .values(
      SYSTEM_AGENT_SEEDS.map((s) => ({
        organizationId: orgId,
        key: s.key,
        name: s.name,
        description: s.description,
        systemPrompt: s.systemPrompt,
        models: [...s.models],
        toolIds: s.toolIds,
        roleKeys: s.roleKeys,
        isSystem: true,
        createdBy: null,
      })),
    )
    .onConflictDoNothing({ target: [aiAgent.organizationId, aiAgent.key] });
}
