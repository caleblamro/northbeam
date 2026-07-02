// Salesforce connection persistence (one connection per org for v1). Tokens are
// stored as ciphertext only — the API layer owns encrypt/decrypt; this module
// never sees plaintext.

import { and, eq } from 'drizzle-orm';
import type { DbExecutor } from '../client.js';
import { salesforceConnection } from '../schema.js';

export type SalesforceConnectionRow = typeof salesforceConnection.$inferSelect;
export type ConnectionStatus = 'connected' | 'disconnected' | 'error';

export async function getConnection(
  db: DbExecutor,
  orgId: string,
): Promise<SalesforceConnectionRow | null> {
  const [row] = await db
    .select()
    .from(salesforceConnection)
    .where(eq(salesforceConnection.organizationId, orgId))
    .limit(1);
  return row ?? null;
}

export async function upsertConnection(
  db: DbExecutor,
  opts: {
    orgId: string;
    instanceUrl: string;
    accessTokenEnc: string;
    refreshTokenEnc?: string | null;
    connectedBy?: string | null;
  },
): Promise<SalesforceConnectionRow> {
  const existing = await getConnection(db, opts.orgId);
  if (existing) {
    const [row] = await db
      .update(salesforceConnection)
      .set({
        instanceUrl: opts.instanceUrl,
        accessTokenEnc: opts.accessTokenEnc,
        refreshTokenEnc: opts.refreshTokenEnc ?? null,
        status: 'connected',
        connectedBy: opts.connectedBy ?? existing.connectedBy ?? null,
        updatedAt: new Date(),
      })
      .where(eq(salesforceConnection.id, existing.id))
      .returning();
    if (!row) throw new Error('connection update failed');
    return row;
  }
  const [row] = await db
    .insert(salesforceConnection)
    .values({
      organizationId: opts.orgId,
      instanceUrl: opts.instanceUrl,
      accessTokenEnc: opts.accessTokenEnc,
      refreshTokenEnc: opts.refreshTokenEnc ?? null,
      status: 'connected',
      connectedBy: opts.connectedBy ?? null,
    })
    .returning();
  if (!row) throw new Error('connection insert failed');
  return row;
}

export async function setConnectionStatus(
  db: DbExecutor,
  orgId: string,
  status: ConnectionStatus,
): Promise<void> {
  await db
    .update(salesforceConnection)
    .set({ status, updatedAt: new Date() })
    .where(eq(salesforceConnection.organizationId, orgId));
}

export async function deleteConnection(db: DbExecutor, orgId: string): Promise<void> {
  await db.delete(salesforceConnection).where(and(eq(salesforceConnection.organizationId, orgId)));
}

/**
 * Update only the token fields after a successful OAuth refresh. Narrower than
 * upsertConnection — avoids overwriting instanceUrl / connectedBy / status with
 * stale values and avoids the extra SELECT that upsert performs.
 *
 * If SF did not rotate the refresh token (refresh_token absent in the response),
 * omit `refreshTokenEnc` and the column is left unchanged.
 */
export async function rotateTokens(
  db: DbExecutor,
  orgId: string,
  opts: {
    accessTokenEnc: string;
    /** Pass the new encrypted refresh token only when SF returned a rotated one. */
    refreshTokenEnc?: string;
  },
): Promise<void> {
  await db
    .update(salesforceConnection)
    .set({
      accessTokenEnc: opts.accessTokenEnc,
      ...(opts.refreshTokenEnc !== undefined ? { refreshTokenEnc: opts.refreshTokenEnc } : {}),
      status: 'connected',
      updatedAt: new Date(),
    })
    .where(eq(salesforceConnection.organizationId, orgId));
}
