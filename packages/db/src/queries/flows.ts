// Flow metadata CRUD + version snapshots — typed Drizzle only.
//
// Read-cheap dispatch design: activating a flow copies the snapshotted
// version's trigger onto flow.activeTrigger / flow.activeTriggerType
// (setActiveVersion). listActiveFlowsForObject / listActiveScheduledFlows
// therefore read a single table with plain-column filters — the dispatcher
// hot path never joins flow_version and never parses a graph.

import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import type { DbExecutor } from '../client.js';
import {
  type FlowGraphJson,
  type FlowReferenceMeta,
  type FlowSource,
  type FlowStatus,
  type FlowTriggerJson,
  flow,
  flowVersion,
} from '../schema.js';

export type FlowRow = typeof flow.$inferSelect;
export type FlowVersionRow = typeof flowVersion.$inferSelect;

export async function createFlow(
  db: DbExecutor,
  input: {
    organizationId: string;
    /** NULL = global (scheduled/webhook) flow or an SF reference. */
    objectId?: string | null;
    key: string;
    name: string;
    description?: string | null;
    status?: FlowStatus;
    source?: FlowSource;
    salesforceId?: string | null;
    referenceMeta?: FlowReferenceMeta | null;
    draftTrigger?: FlowTriggerJson | null;
    draftGraph?: FlowGraphJson | null;
    webhookSecret?: string | null;
    createdById?: string | null;
  },
): Promise<FlowRow> {
  const [row] = await db.insert(flow).values(input).returning();
  if (!row) throw new Error('flow insert returned no row');
  return row;
}

export async function getFlow(db: DbExecutor, orgId: string, id: string): Promise<FlowRow | null> {
  const [row] = await db
    .select()
    .from(flow)
    .where(and(eq(flow.organizationId, orgId), eq(flow.id, id)))
    .limit(1);
  return row ?? null;
}

export async function getFlowByKey(
  db: DbExecutor,
  orgId: string,
  key: string,
): Promise<FlowRow | null> {
  const [row] = await db
    .select()
    .from(flow)
    .where(and(eq(flow.organizationId, orgId), eq(flow.key, key)))
    .limit(1);
  return row ?? null;
}

/** All flows for the org, name-ordered. `objectId: null` filters to global
 *  flows; omitting it returns everything. */
export async function listFlows(
  db: DbExecutor,
  orgId: string,
  opts: { objectId?: string | null; status?: FlowStatus } = {},
): Promise<FlowRow[]> {
  const conditions = [eq(flow.organizationId, orgId)];
  if (opts.objectId !== undefined) {
    conditions.push(
      opts.objectId === null ? isNull(flow.objectId) : eq(flow.objectId, opts.objectId),
    );
  }
  if (opts.status !== undefined) conditions.push(eq(flow.status, opts.status));
  return db
    .select()
    .from(flow)
    .where(and(...conditions))
    .orderBy(asc(flow.name));
}

/** Active flows attached to an object — the record-event dispatcher's match
 *  set. Rows carry the denormalized activeTrigger; the dispatcher filters
 *  trigger_record events in memory (entryCondition, watchedFieldKeys). */
export async function listActiveFlowsForObject(
  db: DbExecutor,
  orgId: string,
  objectId: string,
): Promise<FlowRow[]> {
  return db
    .select()
    .from(flow)
    .where(
      and(eq(flow.organizationId, orgId), eq(flow.objectId, objectId), eq(flow.status, 'active')),
    )
    .orderBy(asc(flow.name));
}

/** Active scheduled flows — the job-scheduler reconciler's source of truth.
 *  Omit orgId for the cross-org boot/hourly sweep (requires a connection
 *  where RLS is not enforced, i.e. the worker's owner-role connection). */
export async function listActiveScheduledFlows(db: DbExecutor, orgId?: string): Promise<FlowRow[]> {
  const conditions = [eq(flow.status, 'active'), eq(flow.activeTriggerType, 'trigger_scheduled')];
  if (orgId !== undefined) conditions.push(eq(flow.organizationId, orgId));
  return db
    .select()
    .from(flow)
    .where(and(...conditions));
}

export async function updateFlow(
  db: DbExecutor,
  orgId: string,
  id: string,
  patch: {
    name?: string;
    description?: string | null;
    /** Activation is setActiveVersion's job; this covers draft/pause moves. */
    status?: FlowStatus;
    objectId?: string | null;
    draftTrigger?: FlowTriggerJson | null;
    draftGraph?: FlowGraphJson | null;
    webhookSecret?: string | null;
  },
): Promise<FlowRow | null> {
  const [row] = await db
    .update(flow)
    .set({
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.objectId !== undefined ? { objectId: patch.objectId } : {}),
      ...(patch.draftTrigger !== undefined ? { draftTrigger: patch.draftTrigger } : {}),
      ...(patch.draftGraph !== undefined ? { draftGraph: patch.draftGraph } : {}),
      ...(patch.webhookSecret !== undefined ? { webhookSecret: patch.webhookSecret } : {}),
      updatedAt: new Date(),
    })
    .where(and(eq(flow.organizationId, orgId), eq(flow.id, id)))
    .returning();
  return row ?? null;
}

export async function deleteFlow(db: DbExecutor, orgId: string, id: string): Promise<boolean> {
  const rows = await db
    .delete(flow)
    .where(and(eq(flow.organizationId, orgId), eq(flow.id, id)))
    .returning({ id: flow.id });
  return rows.length > 0;
}

/** Immutable activate-time snapshot. Version numbers are max+1 — concurrent
 *  activates lose to the unique (flowId, version) index and surface as an
 *  error, which is fine for an admin-gated action. */
export async function createFlowVersion(
  db: DbExecutor,
  input: {
    organizationId: string;
    flowId: string;
    trigger: FlowTriggerJson;
    graph: FlowGraphJson;
    createdById?: string | null;
  },
): Promise<FlowVersionRow> {
  const [prev] = await db
    .select({ max: sql<number | null>`max(${flowVersion.version})` })
    .from(flowVersion)
    .where(eq(flowVersion.flowId, input.flowId));
  const [row] = await db
    .insert(flowVersion)
    .values({ ...input, version: (prev?.max ?? 0) + 1 })
    .returning();
  if (!row) throw new Error('flow version insert returned no row');
  return row;
}

export async function getFlowVersion(
  db: DbExecutor,
  orgId: string,
  id: string,
): Promise<FlowVersionRow | null> {
  const [row] = await db
    .select()
    .from(flowVersion)
    .where(and(eq(flowVersion.organizationId, orgId), eq(flowVersion.id, id)))
    .limit(1);
  return row ?? null;
}

export async function listFlowVersions(
  db: DbExecutor,
  orgId: string,
  flowId: string,
): Promise<FlowVersionRow[]> {
  return db
    .select()
    .from(flowVersion)
    .where(and(eq(flowVersion.organizationId, orgId), eq(flowVersion.flowId, flowId)))
    .orderBy(desc(flowVersion.version));
}

/** Point the flow at a version and denormalize its trigger onto the flow row
 *  (see the module header). Verifies the version belongs to the flow, then
 *  sets status 'active'. Returns null when either lookup misses. */
export async function setActiveVersion(
  db: DbExecutor,
  orgId: string,
  flowId: string,
  versionId: string,
): Promise<FlowRow | null> {
  const version = await getFlowVersion(db, orgId, versionId);
  if (!version || version.flowId !== flowId) return null;
  const [row] = await db
    .update(flow)
    .set({
      activeVersionId: version.id,
      activeTrigger: version.trigger,
      activeTriggerType: version.trigger.type,
      status: 'active',
      updatedAt: new Date(),
    })
    .where(and(eq(flow.organizationId, orgId), eq(flow.id, flowId)))
    .returning();
  return row ?? null;
}
