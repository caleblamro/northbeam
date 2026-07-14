// /trpc/salesforce — the migration pipeline: connection status → discover →
// createRun (describe + auto-map, persisted to the mapping tables) → review
// (getRun / setFieldStatus / setObjectAction) → execute (DDL + import, runs in
// the background; the UI polls getRun for stats).

import {
  type ConnectionStatus as ConnStatus,
  deleteConnection,
  getConnection,
  schema,
} from '@northbeam/db';
import { TRPCError } from '@trpc/server';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { env } from '../../lib/env.js';
import { enqueueImport } from '../../queue/sf-import.js';
import { cancelPoll, schedulePoll } from '../../queue/sf-sync.js';
import { invalidateWritebackToggle } from '../../salesforce/capture.js';
import { NoConnectionError, clientForOrg, flagIfAuthError } from '../../salesforce/client.js';
import { STANDARD_TARGETS, mapSObject } from '../../salesforce/mapper.js';
import { permissionProcedure, protectedProcedure, router } from '../trpc.js';

const SAMPLE_SIZE = 200;

// Standard SF business objects with no Northbeam standard equivalent — they
// import as new objects. Without this allowlist, discover only surfaces
// STANDARD_TARGETS + custom (__c) objects, silently hiding e.g. an org's
// 40k Contracts and 200k Leads.
const EXTRA_STANDARD_OBJECTS = new Set([
  'Contract',
  'Lead',
  'Case',
  'Campaign',
  'CampaignMember',
  'Order',
  'Product2',
  'Asset',
  'WorkOrder',
  'WorkOrderLineItem',
  'ServiceAppointment',
]);

function asTrpcError(err: unknown): TRPCError {
  if (err instanceof NoConnectionError) {
    return new TRPCError({ code: 'PRECONDITION_FAILED', message: 'salesforce_not_connected' });
  }
  return new TRPCError({
    code: 'BAD_GATEWAY',
    message: err instanceof Error ? err.message : 'salesforce request failed',
  });
}

export const salesforceRouter = router({
  status: protectedProcedure.query(async ({ ctx }) => {
    const conn = await getConnection(ctx.db, ctx.auth.organizationId);
    const e = env();
    return {
      oauthConfigured: Boolean(e.SF_CLIENT_ID && e.SF_TOKEN_KEY),
      connected: Boolean(conn && conn.status === 'connected'),
      status: (conn?.status ?? null) as ConnStatus | null,
      instanceUrl: conn?.instanceUrl ?? null,
      connectedAt: conn?.createdAt ?? null,
      writebackEnabled: conn?.writebackEnabled ?? false,
      pollEnabled: conn?.pollEnabled ?? false,
    };
  }),

  disconnect: permissionProcedure('migration.run').mutation(async ({ ctx }) => {
    await cancelPoll(ctx.auth.organizationId).catch(() => {});
    await deleteConnection(ctx.db, ctx.auth.organizationId);
    invalidateWritebackToggle(ctx.auth.organizationId);
    return { ok: true as const };
  }),

  /** Two-way sync gates. Write-back mutates the customer's Salesforce org and
   *  polling consumes API quota — admin-only, default OFF, explicit per org. */
  setSync: permissionProcedure('migration.run')
    .input(
      z.object({
        writebackEnabled: z.boolean().optional(),
        pollEnabled: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.auth.organizationId;
      const conn = await getConnection(ctx.db, orgId);
      if (!conn) throw new TRPCError({ code: 'PRECONDITION_FAILED' });
      await ctx.db
        .update(schema.salesforceConnection)
        .set({
          ...(input.writebackEnabled !== undefined
            ? { writebackEnabled: input.writebackEnabled }
            : {}),
          ...(input.pollEnabled !== undefined ? { pollEnabled: input.pollEnabled } : {}),
          updatedAt: new Date(),
        })
        .where(eq(schema.salesforceConnection.id, conn.id));
      invalidateWritebackToggle(orgId);
      // The repeatable poll job lives/dies with the toggle.
      if (input.pollEnabled === true) ctx.postCommit.push(() => schedulePoll(orgId));
      if (input.pollEnabled === false) ctx.postCommit.push(() => cancelPoll(orgId));
      return { ok: true as const };
    }),

  /** Importable objects in the connected org: the standard five + every custom
   *  object, with record counts. */
  discover: protectedProcedure.query(async ({ ctx }) => {
    try {
      const client = await clientForOrg(ctx.db, ctx.auth.organizationId);
      const global = await client.globalDescribe();
      const candidates = global.sobjects.filter(
        (s) =>
          (STANDARD_TARGETS[s.name] ||
            EXTRA_STANDARD_OBJECTS.has(s.name) ||
            s.name.endsWith('__c')) &&
          s.queryable &&
          s.createable &&
          !s.name.endsWith('__History') &&
          !s.name.endsWith('__Share') &&
          !s.name.endsWith('__Tag'),
      );
      const counts = await Promise.all(
        candidates.map((c) => client.count(c.name).catch(() => null)),
      );
      return candidates
        .map((c, i) => ({
          name: c.name,
          label: c.label,
          labelPlural: c.labelPlural,
          custom: c.custom,
          standardTarget: STANDARD_TARGETS[c.name] ?? null,
          count: counts[i],
        }))
        .sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
    } catch (err) {
      await flagIfAuthError(ctx.db, ctx.auth.organizationId, err);
      throw asTrpcError(err);
    }
  }),

  /** Describe + auto-map the selected objects into a new migration run.
   *  Admin+ like execute — mapping hits the live Salesforce API and writes the
   *  run/mapping tables, so the whole migration surface shares one gate. */
  createRun: permissionProcedure('migration.run')
    .input(
      z.object({
        objects: z.array(z.string()).min(1).max(300),
        // Targeted import: restrict the record phase to the subtree reachable
        // from these roots. Config/DDL still imports for every object above.
        scope: z
          .object({
            kind: z.literal('subtree'),
            rootSfObject: z.string(),
            rootSfIds: z.array(z.string()).min(1).max(200),
            label: z.string().optional(),
          })
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.auth.organizationId;
      const conn = await getConnection(ctx.db, orgId);
      if (!conn) throw new TRPCError({ code: 'PRECONDITION_FAILED' });
      try {
        const client = await clientForOrg(ctx.db, orgId);
        const importSet = new Set(input.objects);

        const [run] = await ctx.db
          .insert(schema.migrationRun)
          .values({
            organizationId: orgId,
            connectionId: conn.id,
            status: 'mapping',
            scope: input.scope ?? null,
          })
          .returning();
        if (!run) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });

        for (const name of input.objects) {
          const d = await client.describe(name);
          // Recent-records sample for the populated-% heuristic; best-effort.
          let sample: Record<string, unknown>[] | undefined;
          try {
            const fieldList = d.fields.map((f) => f.name).join(', ');
            sample = (await client.query(`SELECT ${fieldList} FROM ${name} LIMIT ${SAMPLE_SIZE}`))
              .records;
          } catch {
            sample = undefined;
          }
          const mapped = mapSObject(d, { importSet, sample });
          const count = await client.count(name).catch(() => 0);

          const { fields, ...objMeta } = mapped;
          const [om] = await ctx.db
            .insert(schema.objectMapping)
            .values({
              organizationId: orgId,
              runId: run.id,
              sfObject: mapped.sfObject,
              sfLabel: mapped.sfLabel,
              action: mapped.action,
              recordCount: count,
              meta: objMeta as unknown as Record<string, unknown>,
            })
            .returning();
          if (!om) continue;
          for (const pf of fields) {
            await ctx.db.insert(schema.fieldMapping).values({
              organizationId: orgId,
              objectMappingId: om.id,
              sfField: pf.sfField,
              sfLabel: pf.sfLabel,
              sfType: pf.sfType,
              confidence: pf.confidence,
              status: pf.status,
              meta: pf as unknown as Record<string, unknown>,
            });
          }
        }
        // Mapping finished for every object — mark the run executable. Runs
        // left at 'mapping' were interrupted mid-analysis.
        await ctx.db
          .update(schema.migrationRun)
          .set({ status: 'ready' })
          .where(eq(schema.migrationRun.id, run.id));
        return { runId: run.id };
      } catch (err) {
        await flagIfAuthError(ctx.db, orgId, err);
        throw asTrpcError(err);
      }
    }),

  /** Most recent run for this workspace (lets /migrate resume across reloads). */
  latestRun: protectedProcedure.query(async ({ ctx }) => {
    const [run] = await ctx.db
      .select({ id: schema.migrationRun.id, status: schema.migrationRun.status })
      .from(schema.migrationRun)
      .where(eq(schema.migrationRun.organizationId, ctx.auth.organizationId))
      .orderBy(desc(schema.migrationRun.createdAt))
      .limit(1);
    return run ?? null;
  }),

  /** Full run state for the review + progress screens. */
  getRun: protectedProcedure
    .input(z.object({ runId: z.string() }))
    .query(async ({ ctx, input }) => {
      const [run] = await ctx.db
        .select()
        .from(schema.migrationRun)
        .where(eq(schema.migrationRun.id, input.runId))
        .limit(1);
      if (!run || run.organizationId !== ctx.auth.organizationId) {
        throw new TRPCError({ code: 'NOT_FOUND' });
      }
      const objects = await ctx.db
        .select()
        .from(schema.objectMapping)
        .where(
          and(
            eq(schema.objectMapping.organizationId, ctx.auth.organizationId),
            eq(schema.objectMapping.runId, run.id),
          ),
        );
      const result = [];
      for (const om of objects) {
        const fields = await ctx.db
          .select({
            id: schema.fieldMapping.id,
            sfField: schema.fieldMapping.sfField,
            sfType: schema.fieldMapping.sfType,
            status: schema.fieldMapping.status,
            confidence: schema.fieldMapping.confidence,
            meta: schema.fieldMapping.meta,
          })
          .from(schema.fieldMapping)
          .where(
            and(
              eq(schema.fieldMapping.organizationId, ctx.auth.organizationId),
              eq(schema.fieldMapping.objectMappingId, om.id),
            ),
          );
        result.push({
          id: om.id,
          sfObject: om.sfObject,
          sfLabel: om.sfLabel,
          action: om.action,
          recordCount: om.recordCount,
          meta: om.meta,
          fields,
        });
      }
      return { run: { id: run.id, status: run.status, stats: run.stats }, objects: result };
    }),

  setFieldStatus: permissionProcedure('migration.run')
    .input(z.object({ id: z.string(), status: z.enum(['mapped', 'review', 'skip']) }))
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.db
        .update(schema.fieldMapping)
        .set({ status: input.status })
        .where(
          and(
            eq(schema.fieldMapping.organizationId, ctx.auth.organizationId),
            eq(schema.fieldMapping.id, input.id),
          ),
        )
        .returning({ id: schema.fieldMapping.id });
      if (updated.length === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      return { ok: true as const };
    }),

  setObjectAction: permissionProcedure('migration.run')
    .input(z.object({ id: z.string(), action: z.enum(['map', 'create', 'skip']) }))
    .mutation(async ({ ctx, input }) => {
      const updated = await ctx.db
        .update(schema.objectMapping)
        .set({ action: input.action })
        .where(
          and(
            eq(schema.objectMapping.organizationId, ctx.auth.organizationId),
            eq(schema.objectMapping.id, input.id),
          ),
        )
        .returning({ id: schema.objectMapping.id });
      if (updated.length === 0) throw new TRPCError({ code: 'NOT_FOUND' });
      return { ok: true as const };
    }),

  /** Kick the import. Enqueues a BullMQ job; the sf-import worker consumes it
   *  off-thread. Poll getRun for progress (the worker writes to
   *  migration_run.stats as it goes). Admin+ only — imports rewrite the
   *  workspace's data plane and shouldn't be triggerable by a regular member. */
  execute: permissionProcedure('migration.run')
    .input(z.object({ runId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const orgId = ctx.auth.organizationId;
      const [run] = await ctx.db
        .select()
        .from(schema.migrationRun)
        .where(eq(schema.migrationRun.id, input.runId))
        .limit(1);
      if (!run || run.organizationId !== orgId) throw new TRPCError({ code: 'NOT_FOUND' });
      if (run.status === 'running') {
        throw new TRPCError({ code: 'CONFLICT', message: 'run already in progress' });
      }
      // Verify the connection still works *before* enqueueing — fail-fast at
      // request time is a better UX than the worker erroring 30s later.
      await clientForOrg(ctx.db, orgId).catch((err) => {
        throw asTrpcError(err);
      });
      await enqueueImport({ orgId, runId: input.runId });
      return { ok: true as const };
    }),
});
