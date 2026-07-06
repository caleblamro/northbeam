// The import pipeline: (1) materialize the reviewed mapping into object_def /
// field_def / record_type rows + physical tables (DDL), (2) stream records out of
// Salesforce in pages and bulk-insert them, (3) resolve reference columns by
// salesforce_id in a final set-based pass. Owner mapping matches SF Users to
// workspace members by email.
//
// Runs in a BullMQ worker process (the tRPC `execute` mutation enqueues a job
// consumed by workers/sf-import-worker.ts) and reports progress by writing
// migration_run.stats, which the UI polls.

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
import { and, eq } from 'drizzle-orm';
import { enqueueCompute } from '../queue/compute.js';
import { flagIfAuthError } from './client.js';
import { importAutomations } from './import-flows.js';
import { importAnalyticsViews } from './import-views.js';
import type { MappedObject, ProposedField } from './mapper.js';

const BATCH = 500;

// Deliberate product cap, not a placeholder: an UNSCOPED migration imports at
// most this many records per object — it's a working slice of the org, not a
// full sync. Scoped (subtree) runs use SCOPED_MAX_RECORDS_PER_OBJECT instead.
export const MAX_RECORDS_PER_OBJECT = 100;

// Scoped runs pull the full relationship subtree of the chosen roots; the cap
// is a runaway guard (a pathological hub record), not a sampling device.
export const SCOPED_MAX_RECORDS_PER_OBJECT = 20000;
const CRAWL_MAX_ROUNDS = 6;
// SOQL id-list chunk: 200 ids ≈ 4.4KB of WHERE clause, well under SOQL limits.
const ID_CHUNK = 200;

type Plan = {
  mappingId: string;
  obj: MappedObject; // meta minus fields
  fields: ProposedField[]; // post-review: status reflects user edits
};

type RunScope = NonNullable<typeof schema.migrationRun.$inferSelect.scope>;

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

    const plans = await run((tx) => loadPlans(tx, orgId, runId));
    const [runRow] = await run((tx) =>
      tx
        .select({ scope: schema.migrationRun.scope })
        .from(schema.migrationRun)
        .where(eq(schema.migrationRun.id, runId)),
    );
    const scope = runRow?.scope ?? null;
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

    // 2b — scoped runs: crawl the relationship subtree from the root records.
    // Objects that collect zero ids still got their defs/DDL in step 1 —
    // "config imports for everything, records only for the subtree".
    let scopedIds: Map<string, Set<string>> | null = null;
    if (scope?.kind === 'subtree') {
      stats.currentObject = `Crawling ${scope.label ?? scope.rootSfObject} subtree`;
      await writeStats();
      scopedIds = await crawlSubtree(client, plans, scope, stats, writeStats);
    }

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

      // Mirror the resolved record name into the object's nameExpression field
      // when the mapping didn't populate it (e.g. Account.Name is a compound
      // parent on person-account orgs → skipped, yet the seeded account object
      // displays via the 'name' field — otherwise every account is 'Untitled').
      const nameExpr = loaded.object.nameExpression;
      const nameMirror =
        nameExpr && !nameExpr.includes('|') ? fieldByKey.get(nameExpr.trim()) : undefined;
      if (nameMirror && !dataFieldRows.some((f) => f.key === nameMirror.key)) {
        dataFieldRows.push(nameMirror);
      }

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
      // Scoped runs fetch exactly the crawled ids (chunked WHERE Id IN …);
      // unscoped runs keep the LIMIT sample, enforced at the source so
      // queryAll never streams more than MAX_RECORDS_PER_OBJECT rows.
      const objectIds = scopedIds ? [...(scopedIds.get(plan.obj.sfObject) ?? [])] : null;
      if (objectIds && objectIds.length === 0) continue; // config-only object
      const soqls = objectIds
        ? chunks(objectIds, ID_CHUNK).map(
            (chunk) =>
              `SELECT ${select.join(', ')} FROM ${plan.obj.sfObject} WHERE Id IN (${quoteIds(chunk)})`,
          )
        : [`SELECT ${select.join(', ')} FROM ${plan.obj.sfObject} LIMIT ${MAX_RECORDS_PER_OBJECT}`];
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

      for await (const raw of streamQueries(client, soqls)) {
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
        const resolvedName = nameRaw
          ? String(nameRaw)
          : displayName(loaded.fields, data, loaded.object.nameExpression);
        if (nameMirror && (data[nameMirror.key] == null || data[nameMirror.key] === '')) {
          data[nameMirror.key] = resolvedName;
        }
        batch.push({
          salesforceId: sfId,
          name: resolvedName,
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

    // 6 — reports + dashboards → view rows. Best-effort: a reporting failure
    // records itself in stats and never fails the record import.
    stats.currentObject = 'Importing reports & dashboards';
    await writeStats();
    try {
      await importAnalyticsViews({ run, client, orgId, plans, stats, writeStats });
    } catch (err) {
      stats.reportsError = err instanceof Error ? err.message : String(err);
    }

    // 7 — flows / workflow rules / apex triggers → flow rows. Same best-effort
    // contract as phase 6: failures land in stats.automationsError.
    stats.currentObject = 'Importing automations';
    await writeStats();
    try {
      await importAutomations({ run, client, orgId, plans, stats, writeStats });
    } catch (err) {
      stats.automationsError = err instanceof Error ? err.message : String(err);
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
async function loadPlans(db: DbExecutor, orgId: string, runId: string): Promise<Plan[]> {
  const objects = await db
    .select()
    .from(schema.objectMapping)
    .where(
      and(eq(schema.objectMapping.organizationId, orgId), eq(schema.objectMapping.runId, runId)),
    );
  const plans: Plan[] = [];
  for (const om of objects) {
    if (om.action === 'skip') continue;
    const fms = await db
      .select()
      .from(schema.fieldMapping)
      .where(
        and(
          eq(schema.fieldMapping.organizationId, orgId),
          eq(schema.fieldMapping.objectMappingId, om.id),
        ),
      );
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

/** BFS the relationship graph from the scope's root records, using only the
 *  reference edges that exist in this run's mapping.
 *
 *  Direction matters: only DESCENDANTS expand (rows whose lookup points at a
 *  frontier id keep crawling downward). Parents — the lookup values OF
 *  collected rows — are fetched so references resolve to real records, but
 *  they are DEAD ENDS: expanding from a parent would turn every shared hub
 *  (a market, a management company, a vendor account) into a new root and
 *  sweep in unrelated subtrees — "import 50 accounts" must not become
 *  "import the org". Bounded by CRAWL_MAX_ROUNDS + SCOPED_MAX_RECORDS_PER_OBJECT. */
async function crawlSubtree(
  client: SalesforceClient,
  plans: Plan[],
  scope: RunScope,
  stats: Stats,
  writeStats: () => Promise<void>,
): Promise<Map<string, Set<string>>> {
  const keyToSf = new Map(plans.map((p) => [p.obj.targetKey, p.obj.sfObject]));
  type Edge = { childSf: string; refField: string; targetSf: string };
  const edges: Edge[] = [];
  const seenEdge = new Set<string>();
  for (const p of plans) {
    for (const f of p.fields) {
      // Any reference with a known target is a traversal edge — including
      // review/skip fields (a lookup the user chose not to import as a COLUMN
      // still relates records; ignoring it would silently truncate subtrees).
      if (f.type !== 'reference') continue;
      const targetSf = keyToSf.get(String(f.config.targetObject ?? ''));
      if (!targetSf) continue;
      const k = `${p.obj.sfObject}|${f.sfField}|${targetSf}`;
      if (seenEdge.has(k)) continue; // polymorphic splits share one sfField
      seenEdge.add(k);
      edges.push({ childSf: p.obj.sfObject, refField: f.sfField, targetSf });
    }
  }
  // Parent pulls batch all ref fields of one object into a single SELECT.
  const parentEdges = new Map<string, Edge[]>();
  for (const e of edges) {
    parentEdges.set(e.childSf, [...(parentEdges.get(e.childSf) ?? []), e]);
  }

  const collected = new Map<string, Set<string>>(plans.map((p) => [p.obj.sfObject, new Set()]));
  const rootSet = collected.get(scope.rootSfObject);
  if (!rootSet) return collected; // root object isn't part of this run
  let frontier = new Map<string, Set<string>>([[scope.rootSfObject, new Set()]]);
  for (const id of scope.rootSfIds) {
    rootSet.add(id);
    frontier.get(scope.rootSfObject)?.add(id);
  }

  for (let round = 0; round < CRAWL_MAX_ROUNDS; round++) {
    const next = new Map<string, Set<string>>();
    const collect = (sfObject: string, id: string, expand: boolean) => {
      const seen = collected.get(sfObject);
      if (!seen || seen.has(id) || seen.size >= SCOPED_MAX_RECORDS_PER_OBJECT) return;
      seen.add(id);
      if (!expand) return; // parent: fetch it, never crawl from it
      const n = next.get(sfObject) ?? new Set<string>();
      n.add(id);
      next.set(sfObject, n);
    };

    // Descendants: SELECT Id FROM child WHERE <lookup> IN (frontier of its
    // target) — these keep expanding.
    for (const e of edges) {
      const ids = frontier.get(e.targetSf);
      if (!ids?.size) continue;
      for (const chunk of chunks([...ids], ID_CHUNK)) {
        const soql = `SELECT Id FROM ${e.childSf} WHERE ${e.refField} IN (${quoteIds(chunk)})`;
        try {
          for await (const r of client.queryAll<{ Id: string }>(soql)) {
            collect(e.childSf, r.Id, true);
          }
        } catch {
          // Non-filterable/odd field — skip the edge rather than fail the run.
        }
      }
    }

    // Parents: SELECT <all lookups> FROM child WHERE Id IN (frontier of
    // child) — fetched as dead ends so reference columns resolve.
    for (const [childSf, es] of parentEdges) {
      const ids = frontier.get(childSf);
      if (!ids?.size) continue;
      const fields = [...new Set(es.map((e) => e.refField))];
      for (const chunk of chunks([...ids], ID_CHUNK)) {
        const soql = `SELECT ${fields.join(', ')} FROM ${childSf} WHERE Id IN (${quoteIds(chunk)})`;
        try {
          for await (const r of client.queryAll<Record<string, unknown>>(soql)) {
            for (const e of es) {
              const v = r[e.refField];
              if (typeof v === 'string' && v) collect(e.targetSf, v, false);
            }
          }
        } catch {
          // Best-effort, same as above.
        }
      }
    }

    stats.crawlRounds = round + 1;
    stats.crawlIds = [...collected.values()].reduce((n, s) => n + s.size, 0);
    await writeStats();
    if ([...next.values()].every((s) => s.size === 0)) break;
    frontier = next;
  }
  return collected;
}

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/** SF ids are alphanumeric; strip anything else so ids can't break out of the
 *  quoted SOQL literal. */
function quoteIds(ids: string[]): string {
  return ids.map((id) => `'${id.replace(/[^a-zA-Z0-9]/g, '')}'`).join(',');
}

async function* streamQueries(
  client: SalesforceClient,
  soqls: string[],
): AsyncGenerator<Record<string, unknown>> {
  for (const soql of soqls) {
    for await (const raw of client.queryAll<Record<string, unknown>>(soql)) yield raw;
  }
}

/** Materialize object_def / field_def / record_type rows + the physical table.
 *  Returns the SF-record-type-id → record_type.id map for this object. */
async function ensureDefs(db: DbExecutor, orgId: string, plan: Plan): Promise<Map<string, string>> {
  const { obj } = plan;
  let existing = await getObjectByKey(db, orgId, obj.targetKey);

  if (!existing) {
    // Display name: point nameExpression at the imported field that carries
    // the SF name (e.g. Contract → contract_number). Without this, rows of
    // created objects render as 'Untitled' whenever the fallback keys
    // (name/subject/title) don't exist.
    const nameKey =
      plan.fields.find((pf) => pf.status === 'mapped' && pf.sfField === obj.nameFieldSf)?.key ??
      null;
    await db.insert(schema.objectDef).values({
      organizationId: orgId,
      key: obj.targetKey,
      tableName: obj.tableName,
      label: obj.label,
      labelPlural: obj.labelPlural,
      icon: 'cube',
      color: '#635bff', // --brand (apps/web tokens.css)
      layout: obj.layout,
      nameExpression: nameKey,
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
    .where(
      and(eq(schema.recordType.organizationId, orgId), eq(schema.recordType.objectId, objectId)),
    );
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
    .where(
      and(
        eq(schema.objectMapping.organizationId, orgId),
        eq(schema.objectMapping.id, plan.mappingId),
      ),
    );

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
