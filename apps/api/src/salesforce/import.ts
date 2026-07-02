// The import pipeline: (1) materialize the reviewed mapping into object_def /
// field_def / record_type rows + physical tables (DDL), (2) stream records out of
// Salesforce in pages and bulk-insert them, (3) resolve reference columns by
// salesforce_id in a final set-based pass. Owner mapping matches SF Users to
// workspace members by email.
//
// Runs in-process (kicked from the tRPC `execute` mutation without await) and
// reports progress by writing migration_run.stats — fine for v1; move behind a
// queue for production-sized orgs.

import {
  type Database,
  type DbExecutor,
  type FieldRow,
  type ImportRow,
  addField,
  bulkInsertRecords,
  createObjectTable,
  displayName,
  fieldColumnName,
  getObjectByKey,
  pgTypeFor,
  resolveReferencesBySfid,
  schema,
  withOrgContext,
} from '@northbeam/db';
import type { SalesforceClient } from '@northbeam/salesforce';
import { eq } from 'drizzle-orm';
import { enqueueCompute } from '../queue/compute.js';
import { flagIfAuthError } from './client.js';
import type { MappedObject, ProposedField } from './mapper.js';

const BATCH = 500;

// Deliberate product cap, not a placeholder: a migration imports at most this
// many records per object — it's a working slice of the org, not a full sync.
export const MAX_RECORDS_PER_OBJECT = 100;

type Plan = {
  mappingId: string;
  obj: MappedObject; // meta minus fields
  fields: ProposedField[]; // post-review: status reflects user edits
};

type Stats = NonNullable<typeof schema.migrationRun.$inferSelect.stats>;

export async function executeRun(
  db: Database,
  client: SalesforceClient,
  orgId: string,
  runId: string,
): Promise<void> {
  const stats: Stats = { objects: 0, fields: 0, records: 0, imported: 0, refsResolved: 0 };

  // The mutation that fires `void executeRun(...)` has already committed its
  // own short transaction. We need a fresh RLS context that lasts as long as
  // this background work — wrap each phase in `withOrgContext` so the GUC is
  // re-established for every batch (one transaction per phase keeps lock hold
  // times short on long imports).
  const run = <T>(fn: (tx: DbExecutor) => Promise<T>) => withOrgContext(db, orgId, fn);

  const writeStats = async (status?: 'running' | 'completed' | 'failed') => {
    await run((tx) =>
      tx
        .update(schema.migrationRun)
        .set({
          stats,
          ...(status ? { status } : {}),
          ...(status === 'completed' ? { completedAt: new Date() } : {}),
        })
        .where(eq(schema.migrationRun.id, runId)),
    );
  };

  try {
    await run((tx) =>
      tx
        .update(schema.migrationRun)
        .set({ status: 'running', startedAt: new Date() })
        .where(eq(schema.migrationRun.id, runId)),
    );

    const plans = await run((tx) => loadPlans(tx, runId));
    stats.objects = plans.length;
    stats.fields = plans.reduce(
      (n, p) => n + p.fields.filter((f) => f.status === 'mapped').length,
      0,
    );
    await writeStats();

    // 1 — defs + DDL + record types. Each ensureDefs is its own transaction so
    // a single bad plan doesn't poison the whole import.
    const rtMaps = new Map<string, Map<string, string>>(); // targetKey → (sf RT id → our uuid)
    for (const plan of plans) {
      rtMaps.set(plan.obj.targetKey, await run((tx) => ensureDefs(tx, orgId, plan)));
    }

    // 2 — owner map (SF user id → workspace user id, by email)
    const ownerMap = await run((tx) => buildOwnerMap(tx, client, orgId));

    // 3 — stream + insert per object; collect reference pairs for the final pass
    const refTasks: Array<{
      objectKey: string;
      fieldKey: string;
      targetKey: string;
      pairs: Array<{ sfId: string; refSfId: string }>;
    }> = [];

    for (const plan of plans) {
      stats.currentObject = plan.obj.label;
      await writeStats();

      const loaded = await run((tx) => getObjectByKey(tx, orgId, plan.obj.targetKey));
      if (!loaded) continue;
      const fieldByKey = new Map(loaded.fields.map((f) => [f.key, f]));

      const active = plan.fields.filter((f) => f.status === 'mapped' && fieldByKey.has(f.key));
      const refActive = active.filter((f) => f.type === 'reference' && f.config.targetObject);
      const dataActive = active.filter((f) => f.type !== 'reference');
      const dataFieldRows = dataActive.map((f) => fieldByKey.get(f.key) as FieldRow);

      const refPairs = new Map<string, Array<{ sfId: string; refSfId: string }>>();
      for (const rf of refActive) refPairs.set(rf.key, []);

      const select = [
        ...new Set(
          [
            'Id',
            plan.obj.nameFieldSf,
            plan.obj.hasOwner ? 'OwnerId' : null,
            plan.obj.hasRecordTypes ? 'RecordTypeId' : null,
            plan.obj.hasCreatedDate ? 'CreatedDate' : null,
            ...active.map((f) => f.sfField),
          ].filter((s): s is string => Boolean(s)),
        ),
      ];
      // LIMIT enforces the per-object cap at the source — queryAll never
      // streams more than MAX_RECORDS_PER_OBJECT rows for this object.
      const soql = `SELECT ${select.join(', ')} FROM ${plan.obj.sfObject} LIMIT ${MAX_RECORDS_PER_OBJECT}`;
      const rtMap = rtMaps.get(plan.obj.targetKey) ?? new Map<string, string>();

      let batch: ImportRow[] = [];
      const flush = async () => {
        if (!batch.length) return;
        stats.imported =
          (stats.imported ?? 0) +
          (await run((tx) =>
            bulkInsertRecords(tx, {
              orgId,
              object: loaded.object,
              fields: dataFieldRows,
              rows: batch,
            }),
          ));
        batch = [];
        await writeStats();
      };

      for await (const raw of client.queryAll(soql)) {
        const sfId = String(raw.Id);
        const data: Record<string, unknown> = {};
        for (const pf of dataActive) data[pf.key] = convert(pf, raw[pf.sfField]);
        for (const pf of refActive) {
          const v = raw[pf.sfField];
          if (typeof v === 'string' && v) {
            refPairs.get(pf.key)?.push({ sfId, refSfId: v });
          }
        }
        const nameRaw = plan.obj.nameFieldSf ? raw[plan.obj.nameFieldSf] : null;
        batch.push({
          salesforceId: sfId,
          name: nameRaw
            ? String(nameRaw)
            : displayName(loaded.fields, data, loaded.object.nameExpression),
          ownerId:
            plan.obj.hasOwner && typeof raw.OwnerId === 'string'
              ? (ownerMap.get(raw.OwnerId) ?? null)
              : null,
          recordTypeId:
            plan.obj.hasRecordTypes && typeof raw.RecordTypeId === 'string'
              ? (rtMap.get(raw.RecordTypeId) ?? null)
              : null,
          createdAt:
            plan.obj.hasCreatedDate && typeof raw.CreatedDate === 'string' ? raw.CreatedDate : null,
          data,
        });
        stats.records = (stats.records ?? 0) + 1;
        if (batch.length >= BATCH) await flush();
      }
      await flush();

      for (const rf of refActive) {
        refTasks.push({
          objectKey: plan.obj.targetKey,
          fieldKey: rf.key,
          targetKey: rf.config.targetObject as string,
          pairs: refPairs.get(rf.key) ?? [],
        });
      }
    }

    // 4 — resolve references (after ALL objects are loaded, so forward refs work)
    stats.currentObject = 'Resolving references';
    await writeStats();
    for (const task of refTasks) {
      const result = await run(async (tx) => {
        const child = await getObjectByKey(tx, orgId, task.objectKey);
        const target = await getObjectByKey(tx, orgId, task.targetKey);
        const field = child?.fields.find((f) => f.key === task.fieldKey);
        if (!child || !target || !field) return 0;
        return resolveReferencesBySfid(tx, {
          orgId,
          object: child.object,
          field,
          targetObject: target.object,
          pairs: task.pairs,
        });
      });
      stats.refsResolved = (stats.refsResolved ?? 0) + result;
    }

    // 5 — compute pass: now that every object's records + references are
    // loaded, populate formula/rollup columns. Enqueued off-thread (one backfill
    // job per object) so the import itself completes promptly.
    for (const plan of plans) {
      await enqueueCompute({ orgId, objectKey: plan.obj.targetKey, reason: 'import' });
    }

    stats.currentObject = undefined;
    await writeStats('completed');
  } catch (err) {
    stats.error = err instanceof Error ? err.message : String(err);
    await writeStats('failed');
    await run((tx) => flagIfAuthError(tx, orgId, err));
  }
}

/** Reassemble the reviewed plan from the mapping tables (meta = mapper proposal,
 *  status = post-review user decision). */
async function loadPlans(db: DbExecutor, runId: string): Promise<Plan[]> {
  const objects = await db
    .select()
    .from(schema.objectMapping)
    .where(eq(schema.objectMapping.runId, runId));
  const plans: Plan[] = [];
  for (const om of objects) {
    if (om.action === 'skip') continue;
    const fms = await db
      .select()
      .from(schema.fieldMapping)
      .where(eq(schema.fieldMapping.objectMappingId, om.id));
    plans.push({
      mappingId: om.id,
      obj: om.meta as unknown as MappedObject,
      fields: fms.map((fm) => ({
        ...(fm.meta as unknown as ProposedField),
        status: fm.status as ProposedField['status'],
      })),
    });
  }
  return plans;
}

/** Materialize object_def / field_def / record_type rows + the physical table.
 *  Returns the SF-record-type-id → record_type.id map for this object. */
async function ensureDefs(db: DbExecutor, orgId: string, plan: Plan): Promise<Map<string, string>> {
  const { obj } = plan;
  let existing = await getObjectByKey(db, orgId, obj.targetKey);

  if (!existing) {
    await db.insert(schema.objectDef).values({
      organizationId: orgId,
      key: obj.targetKey,
      tableName: obj.tableName,
      label: obj.label,
      labelPlural: obj.labelPlural,
      icon: 'cube',
      color: '#635bff', // --brand (apps/web tokens.css)
      layout: obj.layout,
      source: 'salesforce',
    });
  }
  // Existing (standard) objects keep their curated layout — don't overwrite.

  const objectId = (existing ?? (await getObjectByKey(db, orgId, obj.targetKey)))?.object
    .id as string;

  let order = existing?.fields.length ?? 0;
  for (const pf of plan.fields) {
    if (pf.status !== 'mapped') continue;
    await db
      .insert(schema.fieldDef)
      .values({
        organizationId: orgId,
        objectId,
        key: pf.key,
        columnName: pf.columnName || fieldColumnName(pf.key),
        pgType: pf.pgType || pgTypeFor(pf.type, pf.config),
        label: pf.label,
        type: pf.type,
        config: pf.config,
        required: false, // app-level required deferred until validation lands
        source: 'salesforce',
        orderIndex: order++,
      })
      .onConflictDoNothing();
  }

  // Record types
  const rtMap = new Map<string, string>();
  for (const rt of obj.recordTypes) {
    const [row] = await db
      .insert(schema.recordType)
      .values({
        organizationId: orgId,
        objectId,
        key: rt.key,
        label: rt.label,
        isDefault: rt.isDefault,
        salesforceId: rt.salesforceId,
      })
      .onConflictDoNothing()
      .returning({ id: schema.recordType.id });
    if (row) rtMap.set(rt.salesforceId, row.id);
  }
  // Conflicted (pre-existing) record types still need to be in the map.
  const allRts = await db
    .select()
    .from(schema.recordType)
    .where(eq(schema.recordType.objectId, objectId));
  for (const rt of allRts) if (rt.salesforceId) rtMap.set(rt.salesforceId, rt.id);

  // Physical table + columns (both idempotent).
  existing = await getObjectByKey(db, orgId, obj.targetKey);
  if (existing) {
    await createObjectTable(db, orgId, existing.object, existing.fields);
    for (const f of existing.fields) await addField(db, orgId, existing.object, f);
  }

  await db
    .update(schema.objectMapping)
    .set({ targetObjectId: objectId })
    .where(eq(schema.objectMapping.id, plan.mappingId));

  return rtMap;
}

async function buildOwnerMap(
  db: DbExecutor,
  client: SalesforceClient,
  orgId: string,
): Promise<Map<string, string>> {
  const members = await db
    .select({ userId: schema.member.userId, email: schema.user.email })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
    .where(eq(schema.member.organizationId, orgId));
  const byEmail = new Map(members.map((m) => [m.email.toLowerCase(), m.userId]));

  const map = new Map<string, string>();
  try {
    for await (const u of client.queryAll<{ Id: string; Email: string | null }>(
      'SELECT Id, Email FROM User',
    )) {
      const hit = u.Email ? byEmail.get(u.Email.toLowerCase()) : undefined;
      if (hit) map.set(u.Id, hit);
    }
  } catch {
    // Owner mapping is best-effort — a restricted token shouldn't fail the run.
  }
  return map;
}

/** SF JSON value → app-shaped value for a proposed field. */
function convert(pf: ProposedField, v: unknown): unknown {
  if (v === null || v === undefined || v === '') return null;
  if (pf.type === 'multipicklist') return String(v).split(';').filter(Boolean);
  return v;
}
