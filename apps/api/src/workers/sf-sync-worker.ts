// Two-way Salesforce sync worker: write-back pushes (outbox-driven) and the
// repeatable poll tick. Both processors are gated by per-org toggles on the
// connection row and are strictly bounded in API usage:
//   writeback — one PATCH (or POST for locally-created records) per record,
//               coalesced via the outbox's unioned dirty keys.
//   poll      — one Id+SystemModstamp probe per imported object per tick;
//               full-field fetches only for records that changed AND exist
//               locally. Records unknown to Northbeam are skipped (subtree
//               discipline) but still advance the cursor.
//
// Loop prevention (see salesforce/sync.ts header): capture happens only at
// explicit local write sites; poll applies bypass capture entirely; diffInbound
// turns write-back echoes into no-ops; flows are NOT dispatched for poll
// applies (imports set that precedent — SF-originated changes already ran
// their automation in SF).

import { logger } from '@northbeam/core';
import {
  type Database,
  type DbExecutor,
  clearOutboxRow,
  getConnection,
  getCursor,
  getObjectByKey,
  getOutboxRow,
  getRecord,
  recordIdsBySalesforceIds,
  schema,
  setCursor,
  setRecordSalesforceId,
  updateRecord,
  withOrgContext,
} from '@northbeam/db';
import { createDb } from '@northbeam/db';
import type { SalesforceClient } from '@northbeam/salesforce';
import { Worker } from 'bullmq';
import { and, desc, eq } from 'drizzle-orm';
import { env } from '../lib/env.js';
import { enqueueCompute } from '../queue/compute.js';
import { redis } from '../queue/connection.js';
import { SF_SYNC_QUEUE, type SfSyncJobData } from '../queue/sf-sync.js';
import { clientForOrgBackground } from '../salesforce/client.js';
import type { ProposedField } from '../salesforce/mapper.js';
import {
  diffInbound,
  fromSalesforceValue,
  toSalesforceValue,
  writebackFields,
} from '../salesforce/sync.js';

let cachedDb: Database | undefined;
function db(): Database {
  if (!cachedDb) cachedDb = createDb(env().DATABASE_URL);
  return cachedDb;
}

const run = <T>(orgId: string, fn: (tx: DbExecutor) => Promise<T>) =>
  withOrgContext(db(), orgId, fn);

/** The most recent mapping for an object across all runs — the sync contract
 *  (field key ↔ SF field name) survives run deletion only as long as the
 *  mapping rows do, so we always read the newest. */
async function latestPlan(
  tx: DbExecutor,
  orgId: string,
  objectKey: string,
): Promise<{ sfObject: string; fields: ProposedField[] } | null> {
  const [om] = await tx
    .select({
      id: schema.objectMapping.id,
      sfObject: schema.objectMapping.sfObject,
    })
    .from(schema.objectMapping)
    .innerJoin(schema.objectDef, eq(schema.objectDef.id, schema.objectMapping.targetObjectId))
    .where(and(eq(schema.objectMapping.organizationId, orgId), eq(schema.objectDef.key, objectKey)))
    .orderBy(desc(schema.objectMapping.createdAt))
    .limit(1);
  if (!om) return null;
  const fms = await tx
    .select()
    .from(schema.fieldMapping)
    .where(
      and(
        eq(schema.fieldMapping.organizationId, orgId),
        eq(schema.fieldMapping.objectMappingId, om.id),
      ),
    );
  return {
    sfObject: om.sfObject,
    fields: fms.map((fm) => ({
      ...(fm.meta as unknown as ProposedField),
      status: fm.status as ProposedField['status'],
    })),
  };
}

async function processWriteback(orgId: string, objectKey: string, recordId: string): Promise<void> {
  const conn = await run(orgId, (tx) => getConnection(tx, orgId));
  if (!conn?.writebackEnabled || conn.status !== 'connected') return;

  const ctx = await run(orgId, async (tx) => {
    const outbox = await getOutboxRow(tx, orgId, objectKey, recordId);
    const loaded = await getObjectByKey(tx, orgId, objectKey);
    if (!outbox || !loaded) return null;
    const record = await getRecord(tx, {
      orgId,
      object: loaded.object,
      fields: loaded.fields,
      id: recordId,
    });
    const plan = await latestPlan(tx, orgId, objectKey);
    return record && plan ? { outbox, loaded, record, plan } : null;
  });
  if (!ctx) return;
  const { outbox, loaded, record, plan } = ctx;

  const pushable = writebackFields(plan.fields);
  // Creates push every populated pushable field; updates push dirty keys only.
  const keys = record.salesforceId
    ? outbox.dirtyKeys.filter((k) => pushable.has(k))
    : [...pushable.keys()].filter((k) => record.data[k] != null && record.data[k] !== '');

  // Resolve reference values to SF ids up-front (skip unlinked targets).
  const sfIdCache = new Map<string, string | null>();
  const sfIdOf = (targetKey: string, id: string): string | null =>
    sfIdCache.get(`${targetKey}:${id}`) ?? null;
  for (const k of keys) {
    const f = pushable.get(k);
    if (!f || (f.type !== 'reference' && f.type !== 'reference_any')) continue;
    const v = record.data[k];
    if (v == null || v === '') continue;
    const [targetKey, targetId] =
      f.type === 'reference' ? [f.targetObject as string, String(v)] : String(v).split(':');
    if (!targetKey || !targetId) continue;
    const cacheKey = `${targetKey}:${targetId}`;
    if (!sfIdCache.has(cacheKey)) {
      const sfid = await run(orgId, async (tx) => {
        const target = await getObjectByKey(tx, orgId, targetKey);
        if (!target) return null;
        const row = await getRecord(tx, {
          orgId,
          object: target.object,
          fields: target.fields,
          id: targetId,
        });
        return row?.salesforceId ?? null;
      });
      sfIdCache.set(cacheKey, sfid);
    }
  }

  const payload: Record<string, unknown> = {};
  for (const k of keys) {
    const f = pushable.get(k);
    if (!f) continue;
    const conv = toSalesforceValue(f.type, record.data[k], sfIdOf, f.targetObject);
    if (conv.ok) payload[f.sfField] = conv.value;
  }
  if (Object.keys(payload).length === 0) {
    await run(orgId, (tx) => clearOutboxRow(tx, outbox));
    return;
  }

  const client = await clientForOrgBackground(db(), orgId);
  if (record.salesforceId) {
    await client.updateRecord(plan.sfObject, record.salesforceId, payload);
  } else {
    const newId = await client.createRecord(plan.sfObject, payload);
    await run(orgId, (tx) =>
      setRecordSalesforceId(tx, {
        orgId,
        object: loaded.object,
        id: recordId,
        salesforceId: newId,
      }),
    );
  }
  const cleared = await run(orgId, (tx) => clearOutboxRow(tx, outbox));
  logger.info(
    { orgId, objectKey, recordId, fields: Object.keys(payload).length, cleared },
    'sf-sync.writeback',
  );
}

const POLL_PROBE_LIMIT = 500;
const FETCH_CHUNK = 200;

async function processPoll(orgId: string, client?: SalesforceClient): Promise<void> {
  const conn = await run(orgId, (tx) => getConnection(tx, orgId));
  if (!conn?.pollEnabled || conn.status !== 'connected') return;
  const sf = client ?? (await clientForOrgBackground(db(), orgId));

  // Every object with a mapping AND local salesforce-linked rows.
  const targets = await run(orgId, async (tx) => {
    const oms = await tx
      .selectDistinct({ key: schema.objectDef.key })
      .from(schema.objectMapping)
      .innerJoin(schema.objectDef, eq(schema.objectDef.id, schema.objectMapping.targetObjectId))
      .where(eq(schema.objectMapping.organizationId, orgId));
    return oms.map((o) => o.key);
  });

  for (const objectKey of targets) {
    try {
      await pollObject(orgId, objectKey, sf);
    } catch (err) {
      logger.error({ orgId, objectKey, err }, 'sf-sync.poll_object_failed');
    }
  }
}

async function pollObject(orgId: string, objectKey: string, sf: SalesforceClient): Promise<void> {
  const setup = await run(orgId, async (tx) => {
    const loaded = await getObjectByKey(tx, orgId, objectKey);
    const plan = await latestPlan(tx, orgId, objectKey);
    const cursor = await getCursor(tx, orgId, objectKey);
    return loaded && plan ? { loaded, plan, cursor } : null;
  });
  if (!setup) return;
  const { loaded, plan, cursor } = setup;

  // First tick: start from NOW — history was covered by the import.
  if (!cursor) {
    const nowIso = new Date().toISOString().replace(/\.\d{3}Z$/, '.000+0000');
    await run(orgId, (tx) =>
      setCursor(tx, { orgId, objectKey, sfObject: plan.sfObject, lastModstamp: nowIso }),
    );
    return;
  }

  const probe = await sf.query<{ Id: string; SystemModstamp: string }>(
    `SELECT Id, SystemModstamp FROM ${plan.sfObject} WHERE SystemModstamp > ${cursor.lastModstamp} ORDER BY SystemModstamp ASC LIMIT ${POLL_PROBE_LIMIT}`,
  );
  if (!probe.records.length) return;
  const maxStamp = probe.records[probe.records.length - 1]?.SystemModstamp as string;

  const known = await run(orgId, (tx) =>
    recordIdsBySalesforceIds(tx, {
      orgId,
      object: loaded.object,
      salesforceIds: probe.records.map((r) => r.Id),
    }),
  );

  let applied = 0;
  if (known.size > 0) {
    const mapped = plan.fields.filter((f) => f.status === 'mapped');
    const select = [...new Set(['Id', ...mapped.map((f) => f.sfField)])];
    const ids = [...known.keys()];
    for (let i = 0; i < ids.length; i += FETCH_CHUNK) {
      const chunk = ids.slice(i, i + FETCH_CHUNK);
      const quoted = chunk.map((x) => `'${x.replace(/[^a-zA-Z0-9]/g, '')}'`).join(',');
      const rows = await sf.query<Record<string, unknown>>(
        `SELECT ${select.join(', ')} FROM ${plan.sfObject} WHERE Id IN (${quoted})`,
      );
      for (const raw of rows.records) {
        const localId = known.get(String(raw.Id));
        if (!localId) continue;
        applied += (await applyInbound(orgId, loaded, mapped, localId, raw)) ? 1 : 0;
      }
    }
    if (applied > 0) await enqueueCompute({ orgId, objectKey, reason: 'sf-sync' });
  }

  await run(orgId, (tx) =>
    setCursor(tx, { orgId, objectKey, sfObject: plan.sfObject, lastModstamp: maxStamp }),
  );
  logger.info(
    { orgId, objectKey, changed: probe.records.length, known: known.size, applied },
    'sf-sync.poll',
  );
}

/** Apply one inbound SF row to its local record. Data + resolvable reference
 *  fields; only keys whose value actually differs (echo suppression). */
async function applyInbound(
  orgId: string,
  loaded: NonNullable<Awaited<ReturnType<typeof getObjectByKey>>>,
  mapped: ProposedField[],
  localId: string,
  raw: Record<string, unknown>,
): Promise<boolean> {
  return run(orgId, async (tx) => {
    const current = await getRecord(tx, {
      orgId,
      object: loaded.object,
      fields: loaded.fields,
      id: localId,
    });
    if (!current) return false;
    const fieldRows = new Map(loaded.fields.map((f) => [f.key, f]));

    const incoming: Record<string, unknown> = {};
    for (const pf of mapped) {
      const fr = fieldRows.get(pf.key);
      if (!fr) continue;
      if (pf.type === 'reference') {
        const sfid = raw[pf.sfField];
        if (typeof sfid !== 'string' || !sfid) {
          incoming[pf.key] = null;
          continue;
        }
        const target = pf.config.targetObject
          ? await getObjectByKey(tx, orgId, pf.config.targetObject as string)
          : null;
        if (!target) continue; // unresolvable — leave local value alone
        const m = await recordIdsBySalesforceIds(tx, {
          orgId,
          object: target.object,
          salesforceIds: [sfid],
        });
        const local = m.get(sfid);
        if (local) incoming[pf.key] = local;
        // Target not imported locally → skip the key (don't null a valid link).
      } else if (pf.type !== 'reference_any') {
        // (reference_any: v1 poll does not rewrite polymorphic links —
        // write-back still pushes them outward.)
        incoming[pf.key] = fromSalesforceValue(pf.type, raw[pf.sfField]);
      }
    }

    const changedKeys = diffInbound(
      [...fieldRows.values()].filter((f) => f.key in incoming),
      incoming,
      current.data,
    );
    if (!changedKeys.length) return false; // echo or no-op — chain ends here

    const patch: Record<string, unknown> = {};
    for (const k of changedKeys) patch[k] = incoming[k];
    await updateRecord(tx, {
      orgId,
      object: loaded.object,
      fields: loaded.fields,
      id: localId,
      data: patch,
    });
    return true;
  });
}

export function startSfSyncWorker(): Worker<SfSyncJobData> {
  const worker = new Worker<SfSyncJobData>(
    SF_SYNC_QUEUE,
    async (job) => {
      if (job.data.kind === 'writeback') {
        await processWriteback(job.data.orgId, job.data.objectKey, job.data.recordId);
      } else {
        await processPoll(job.data.orgId);
      }
    },
    { connection: redis(), concurrency: 2 },
  );
  worker.on('failed', (job, err) => {
    logger.error({ data: job?.data, err }, 'sf-sync.failed');
  });
  return worker;
}
