// /trpc/object — read the metadata layer (object defs + their fields). Powers
// the dynamic table/form renderers and the object-manager UI.

import { getObjectByKey, listObjects } from '@northbeam/db';
import { TRPCError } from '@trpc/server';
import { z } from 'zod';
import { protectedProcedure, router } from '../trpc.js';

export const objectRouter = router({
  /** All objects in the workspace (standard + custom + SF-imported). */
  list: protectedProcedure.query(({ ctx }) => listObjects(ctx.db, ctx.auth.organizationId)),

  /** One object by key, with its ordered fields. */
  get: protectedProcedure.input(z.object({ key: z.string() })).query(async ({ ctx, input }) => {
    const result = await getObjectByKey(ctx.db, ctx.auth.organizationId, input.key);
    if (!result) {
      throw new TRPCError({ code: 'NOT_FOUND', message: `object '${input.key}' not found` });
    }
    return result;
  }),
});
