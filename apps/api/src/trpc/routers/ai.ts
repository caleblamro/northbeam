// /trpc/ai — AI artifact generation for the `ai` view type (#11). For now
// just `generate`: takes a prompt + an object id, calls Claude with the
// object's metadata, and writes the artifact back onto the view's config.
//
// Future surface (deferred until the generation pipeline stabilises):
//   - `regenerate({viewId})` — re-run with the saved prompt
//   - `suggestPrompts({objectId})` — starter prompts based on object shape

import { generateArtifact } from '../../ai/artifact-generator.js';
import { loadEnv } from '@northbeam/config';
import { getObjectById, schema, writeAuditEvent } from '@northbeam/db';
import { TRPCError } from '@trpc/server';
import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { permissionProcedure, router } from '../trpc.js';

export const aiRouter = router({
  /** Generate an artifact and persist it onto the view's config. The view
   *  type isn't required to be `ai` — generation can run against any view
   *  (e.g. layering AI on top of a list); the AIRenderer is just the one
   *  that renders the artifact. */
  generate: permissionProcedure('view.write')
    .input(
      z.object({
        viewId: z.string().uuid(),
        prompt: z.string().min(1).max(2000),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const env = loadEnv();
      if (!env.ANTHROPIC_API_KEY) {
        throw new TRPCError({
          code: 'PRECONDITION_FAILED',
          message:
            'AI generation is not configured for this workspace. Set ANTHROPIC_API_KEY on the API to enable it.',
        });
      }

      // Load the view + its object's metadata. Org-scoped — Better Auth
      // sets the RLS GUC so this only finds views in the caller's org.
      const [view] = await ctx.db
        .select()
        .from(schema.view)
        .where(
          and(
            eq(schema.view.organizationId, ctx.auth.organizationId),
            eq(schema.view.id, input.viewId),
          ),
        )
        .limit(1);
      if (!view) {
        throw new TRPCError({ code: 'NOT_FOUND', message: `view '${input.viewId}' not found` });
      }

      const objectWithFields = await getObjectById(
        ctx.db,
        ctx.auth.organizationId,
        view.objectId,
      );
      if (!objectWithFields) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'object backing this view no longer exists',
        });
      }

      const artifact = await generateArtifact({
        prompt: input.prompt,
        object: objectWithFields.object,
        fields: objectWithFields.fields,
      });

      // Write back to the view's config. We preserve any unrelated config
      // keys the caller may have added in the future (custom settings,
      // pinned colours, etc.) by spreading the existing object first.
      const existingConfig = (view.config ?? {}) as Record<string, unknown>;
      const nextConfig = {
        ...existingConfig,
        prompt: input.prompt,
        model: env.ANTHROPIC_MODEL,
        artifact,
        generatedAt: new Date().toISOString(),
        error: undefined,
      };
      const [updated] = await ctx.db
        .update(schema.view)
        .set({ config: nextConfig, updatedAt: new Date() })
        .where(
          and(
            eq(schema.view.organizationId, ctx.auth.organizationId),
            eq(schema.view.id, input.viewId),
          ),
        )
        .returning();
      await writeAuditEvent(ctx.db, {
        organizationId: ctx.auth.organizationId,
        userId: ctx.auth.userId,
        action: 'ai.generated',
        targetType: 'view',
        targetId: input.viewId,
        meta: {
          model: env.ANTHROPIC_MODEL,
          promptLength: input.prompt.length,
          nodeCount: artifact.components.length,
        },
      });
      return updated;
    }),
});
