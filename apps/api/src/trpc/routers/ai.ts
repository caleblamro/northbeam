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
import { ArtifactLikeSchema } from '@northbeam/core';
import {
  type AiSessionMessage,
  deleteAiSession,
  isAdminish,
  listAiSessions,
  listObjectsWithFields,
  upsertAiSession,
  visibleSharedRecordIds,
  withOrgContext,
  writeAuditEvent,
} from '@northbeam/db';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { type ObjectContext, streamArtifact } from '../../ai/artifact-generator.js';
import { buildDataSummary } from '../../ai/data-summary.js';
import { type ObjectFieldsByKey, repairArtifact } from '../../ai/repair-artifact.js';
import { fixedWindow } from '../../lib/rate-limit.js';
import { redis } from '../../queue/connection.js';
import { rootDb } from '../context.js';
import { permissionProcedure, protectedProcedure, router } from '../trpc.js';

const SessionMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().max(4000),
  repairs: z.array(z.string().max(400)).optional(),
}) satisfies z.ZodType<AiSessionMessage>;

/** Minimum gap between streamed partial snapshots. Each snapshot re-sends the
 *  whole partial payload, so unthrottled streaming is O(n²) bytes. */
const PARTIAL_INTERVAL_MS = 150;

/* Cost guard on generation — fixed windows, fail-open (see lib/rate-limit).
 * Per-user damps a runaway individual; per-org caps the workspace's daily
 * LLM spend. TOO_MANY_REQUESTS is already mapped to a friendly message in
 * the web error formatter. */
const USER_LIMIT = { max: 10, windowSec: 10 * 60 };
const ORG_LIMIT = { max: 200, windowSec: 24 * 60 * 60 };

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
      const env = loadEnv();
      if (!env.ANTHROPIC_API_KEY) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message:
            'AI generation is not configured. Set ANTHROPIC_API_KEY on the API to enable it.',
        });
      }

      // Cost guard before any DB work. Fail-open on Redis trouble.
      const [userGate, orgGate] = await Promise.all([
        fixedWindow(
          redis(),
          `ai:preview:u:${ctx.auth.userId}`,
          USER_LIMIT.max,
          USER_LIMIT.windowSec,
        ),
        fixedWindow(
          redis(),
          `ai:preview:o:${ctx.auth.organizationId}`,
          ORG_LIMIT.max,
          ORG_LIMIT.windowSec,
        ),
      ]);
      const blocked = !userGate.ok ? userGate : !orgGate.ok ? orgGate : null;
      if (blocked) {
        const mins = Math.max(1, Math.ceil(blocked.resetSec / 60));
        throw new TRPCError({
          code: 'TOO_MANY_REQUESTS',
          message: `AI generation limit reached — try again in ~${mins} min.`,
        });
      }

      // Every org object's fields in two queries: cross-object context for
      // the prompt AND the ground truth the repair pass checks specs against.
      const all = await listObjectsWithFields(ctx.db, ctx.auth.organizationId);
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

      // Pre-flight: pull the live numbers so Claude composes against truth —
      // through the caller's OWN visibility (same acl record.aggregate builds),
      // so the note never cites numbers the rendered dashboard won't show.
      // Wrapped in try/catch — a flaky summary shouldn't block generation,
      // and the prompt explicitly tells Claude to mark sample values when
      // the summary doesn't cover a metric. Workspace scope has no single
      // object to summarize — the prompt's live-summary section is skipped.
      let summary: Awaited<ReturnType<typeof buildDataSummary>> | null = null;
      if (objectWithFields) {
        try {
          const adminish = isAdminish(ctx.auth.role);
          const sharedRecordIds =
            objectWithFields.object.defaultVisibility === 'private' && !adminish
              ? await visibleSharedRecordIds(
                  ctx.db,
                  {
                    orgId: ctx.auth.organizationId,
                    userId: ctx.auth.userId,
                    role: ctx.auth.role,
                  },
                  objectWithFields.object.id,
                )
              : [];
          summary = await buildDataSummary(ctx.db, {
            orgId: ctx.auth.organizationId,
            object: objectWithFields.object,
            fields: objectWithFields.fields,
            acl: { userId: ctx.auth.userId, sharedRecordIds, isAdminish: adminish },
          });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('[ai.preview] data summary failed', err);
          summary = { recordCount: 0, picklistCounts: [], numericSummary: null, dateSeries: null };
        }
      }

      // Detail mode needs a target object — degrade to dashboard mode when
      // the caller forgot one rather than failing the generation.
      const mode = input.mode === 'detail' && objectWithFields ? 'detail' : 'dashboard';

      const stream = streamArtifact({
        prompt: input.prompt,
        object: objectWithFields?.object ?? null,
        fields: objectWithFields?.fields ?? [],
        summary,
        currentArtifact: input.currentArtifact,
        otherObjects,
        mode,
      });

      // Captured for the generator below — ctx.db is dead once it runs.
      const { organizationId, userId } = ctx.auth;
      const objectId = objectWithFields?.object.id ?? null;
      const { objectKey, prompt, currentArtifact } = input;

      return (async function* () {
        let lastYield = 0;
        for await (const partial of stream.partialStream) {
          const now = Date.now();
          if (now - lastYield < PARTIAL_INTERVAL_MS) continue;
          lastYield = now;
          yield { type: 'partial' as const, note: partial.note, artifact: partial.artifact };
        }
        const generation = await stream.result;
        const repaired = repairArtifact(generation.artifact, objectFields, {
          mode,
          baseObjectKey: objectKey,
        });

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
                nodeCount: repaired.artifact.components.length,
                repairs: repaired.notes.length,
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
          artifact: repaired.artifact,
          note: generation.note,
          repairs: repaired.notes,
          summary,
          model: env.ANTHROPIC_MODEL,
        };
      })();
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
});
