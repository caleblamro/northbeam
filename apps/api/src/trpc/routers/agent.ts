// /trpc/agent — AI agent presets: named system prompts + model/tool/role
// scoping that ai.chat threads run as. Reads are role-gated (an agent with
// roleKeys only appears to those roles; owners see all); writes require the
// 'ai.agents.manage' permission. The system 'composer' agent is seeded on org
// create and lazily here for orgs that predate agents; it can be edited but
// never deleted, and no agent's key ever changes after create.

import { loadEnv } from '@northbeam/config';
import { AI_TOOL_IDS, isKnownModel } from '@northbeam/core';
import {
  createAiAgent,
  deleteAiAgent,
  getAiAgent,
  listAiAgents,
  seedSystemAgents,
  updateAiAgent,
  writeAuditEvent,
} from '@northbeam/db';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { agentVisibleToRole, resolveAgentModels } from '../../ai/chat-loop.js';
import { permissionProcedure, protectedProcedure, router } from '../trpc.js';

// Same slug shape as saved-view keys.
const KEY_RE = /^[a-z0-9](?:[a-z0-9-_]{0,46}[a-z0-9])?$/;

const ModelsSchema = z
  .array(z.string().min(1))
  .max(10)
  .refine((ids) => ids.every((id) => isKnownModel(id)), { message: 'unknown model id' });

const ToolIdsSchema = z
  .array(z.string().min(1))
  .max(50)
  .refine((ids) => ids.every((id) => AI_TOOL_IDS.includes(id)), { message: 'unknown tool id' })
  .nullable();

const RoleKeysSchema = z.array(z.string().min(1).max(48)).max(20).nullable();

// Shared field shapes, sans defaults — UpdateInput stays default-free so a
// partial patch can't silently reset unspecified slots (same pattern as the
// view router).
const AgentFields = z.object({
  name: z.string().min(1).max(80),
  description: z.string().max(400),
  systemPrompt: z.string().max(4000),
  /** Model ids the agent may run on. Empty = org default model only. */
  models: ModelsSchema,
  /** null = all of the caller's effective tools. */
  toolIds: ToolIdsSchema,
  /** null = every role may use it. */
  roleKeys: RoleKeysSchema,
});

const CreateInput = AgentFields.extend({
  key: z.string().regex(KEY_RE, 'lowercase letters, digits, dashes / underscores'),
  description: AgentFields.shape.description.default(''),
  systemPrompt: AgentFields.shape.systemPrompt.default(''),
  models: ModelsSchema.default([]),
  toolIds: ToolIdsSchema.default(null),
  roleKeys: RoleKeysSchema.default(null),
});

// Key is intentionally absent — immutable after create (system agents rely
// on it for the idempotent seed; sessions and clients reference by id).
const UpdateInput = AgentFields.partial().extend({ id: z.string().uuid() });

export const agentRouter = router({
  /** Agents the caller may use, each with its resolved model list (the
   *  agent's models filtered to the known catalog; empty = org default).
   *  Lazily seeds the system agents for orgs created before agents existed. */
  list: protectedProcedure.query(async ({ ctx }) => {
    const orgId = ctx.auth.organizationId;
    let agents = await listAiAgents(ctx.db, orgId);
    if (agents.length === 0) {
      await seedSystemAgents(ctx.db, orgId);
      agents = await listAiAgents(ctx.db, orgId);
    }
    const defaultModel = loadEnv().ANTHROPIC_MODEL;
    return agents
      .filter((a) => agentVisibleToRole(a.roleKeys, ctx.auth.role, ctx.auth.permissions.isOwner))
      .map((a) => ({ ...a, resolvedModels: resolveAgentModels(a.models, defaultModel) }));
  }),

  create: permissionProcedure('ai.agents.manage')
    .input(CreateInput)
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.auth.organizationId;
      const existing = await listAiAgents(ctx.db, orgId);
      if (existing.some((a) => a.key === input.key)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: `an agent with key '${input.key}' already exists`,
        });
      }
      const row = await createAiAgent(ctx.db, orgId, {
        key: input.key,
        name: input.name,
        description: input.description,
        systemPrompt: input.systemPrompt,
        models: input.models,
        toolIds: input.toolIds,
        roleKeys: input.roleKeys,
        createdBy: ctx.auth.userId,
      });
      await writeAuditEvent(ctx.db, {
        organizationId: orgId,
        userId: ctx.auth.userId,
        action: 'ai.agent_created',
        targetType: 'ai_agent',
        targetId: row.id,
        meta: { key: row.key, name: row.name },
      });
      return row;
    }),

  update: permissionProcedure('ai.agents.manage')
    .input(UpdateInput)
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.auth.organizationId;
      const { id, ...patch } = input;
      const existing = await getAiAgent(ctx.db, orgId, id);
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'agent not found' });
      const row = await updateAiAgent(ctx.db, orgId, id, patch);
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'agent not found' });
      await writeAuditEvent(ctx.db, {
        organizationId: orgId,
        userId: ctx.auth.userId,
        action: 'ai.agent_updated',
        targetType: 'ai_agent',
        targetId: id,
        meta: { key: existing.key, changed: Object.keys(patch) },
      });
      return row;
    }),

  delete: permissionProcedure('ai.agents.manage')
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.auth.organizationId;
      const existing = await getAiAgent(ctx.db, orgId, input.id);
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'agent not found' });
      if (existing.isSystem) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'system agents cannot be deleted' });
      }
      await deleteAiAgent(ctx.db, orgId, input.id);
      await writeAuditEvent(ctx.db, {
        organizationId: orgId,
        userId: ctx.auth.userId,
        action: 'ai.agent_deleted',
        targetType: 'ai_agent',
        targetId: input.id,
        meta: { key: existing.key, name: existing.name },
      });
      return { ok: true as const };
    }),
});
