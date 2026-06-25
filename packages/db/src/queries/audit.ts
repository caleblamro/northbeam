// Audit log writer + reader. Every mutating tRPC procedure that changes
// user-visible state should call writeAuditEvent so the Setup → Audit Log
// page can answer "who did that and when?".
//
// Errors are swallowed in writeAuditEvent so a failed audit write never
// breaks the underlying mutation. The trade-off: a few events may go
// missing under load; we surface that in the UI as a soft warning when the
// log appears to skip ids.

import { type SQL, and, desc, eq } from 'drizzle-orm';
import type { DbExecutor } from '../client.js';
import { logger } from '../logger.js';
import { auditLog, user } from '../schema.js';

export type AuditEventRow = typeof auditLog.$inferSelect;

export type WriteAuditEventInput = {
  organizationId: string;
  userId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  meta?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
};

/** Append a single audit event. Never throws — a failed audit row is
 *  always better than a failed mutation. The caller has no result to act
 *  on, so we return void. */
export async function writeAuditEvent(
  db: DbExecutor,
  input: WriteAuditEventInput,
): Promise<void> {
  try {
    await db.insert(auditLog).values({
      organizationId: input.organizationId,
      userId: input.userId ?? null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId ?? null,
      meta: input.meta ?? {},
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
    });
  } catch (err) {
    // Audit writes are best-effort: the underlying mutation has already
    // succeeded; a failed log row is not worth bubbling. Route through the
    // structured logger so aggregation pipelines can alert on a spike instead
    // of relying on console output.
    logger.warn(
      { action: input.action, organizationId: input.organizationId, err },
      'audit.write_failed',
    );
  }
}

export type AuditEventWithActor = AuditEventRow & {
  actorName: string | null;
  actorEmail: string | null;
};

/** Page of recent events, newest first. Optional filters narrow by action
 *  prefix (e.g. 'record.') or by actor user id. */
export async function listAuditEvents(
  db: DbExecutor,
  opts: {
    orgId: string;
    limit?: number;
    offset?: number;
    actionPrefix?: string;
    actorId?: string;
  },
): Promise<AuditEventWithActor[]> {
  const conditions: SQL[] = [eq(auditLog.organizationId, opts.orgId)];
  if (opts.actorId) conditions.push(eq(auditLog.userId, opts.actorId));
  // Action filter uses a raw `like` because drizzle's `like` would force us
  // to interpolate the pattern through sql.placeholder. The user-supplied
  // value never reaches SQL — we sanitize to dot/letter/digit before use.
  let where: SQL | undefined = and(...conditions);
  if (opts.actionPrefix) {
    const safe = opts.actionPrefix.replace(/[^a-zA-Z0-9._-]/g, '');
    if (safe.length > 0) {
      const prefixed: SQL = (
        await import('drizzle-orm').then((m) => m.like(auditLog.action, `${safe}%`))
      ) as SQL;
      where = and(where, prefixed);
    }
  }

  const rows = await db
    .select({
      id: auditLog.id,
      organizationId: auditLog.organizationId,
      userId: auditLog.userId,
      action: auditLog.action,
      targetType: auditLog.targetType,
      targetId: auditLog.targetId,
      meta: auditLog.meta,
      ip: auditLog.ip,
      userAgent: auditLog.userAgent,
      createdAt: auditLog.createdAt,
      actorName: user.name,
      actorEmail: user.email,
    })
    .from(auditLog)
    .leftJoin(user, eq(user.id, auditLog.userId))
    .where(where)
    .orderBy(desc(auditLog.createdAt))
    .limit(opts.limit ?? 100)
    .offset(opts.offset ?? 0);
  return rows;
}
