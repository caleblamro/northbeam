// /trpc/audit — read the audit trail. Writes happen inline from the
// mutations that produce them (record.*, view.*, ai.generate,
// object.updateLayout) via writeAuditEvent in @northbeam/db. Read access is
// gated to admin+ because the trail includes who saw what.

import { listAuditEvents } from '@northbeam/db';
import { z } from 'zod';
import { permissionProcedure, router } from '../trpc.js';

export const auditRouter = router({
  list: permissionProcedure('org.settings.update')
    .input(
      z
        .object({
          limit: z.number().int().min(1).max(200).default(100),
          offset: z.number().int().nonnegative().default(0),
          actionPrefix: z.string().max(40).optional(),
          actorId: z.string().optional(),
        })
        .optional(),
    )
    .query(({ ctx, input }) =>
      listAuditEvents(ctx.db, {
        orgId: ctx.auth.organizationId,
        limit: input?.limit ?? 100,
        offset: input?.offset ?? 0,
        actionPrefix: input?.actionPrefix,
        actorId: input?.actorId,
      }),
    ),
});
