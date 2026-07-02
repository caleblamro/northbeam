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
  getObjectByKey,
  listAiSessions,
  listObjects,
  upsertAiSession,
  withOrgContext,
  writeAuditEvent,
} from '@northbeam/db';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { type ObjectContext, streamArtifact } from '../../ai/artifact-generator.js';
import { buildDataSummary } from '../../ai/data-summary.js';
import { type ObjectFieldsByKey, repairArtifact } from '../../ai/repair-artifact.js';
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

export const aiRouter = router({
  /** Streamed generation. Yields `{ type: 'partial' }` snapshots (note text
   *  first, then artifact components) while the model composes, then one
   *  `{ type: 'done' }` with the validated + metadata-repaired artifact, the
   *  model's note, any repair notes, and the model id. Pass `currentArtifact`
   *  to refine an existing dashboard instead of composing from scratch. */
  preview: permissionProcedure('view.write')
    .input(
      z.object({
        objectKey: z.string().min(1),
        prompt: z.string().min(1).max(2000),
        currentArtifact: ArtifactLikeSchema.optional(),
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

      const objectWithFields = await getObjectByKey(
        ctx.db,
        ctx.auth.organizationId,
        input.objectKey,
      );
      if (!objectWithFields) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `object '${input.objectKey}' not found`,
        });
      }

      // Every org object's fields: cross-object context for the prompt AND
      // the ground truth the repair pass checks query specs against.
      const others = await listObjects(ctx.db, ctx.auth.organizationId);
      const otherObjects: ObjectContext[] = [];
      const objectFields: ObjectFieldsByKey = new Map([
        [objectWithFields.object.key, objectWithFields.fields],
      ]);
      for (const o of others) {
        if (o.key === objectWithFields.object.key) continue;
        const withFields = await getObjectByKey(ctx.db, ctx.auth.organizationId, o.key);
        if (!withFields) continue;
        otherObjects.push(withFields);
        objectFields.set(o.key, withFields.fields);
      }

      // Pre-flight: pull the live numbers so Claude composes against truth.
      // Wrapped in try/catch — a flaky summary shouldn't block generation,
      // and the prompt explicitly tells Claude to mark sample values when
      // the summary doesn't cover a metric.
      let summary: Awaited<ReturnType<typeof buildDataSummary>>;
      try {
        summary = await buildDataSummary(ctx.db, {
          orgId: ctx.auth.organizationId,
          object: objectWithFields.object,
          fields: objectWithFields.fields,
        });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[ai.preview] data summary failed', err);
        summary = { recordCount: 0, picklistCounts: [], numericSummary: null };
      }

      const stream = streamArtifact({
        prompt: input.prompt,
        object: objectWithFields.object,
        fields: objectWithFields.fields,
        summary,
        currentArtifact: input.currentArtifact,
        otherObjects,
      });

      // Captured for the generator below — ctx.db is dead once it runs.
      const { organizationId, userId } = ctx.auth;
      const objectId = objectWithFields.object.id;
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
        const repaired = repairArtifact(generation.artifact, objectFields);

        try {
          await withOrgContext(rootDb(), organizationId, (tx) =>
            writeAuditEvent(tx, {
              organizationId,
              userId,
              action: 'ai.previewed',
              targetType: 'object',
              targetId: objectId,
              meta: {
                objectKey,
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
