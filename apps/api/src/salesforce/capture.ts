// Write-back change capture. Called from the explicit local write sites (tRPC
// record procedures + the flow engine's record-service) — NEVER from the
// importer or the poll-sync apply path, which is half of the loop-prevention
// story (see sync.ts). The outbox write happens inside the caller's
// transaction; the queue enqueue is the post-commit half.
//
// The per-org toggle is cached briefly so capture adds no query to the hot
// write path in the common (sync disabled) case.

import { type DbExecutor, getConnection, markDirtyForSync } from '@northbeam/db';
import { enqueueWriteback } from '../queue/sf-sync.js';

const TOGGLE_TTL_MS = 60_000;
const toggleCache = new Map<string, { enabled: boolean; at: number }>();

/** For tests / the setSync mutation: drop the cached toggle for an org. */
export function invalidateWritebackToggle(orgId: string): void {
  toggleCache.delete(orgId);
}

async function writebackEnabled(tx: DbExecutor, orgId: string): Promise<boolean> {
  const hit = toggleCache.get(orgId);
  if (hit && Date.now() - hit.at < TOGGLE_TTL_MS) return hit.enabled;
  const conn = await getConnection(tx, orgId);
  const enabled = Boolean(conn?.writebackEnabled && conn.status === 'connected');
  toggleCache.set(orgId, { enabled, at: Date.now() });
  return enabled;
}

/** Record a local edit for push. Call inside the mutating transaction; run the
 *  returned closure after commit (ctx.postCommit / engine post-commit). */
export async function captureRecordChange(
  tx: DbExecutor,
  opts: { orgId: string; objectKey: string; recordId: string; changedKeys: string[] },
): Promise<(() => Promise<void>) | null> {
  if (!opts.changedKeys.length) return null;
  if (!(await writebackEnabled(tx, opts.orgId))) return null;
  await markDirtyForSync(tx, {
    orgId: opts.orgId,
    objectKey: opts.objectKey,
    recordId: opts.recordId,
    dirtyKeys: opts.changedKeys,
  });
  return () =>
    enqueueWriteback({ orgId: opts.orgId, objectKey: opts.objectKey, recordId: opts.recordId });
}
