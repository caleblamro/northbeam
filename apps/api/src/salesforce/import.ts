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
} from '@northbeam/db';
import type { SalesforceClient } from '@northbeam/salesforce';
import { eq } from 'drizzle-orm';
import { flagIfAuthError } from './client.js';
import type { MappedObject, ProposedField } from './mapper.js';

const BATCH = 500;

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
  const writeStats = async (status?: 'running' | 'completed' | 'failed') => {
    await db
      .update(schema.migrationRun)
      .set({
        stats,
        ...(status ? { status } : {}),
        ...(status === 'completed' ? { completedAt: new Date() } : {}),
      })
      .where(eq(schema.migrationRun.id, runId));
  };

  try {
    await db
      .update(schema.migrationRun)
      .set({ status: 'running', startedAt: new Date() })
      .where(eq(schema.migrationRun.id, runId));

    const plans = await loadPlans(db, runId);
    stats.objects = plans.length;
    stats.fields = plans.reduce(
      (n, p) => n + p.fields.filter((f) => f.status === 'mapped').length,
      0,
    );
    await writeStats();

    // 1 — defs + DDL + record types
    const rtMaps = new Map<string, Map<string, string>>(); // targetKey → (sf RT id → our uuid)
    for (const plan of plans) {
      rtMaps.set(plan.obj.targetKey, await ensureDefs(db, orgId, plan));
    }

    // 2 — owner map (SF user id → workspace user id, by email)
    const ownerMap = await buildOwnerMap(db, client, orgId);

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

      const loaded = await getObjectByKey(db, orgId, plan.obj.targetKey);
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
      const soql = `SELECT ${select.join(', ')} FROM ${plan.obj.sfObject}`;
      const rtMap = rtMaps.get(plan.obj.targetKey) ?? new Map<string, string>();

      let batch: ImportRow[] = [];
      const flush = async () => {
        if (!batch.length) return;
        stats.imported =
          (stats.imported ?? 0) +
          (await bulkInsertRecords(db, {
            orgId,
            object: loaded.object,
            fields: dataFieldRows,
            rows: batch,
          }));
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
          name: nameRaw ? String(nameRaw) : displayName(loaded.fields, data),
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
      const child = await getObjectByKey(db, orgId, task.objectKey);
      const target = await getObjectByKey(db, orgId, task.targetKey);
      const field = child?.fields.find((f) => f.key === task.fieldKey);
      if (!child || !target || !field) continue;
      stats.refsResolved =
        (stats.refsResolved ?? 0) +
        (await resolveReferencesBySfid(db, {
          orgId,
          object: child.object,
          field,
          targetObject: target.object,
          pairs: task.pairs,
        }));
    }

    stats.currentObject = undefined;
    await writeStats('completed');
  } catch (err) {
    stats.error = err instanceof Error ? err.message : String(err);
    await writeStats('failed');
    await flagIfAuthError(db, orgId, err);
  }
}

/** Reassemble the reviewed plan from the mapping tables (meta = mapper proposal,
 *  status = post-review user decision). */
async function loadPlans(db: Database, runId: string): Promise<Plan[]> {
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
async function ensureDefs(db: Database, orgId: string, plan: Plan): Promise<Map<string, string>> {
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
  db: Database,
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
