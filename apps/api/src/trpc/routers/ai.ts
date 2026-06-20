// /trpc/ai — AI artifact generation for the ⌘K palette dialog. The
// procedure is read-only: it composes an artifact and returns it inline.
// Persistence is not part of the v1 contract — the dialog renders the
// result; the user closes it; no view row is touched.

import { generateArtifact } from '../../ai/artifact-generator.js';
import { buildDataSummary } from '../../ai/data-summary.js';
import { loadEnv } from '@northbeam/config';
import { getObjectByKey, writeAuditEvent } from '@northbeam/db';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { permissionProcedure, router } from '../trpc.js';

export const aiRouter = router({
  /** One-shot generation. Returns the artifact + the live data summary that
   *  fed the prompt. No DB writes besides the audit row. */
  preview: permissionProcedure('view.write')
    .input(
      z.object({
        objectKey: z.string().min(1),
        prompt: z.string().min(1).max(2000),
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

      // Pre-flight: pull the live numbers so Claude composes against truth.
      // Wrapped in try/catch — a flaky summary shouldn't block generation,
      // and the prompt explicitly tells Claude to mark sample values when
      // the summary doesn't cover a metric.
      let summary;
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

      const artifact = await generateArtifact({
        prompt: input.prompt,
        object: objectWithFields.object,
        fields: objectWithFields.fields,
        summary,
      });

      await writeAuditEvent(ctx.db, {
        organizationId: ctx.auth.organizationId,
        userId: ctx.auth.userId,
        action: 'ai.previewed',
        targetType: 'object',
        targetId: objectWithFields.object.id,
        meta: {
          objectKey: input.objectKey,
          model: env.ANTHROPIC_MODEL,
          promptLength: input.prompt.length,
          nodeCount: artifact.components.length,
        },
      });

      return { artifact, summary };
    }),
});
