// /trpc/ai — AI artifact generation for the composer drawer (and the ⌘K
// palette door into it). The procedure streams: a conversational note first,
// partial artifact snapshots while Claude composes, then a final artifact
// that has been schema-validated AND repaired against the org's live
// metadata (see repair-artifact.ts) so every live node actually queries.
// It is read-only — persistence happens client-side via view.create when the
// user explicitly saves; the only DB write here is the audit row.
//
// Streaming vs the protectedProcedure transaction: tRPC resolves the
// procedure (and commits the `withOrgContext` transaction) when the resolver
// RETURNS the async iterable — the generator body runs after that, while the
// response streams. So every ctx.db read happens eagerly below, and the
// completion audit opens its own org context on the root db.

import { loadEnv } from '@northbeam/config';
import {
  AI_TOOLS,
  ArtifactLikeSchema,
  type AuthContext,
  canObject,
  effectiveTools,
} from '@northbeam/core';
import {
  type AiSessionMessage,
  type DbExecutor,
  type ShareTarget,
  deleteAiSession,
  getAiAgent,
  getAiSessionForUser,
  isAdminish,
  listAiSessions,
  listAiToolPolicies,
  listAiToolPrefs,
  listObjectsWithFields,
  listSharedAiSessions,
  setAiSessionShare,
  setAiToolPolicy,
  setAiToolPref,
  upsertAiSession,
  visibleSharedRecordIds,
  withOrgContext,
  writeAuditEvent,
} from '@northbeam/db';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { applyArtifactPatch } from '../../ai/apply-patch.js';
import { type ObjectContext, streamArtifact } from '../../ai/artifact-generator.js';
import {
  type ChatStreamEvent,
  agentVisibleToRole,
  intersectTools,
  pickChatModel,
  runChatLoop,
} from '../../ai/chat-loop.js';
import { buildDataSummary } from '../../ai/data-summary.js';
import { type ObjectFieldsByKey, repairArtifact } from '../../ai/repair-artifact.js';
import { runResearch } from '../../ai/research.js';
import {
  type ToolEvent,
  buildResearchTools,
  createEventChannel,
  resolveToolApproval,
} from '../../ai/tools.js';
import { fixedWindow } from '../../lib/rate-limit.js';
import { redis } from '../../queue/connection.js';
import { rootDb } from '../context.js';
import { permissionProcedure, protectedProcedure, router } from '../trpc.js';

/** Persisted chat turn — discriminated on `kind`. Legacy rows predate the
 *  field, so the text variant keeps `kind` optional (no kind = text). */
const SessionMessageSchema = z.union([
  z.object({
    kind: z.literal('text').optional(),
    role: z.enum(['user', 'assistant']),
    content: z.string().max(4000),
    repairs: z.array(z.string().max(400)).optional(),
  }),
  z.object({
    kind: z.literal('tool'),
    toolId: z.string().max(100),
    title: z.string().max(200),
    status: z.enum(['done', 'denied', 'error']),
    inputSummary: z.string().max(2000).optional(),
    resultSummary: z.string().max(2000).optional(),
  }),
  z.object({
    kind: z.literal('artifact'),
    note: z.string().max(4000).optional(),
  }),
]) satisfies z.ZodType<AiSessionMessage>;

/** Same share vocabulary as saved views (see routers/view.ts). */
const ShareTargetSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('org') }),
  z.object({ kind: z.literal('role'), role: z.enum(['owner', 'admin', 'member', 'viewer']) }),
  z.object({ kind: z.literal('user'), userId: z.string().min(1) }),
]) satisfies z.ZodType<ShareTarget>;

/** Clip persisted tool summaries to the SessionMessageSchema bounds. */
function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Minimum gap between streamed partial snapshots. Each snapshot re-sends the
 *  whole partial payload, so unthrottled streaming is O(n²) bytes. */
const PARTIAL_INTERVAL_MS = 150;

/* Cost guard on generation — fixed windows, fail-open (see lib/rate-limit).
 * Per-user damps a runaway individual; per-org caps the workspace's daily
 * LLM spend. TOO_MANY_REQUESTS is already mapped to a friendly message in
 * the web error formatter. */
const USER_LIMIT = { max: 10, windowSec: 10 * 60 };
const ORG_LIMIT = { max: 200, windowSec: 24 * 60 * 60 };

/** Shared gate for the streaming generations (ai.preview / ai.chat): AI must
 *  be configured, and the caller must clear the per-user + per-org fixed
 *  windows — ONE spend budget across both endpoints. Returns the env. */
async function gateAiGeneration(userId: string, organizationId: string) {
  const env = loadEnv();
  if (!env.ANTHROPIC_API_KEY) {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'AI generation is not configured. Set ANTHROPIC_API_KEY on the API to enable it.',
    });
  }
  // Cost guard before any DB work. Fail-open on Redis trouble.
  const [userGate, orgGate] = await Promise.all([
    fixedWindow(redis(), `ai:preview:u:${userId}`, USER_LIMIT.max, USER_LIMIT.windowSec),
    fixedWindow(redis(), `ai:preview:o:${organizationId}`, ORG_LIMIT.max, ORG_LIMIT.windowSec),
  ]);
  const blocked = !userGate.ok ? userGate : !orgGate.ok ? orgGate : null;
  if (blocked) {
    const mins = Math.max(1, Math.ceil(blocked.resetSec / 60));
    throw new TRPCError({
      code: 'TOO_MANY_REQUESTS',
      message: `AI generation limit reached — try again in ~${mins} min.`,
    });
  }
  return env;
}

/** Everything a generation needs from the caller's org, loaded EAGERLY (the
 *  streaming resolvers' ctx.db dies when they return their iterable):
 *
 *  - every object the caller's role can READ, with fields — cross-object
 *    prompt context AND the ground truth the repair pass checks against. A
 *    role without the deal grant must not see deal fields in the prompt, get
 *    deal numbers in the summary, or have repair bless deal-targeting
 *    components the render-time procedures would then 403;
 *  - the live data summary for the target object (through the caller's OWN
 *    visibility, same acl record.aggregate builds), soft-failing — a flaky
 *    summary shouldn't block generation;
 *  - the effective research tools: what the admin allows for this role, with
 *    the user's auto-approve friction.
 *
 *  Unknown and unreadable objectKeys look identical (NOT_FOUND) on purpose.
 *  Detail mode without a target object degrades to dashboard mode. */
async function loadComposeContext(
  db: DbExecutor,
  auth: AuthContext,
  input: { objectKey?: string; mode: 'dashboard' | 'detail' },
) {
  const all = (await listObjectsWithFields(db, auth.organizationId)).filter((o) =>
    canObject(auth.permissions, o.object.id, 'read'),
  );
  const objectWithFields = input.objectKey
    ? (all.find((o) => o.object.key === input.objectKey) ?? null)
    : null;
  if (input.objectKey && !objectWithFields) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: `object '${input.objectKey}' not found`,
    });
  }
  const otherObjects: ObjectContext[] = all.filter(
    (o) => o.object.key !== objectWithFields?.object.key,
  );
  const objectFields: ObjectFieldsByKey = new Map(all.map((o) => [o.object.key, o.fields]));

  // Workspace scope has no single object to summarize — skipped.
  let summary: Awaited<ReturnType<typeof buildDataSummary>> | null = null;
  if (objectWithFields) {
    try {
      const adminish = isAdminish(auth.role);
      const sharedRecordIds =
        objectWithFields.object.defaultVisibility === 'private' && !adminish
          ? await visibleSharedRecordIds(
              db,
              { orgId: auth.organizationId, userId: auth.userId, role: auth.role },
              objectWithFields.object.id,
            )
          : [];
      summary = await buildDataSummary(db, {
        orgId: auth.organizationId,
        object: objectWithFields.object,
        fields: objectWithFields.fields,
        acl: { userId: auth.userId, sharedRecordIds, isAdminish: adminish },
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[ai] data summary failed', err);
      summary = { recordCount: 0, picklistCounts: [], numericSummary: null, dateSeries: null };
    }
  }

  const mode =
    input.mode === 'detail' && objectWithFields ? ('detail' as const) : ('dashboard' as const);

  const [policyRows, prefRows] = await Promise.all([
    listAiToolPolicies(db, auth.organizationId),
    listAiToolPrefs(db, { orgId: auth.organizationId, userId: auth.userId }),
  ]);
  const allowedTools = effectiveTools(
    policyRows.map((p) => ({ roleKey: p.roleKey, toolId: p.toolId, allowed: p.allowed })),
    prefRows.map((p) => ({ toolId: p.toolId, autoApprove: p.autoApprove })),
    auth.role,
    auth.permissions.isOwner,
  );

  return { all, objectWithFields, otherObjects, objectFields, summary, mode, allowedTools };
}

export const aiRouter = router({
  /** Streamed generation. Yields `{ type: 'partial' }` snapshots (note text
   *  first, then artifact components) while the model composes, then one
   *  `{ type: 'done' }` with the validated + metadata-repaired artifact, the
   *  model's note, any repair notes, and the model id. Pass `currentArtifact`
   *  to refine an existing dashboard instead of composing from scratch. */
  preview: permissionProcedure('view.write')
    .input(
      z.object({
        /** Omit for WORKSPACE scope (the Home page): no single target object;
         *  every live node in the result names its own objectKey. */
        objectKey: z.string().min(1).optional(),
        prompt: z.string().min(1).max(2000),
        currentArtifact: ArtifactLikeSchema.optional(),
        /** 'detail' composes a record-page LAYOUT for objectKey's object
         *  (RecordFields / RelatedList / StagePath / '@record' scoping)
         *  instead of a dashboard. Requires objectKey. */
        mode: z.enum(['dashboard', 'detail']).default('dashboard'),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const env = await gateAiGeneration(ctx.auth.userId, ctx.auth.organizationId);
      const { all, objectWithFields, otherObjects, objectFields, summary, mode, allowedTools } =
        await loadComposeContext(ctx.db, ctx.auth, input);

      // Captured for the generator below — ctx.db is dead once it runs.
      const { organizationId, userId, role, permissions } = ctx.auth;
      const objectId = objectWithFields?.object.id ?? null;
      const { objectKey, prompt, currentArtifact } = input;
      const composeInputs = {
        object: objectWithFields?.object ?? null,
        fields: objectWithFields?.fields ?? [],
        otherObjects,
      };
      const readableObjects = all;

      return (async function* () {
        // ── Phase 1: agentic research. Tool lifecycle streams to the drawer
        // as chips; non-auto-approved calls pause on the approval broker.
        let research = '';
        if (allowedTools.length > 0) {
          const channel = createEventChannel<ToolEvent>();
          const tools = buildResearchTools(allowedTools, {
            orgId: organizationId,
            userId,
            role,
            permissions,
            readable: readableObjects,
            runInOrg: (fn) => withOrgContext(rootDb(), organizationId, fn),
            emit: (ev) => channel.push(ev),
          });
          const researchDone = runResearch({
            prompt,
            objects: readableObjects,
            tools,
          }).finally(() => channel.close());
          for await (const ev of channel.drain()) {
            yield ev;
          }
          research = await researchDone;
        }

        // ── Phase 2: compose the artifact, grounded in the findings.
        const stream = streamArtifact({
          prompt,
          ...composeInputs,
          summary,
          currentArtifact,
          mode,
          research,
        });

        let lastYield = 0;
        for await (const partial of stream.partialStream) {
          const now = Date.now();
          if (now - lastYield < PARTIAL_INTERVAL_MS) continue;
          lastYield = now;
          yield { type: 'partial' as const, note: partial.note, artifact: partial.artifact };
        }
        const generation = await stream.result;
        // Three reply modes: patch (refinement edit against the current
        // artifact), full artifact, or note-only (an answer / clarifying
        // question — nothing changes on the page).
        let artifact: typeof generation.artifact | undefined;
        let patchNote: string | null = null;
        if (generation.patch && currentArtifact) {
          const patched = applyArtifactPatch(currentArtifact, generation.patch);
          artifact = patched.artifact as NonNullable<typeof generation.artifact>;
          if (patched.skipped > 0) {
            patchNote = `${patched.skipped} edit(s) referenced components that no longer exist`;
          }
        } else {
          artifact = generation.artifact;
        }
        const repaired = artifact
          ? repairArtifact(artifact, objectFields, { mode, baseObjectKey: objectKey })
          : null;
        const repairNotes = [...(repaired?.notes ?? []), ...(patchNote ? [patchNote] : [])];

        try {
          await withOrgContext(rootDb(), organizationId, (tx) =>
            writeAuditEvent(tx, {
              organizationId,
              userId,
              action: 'ai.previewed',
              targetType: 'object',
              targetId: objectId,
              meta: {
                objectKey: objectKey ?? 'workspace',
                model: env.ANTHROPIC_MODEL,
                promptLength: prompt.length,
                nodeCount: repaired?.artifact.components.length ?? 0,
                repairs: repairNotes.length,
                replyMode: generation.patch ? 'patch' : repaired ? 'artifact' : 'note',
                refinement: Boolean(currentArtifact),
              },
            }),
          );
        } catch (err) {
          // The artifact is already generated — don't fail the stream over
          // an audit hiccup.
          // eslint-disable-next-line no-console
          console.warn('[ai.preview] audit write failed', err);
        }

        yield {
          type: 'done' as const,
          artifact: repaired?.artifact ?? null,
          note: generation.note,
          repairs: repairNotes,
          summary,
          model: env.ANTHROPIC_MODEL,
        };
      })();
    }),

  /** Chat-first agentic turn against one agent preset. Streams the research
   *  tools' lifecycle events (tool-approval / tool-start / tool-end) exactly
   *  like ai.preview, plus 'text-delta' chunks of the reply and an
   *  '{ type: "artifact" }' snapshot whenever the model composes or patches
   *  the dashboard mid-turn, then one final 'chat-done' with the full text,
   *  the last repaired artifact (null = the turn composed nothing) and the
   *  persisted session id. Unlike ai.preview the thread is saved SERVER-side
   *  after the turn — the client never autosaves ai.chat threads. */
  chat: permissionProcedure('view.write')
    .input(
      z.object({
        /** Resume an existing thread; omit to start a new one. */
        sessionId: z.string().uuid().optional(),
        agentId: z.string().uuid(),
        /** Honored only when the agent's resolved model list allows it —
         *  otherwise the agent's first resolved model runs. */
        model: z.string().min(1).max(100).optional(),
        prompt: z.string().min(1).max(4000),
        currentArtifact: ArtifactLikeSchema.optional(),
        /** Omit for WORKSPACE scope — same semantics as ai.preview. */
        objectKey: z.string().min(1).optional(),
        mode: z.enum(['dashboard', 'detail']).default('dashboard'),
        /** The prior thread, replayed to the model (tool/artifact turns as
         *  short markers) — the server does not re-read it from the row. */
        messages: z.array(SessionMessageSchema).max(40).default([]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const env = await gateAiGeneration(ctx.auth.userId, ctx.auth.organizationId);

      // Role-gated agent load — invisible and missing look identical.
      const agent = await getAiAgent(ctx.db, ctx.auth.organizationId, input.agentId);
      if (
        !agent ||
        !agentVisibleToRole(agent.roleKeys, ctx.auth.role, ctx.auth.permissions.isOwner)
      ) {
        throw new TRPCError({ code: 'NOT_FOUND', message: 'agent not found' });
      }
      const model = pickChatModel(agent.models, env.ANTHROPIC_MODEL, input.model);

      const { all, objectWithFields, otherObjects, objectFields, summary, mode, allowedTools } =
        await loadComposeContext(ctx.db, ctx.auth, input);
      // The agent's allowlist only ever NARROWS what the role policy grants.
      const agentTools = intersectTools(allowedTools, agent.toolIds);

      // Existing row, for title/objectKey continuity on resume. A shared
      // (not owned) thread forks on save — upsertAiSession only updates rows
      // the caller owns.
      const existing = input.sessionId
        ? await getAiSessionForUser(ctx.db, {
            orgId: ctx.auth.organizationId,
            userId: ctx.auth.userId,
            role: ctx.auth.role,
            id: input.sessionId,
          })
        : null;

      // Captured for the generator below — ctx.db is dead once it runs.
      const { organizationId, userId, role, permissions } = ctx.auth;
      const { sessionId, prompt, objectKey, currentArtifact } = input;
      const priorMessages = input.messages;
      const agentRow = agent;
      const composeContext = {
        object: objectWithFields?.object ?? null,
        fields: objectWithFields?.fields ?? [],
        otherObjects,
        summary,
        objectFields,
        mode,
        ...(objectKey ? { baseObjectKey: objectKey } : {}),
        ...(currentArtifact ? { currentArtifact } : {}),
      };

      return (async function* () {
        const channel = createEventChannel<ToolEvent | ChatStreamEvent>();

        // Tool lifecycle events feed BOTH the client stream and the turns
        // persisted on the session row (start input + end status/summary).
        const startedCalls = new Map<string, unknown>();
        const toolTurns: AiSessionMessage[] = [];
        const emitTool = (ev: ToolEvent) => {
          if (ev.type === 'tool-approval' || ev.type === 'tool-start') {
            startedCalls.set(ev.callId, ev.input);
          } else {
            const started = startedCalls.get(ev.callId);
            toolTurns.push({
              kind: 'tool',
              toolId: ev.toolId,
              title: AI_TOOLS.find((t) => t.id === ev.toolId)?.title ?? ev.toolId,
              status: ev.status,
              ...(started !== undefined
                ? { inputSummary: clip(JSON.stringify(started), 2000) }
                : {}),
              ...(ev.summary ? { resultSummary: clip(ev.summary, 2000) } : {}),
            });
          }
          channel.push(ev);
        };

        const researchTools = buildResearchTools(agentTools, {
          orgId: organizationId,
          userId,
          role,
          permissions,
          readable: all,
          runInOrg: (fn) => withOrgContext(rootDb(), organizationId, fn),
          emit: emitTool,
        });

        const loopDone = runChatLoop({
          model,
          agent: { name: agentRow.name, systemPrompt: agentRow.systemPrompt },
          prompt,
          priorMessages,
          objects: all,
          researchTools,
          compose: composeContext,
          emit: (ev) => channel.push(ev),
        }).finally(() => channel.close());

        for await (const ev of channel.drain()) {
          yield ev;
        }
        const outcome = await loopDone;

        // Server-side persistence: prior thread + this turn's user text, tool
        // calls, artifact marker, and assistant text.
        const turnMessages: AiSessionMessage[] = [
          ...priorMessages,
          { kind: 'text', role: 'user', content: prompt },
          ...toolTurns,
          ...(outcome.artifact
            ? [
                {
                  kind: 'artifact',
                  note: `${outcome.artifact.components.length} components`,
                } satisfies AiSessionMessage,
              ]
            : []),
          ...(outcome.text
            ? [
                {
                  kind: 'text',
                  role: 'assistant',
                  content: clip(outcome.text, 4000),
                  ...(outcome.repairs.length
                    ? { repairs: outcome.repairs.map((r) => clip(r, 400)) }
                    : {}),
                } satisfies AiSessionMessage,
              ]
            : []),
        ];

        let savedId: string | null = null;
        try {
          savedId = await withOrgContext(rootDb(), organizationId, async (tx) => {
            const saved = await upsertAiSession(tx, {
              orgId: organizationId,
              userId,
              ...(sessionId ? { id: sessionId } : {}),
              // '__workspace__' mirrors the composer's WORKSPACE_KEY sentinel.
              objectKey: objectKey ?? existing?.objectKey ?? '__workspace__',
              title:
                existing && existing.userId === userId ? existing.title : clip(prompt.trim(), 120),
              messages: turnMessages.slice(-200),
              artifact: outcome.artifact ?? currentArtifact,
              agentId: agentRow.id,
              model,
            });
            await writeAuditEvent(tx, {
              organizationId,
              userId,
              action: 'ai.chatted',
              targetType: 'ai_agent',
              targetId: agentRow.id,
              meta: {
                agentKey: agentRow.key,
                model,
                objectKey: objectKey ?? 'workspace',
                promptLength: prompt.length,
                toolCalls: toolTurns.length,
                composed: Boolean(outcome.artifact),
                repairs: outcome.repairs.length,
              },
            });
            return saved.id;
          });
        } catch (err) {
          // The reply already streamed — don't fail the turn over persistence.
          // eslint-disable-next-line no-console
          console.warn('[ai.chat] session persist failed', err);
        }

        yield {
          type: 'chat-done' as const,
          text: outcome.text,
          artifact: outcome.artifact,
          repairs: outcome.repairs,
          model,
          agentId: agentRow.id,
          sessionId: savedId,
        };
      })();
    }),

  /* ── Research tools: approval, caller catalog, prefs, admin policy ────── */

  /** Approve/deny a parked tool call (the drawer's chip buttons). Ok:false =
   *  the call already timed out or resolved — the chip shows it as denied. */
  resolveTool: protectedProcedure
    .input(z.object({ callId: z.string().uuid(), approved: z.boolean() }))
    .mutation(({ input }) => ({ ok: resolveToolApproval(input.callId, input.approved) })),

  /** The caller's effective tool list — what their AI may use, with the
   *  auto-approve friction. Drives the drawer's tools popover. */
  tools: protectedProcedure.query(async ({ ctx }) => {
    const [policyRows, prefRows] = await Promise.all([
      listAiToolPolicies(ctx.db, ctx.auth.organizationId),
      listAiToolPrefs(ctx.db, { orgId: ctx.auth.organizationId, userId: ctx.auth.userId }),
    ]);
    return effectiveTools(
      policyRows.map((p) => ({ roleKey: p.roleKey, toolId: p.toolId, allowed: p.allowed })),
      prefRows.map((p) => ({ toolId: p.toolId, autoApprove: p.autoApprove })),
      ctx.auth.role,
      ctx.auth.permissions.isOwner,
    );
  }),

  /** Flip auto-approve for one of the caller's allowed tools. */
  toolPrefSet: protectedProcedure
    .input(z.object({ toolId: z.string().min(1), autoApprove: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      await setAiToolPref(ctx.db, {
        orgId: ctx.auth.organizationId,
        userId: ctx.auth.userId,
        toolId: input.toolId,
        autoApprove: input.autoApprove,
      });
      return { ok: true as const };
    }),

  /** Admin: the full catalog + per-role allowance matrix. */
  toolPolicyList: permissionProcedure('org.roles.manage').query(async ({ ctx }) => {
    const rows = await listAiToolPolicies(ctx.db, ctx.auth.organizationId);
    return {
      catalog: AI_TOOLS,
      overrides: rows.map((r) => ({ roleKey: r.roleKey, toolId: r.toolId, allowed: r.allowed })),
    };
  }),

  /** Admin: allow/deny one tool for one role. */
  toolPolicySet: permissionProcedure('org.roles.manage')
    .input(
      z.object({
        roleKey: z.string().min(1).max(48),
        toolId: z.string().min(1),
        allowed: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await setAiToolPolicy(ctx.db, {
        orgId: ctx.auth.organizationId,
        roleKey: input.roleKey,
        toolId: input.toolId,
        allowed: input.allowed,
      });
      await writeAuditEvent(ctx.db, {
        organizationId: ctx.auth.organizationId,
        userId: ctx.auth.userId,
        action: 'ai.tool_policy_changed',
        targetType: 'organization',
        targetId: null,
        meta: { roleKey: input.roleKey, toolId: input.toolId, allowed: input.allowed },
      });
      return { ok: true as const };
    }),

  /* ── Sessions — the composer's personal, resumable threads ─────────────
     Autosaved by the drawer after each completed generation. Strictly
     per-user: every query is scoped by (org, caller). */

  sessionList: protectedProcedure.query(({ ctx }) =>
    listAiSessions(ctx.db, {
      orgId: ctx.auth.organizationId,
      userId: ctx.auth.userId,
    }),
  ),

  sessionSave: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid().optional(),
        objectKey: z.string().min(1),
        title: z.string().min(1).max(120),
        messages: z.array(SessionMessageSchema).max(200),
        artifact: ArtifactLikeSchema.optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      upsertAiSession(ctx.db, {
        orgId: ctx.auth.organizationId,
        userId: ctx.auth.userId,
        id: input.id,
        objectKey: input.objectKey,
        title: input.title,
        messages: input.messages,
        artifact: input.artifact,
      }),
    ),

  sessionDelete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await deleteAiSession(ctx.db, {
        orgId: ctx.auth.organizationId,
        userId: ctx.auth.userId,
        id: input.id,
      });
      return { ok: true as const };
    }),

  /** Replace a thread's read-only shares. Owner-only by construction — the
   *  update is keyed on (id, org, caller); anyone else gets NOT_FOUND. */
  sessionShare: protectedProcedure
    .input(z.object({ id: z.string().uuid(), sharedWith: z.array(ShareTargetSchema).max(20) }))
    .mutation(async ({ ctx, input }) => {
      const ok = await setAiSessionShare(ctx.db, {
        orgId: ctx.auth.organizationId,
        userId: ctx.auth.userId,
        id: input.id,
        sharedWith: input.sharedWith,
      });
      if (!ok) throw new TRPCError({ code: 'NOT_FOUND', message: 'session not found' });
      return { ok: true as const };
    }),

  /** Threads OTHER users shared with the caller (org-wide, to their role, or
   *  directly). The caller's own threads live in sessionList. */
  sessionListShared: protectedProcedure.query(({ ctx }) =>
    listSharedAiSessions(ctx.db, {
      orgId: ctx.auth.organizationId,
      userId: ctx.auth.userId,
      role: ctx.auth.role,
    }),
  ),

  /** One thread the caller may read: their own, or one shared with them. */
  sessionGet: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const row = await getAiSessionForUser(ctx.db, {
        orgId: ctx.auth.organizationId,
        userId: ctx.auth.userId,
        role: ctx.auth.role,
        id: input.id,
      });
      if (!row) throw new TRPCError({ code: 'NOT_FOUND', message: 'session not found' });
      return row;
    }),
});
