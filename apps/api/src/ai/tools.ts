// The composer's research tools — what turns "generate a dashboard" into an
// agentic loop that can LOOK at the workspace first. Each tool:
//
//   - exists only if the caller's role policy allows it (effectiveTools —
//     admins set per-role availability, code defaults otherwise),
//   - pauses for an in-thread approval unless the user auto-approved it
//     (approval broker below + the ai.resolveTool mutation),
//   - executes through the SAME acl'd, permission-gated db helpers the tRPC
//     record procedures use, inside its own org-context transaction (tool
//     calls run after the procedure's transaction has committed),
//   - streams lifecycle events to the drawer so calls render as chips.
//
// Tool RESULTS are truncated before they re-enter the model — they inform
// composition; they are not a data channel to the client (the client renders
// live components that query as the viewer).

import { randomUUID } from 'node:crypto';
import type { EffectiveTool } from '@northbeam/core';
import { QuerySpecSchema } from '@northbeam/core';
import {
  type DbExecutor,
  type ObjectWithFields,
  type QuerySpecLike,
  type Role,
  aggregateRecords,
  collectQueryTargetKeys,
  getRecord,
  hydratePicklistOptions,
  isAdminish,
  listRecords,
  resolveQuerySpec,
  runQuery,
  visibleSharedRecordIds,
} from '@northbeam/db';
import { type Tool, tool } from 'ai';
import { z } from 'zod';
import {
  ReportAggSchema,
  ReportHavingSchema,
  collectRefTargetKeys,
  resolveFilterRefPaths,
  resolveReportSpec,
} from '../trpc/report-config.js';
import { FilterEntrySchema } from '../trpc/schemas.js';

/* ── Approval broker ────────────────────────────────────────────────────────
   In-memory, per-process: a non-auto-approved tool call parks a promise here;
   the drawer's Approve/Deny buttons resolve it via ai.resolveTool. Fine for
   the single-process API (the worker is a separate process and never runs
   generations). Timeout denies — generation never hangs on a walked-away tab. */

const APPROVAL_TIMEOUT_MS = 120_000;
const pending = new Map<string, (approved: boolean) => void>();

function awaitApproval(callId: string): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(callId);
      resolve(false);
    }, APPROVAL_TIMEOUT_MS);
    pending.set(callId, (approved) => {
      clearTimeout(timer);
      pending.delete(callId);
      resolve(approved);
    });
  });
}

/** Resolve a parked tool call. False when it already timed out / resolved. */
export function resolveToolApproval(callId: string, approved: boolean): boolean {
  const resolve = pending.get(callId);
  if (!resolve) return false;
  resolve(approved);
  return true;
}

/* ── Event stream plumbing ──────────────────────────────────────────────── */

export type ToolEvent =
  | {
      type: 'tool-approval';
      callId: string;
      toolId: string;
      title: string;
      input: unknown;
    }
  | { type: 'tool-start'; callId: string; toolId: string; title: string; input: unknown }
  | {
      type: 'tool-end';
      callId: string;
      toolId: string;
      status: 'done' | 'denied' | 'error';
      summary?: string;
    };

/** Tiny push→pull adapter: tool execute() pushes lifecycle events; the tRPC
 *  generator pulls them out as they happen. close() ends iteration. */
export function createEventChannel<T>() {
  const buffer: T[] = [];
  let notify: (() => void) | null = null;
  let closed = false;
  return {
    push(ev: T) {
      buffer.push(ev);
      notify?.();
    },
    close() {
      closed = true;
      notify?.();
    },
    async *drain(): AsyncGenerator<T> {
      while (true) {
        while (buffer.length > 0) {
          // biome-ignore lint/style/noNonNullAssertion: length checked above
          yield buffer.shift()!;
        }
        if (closed) return;
        await new Promise<void>((r) => {
          notify = r;
        });
        notify = null;
      }
    },
  };
}

/* ── Tool construction ──────────────────────────────────────────────────── */

const RESULT_CHAR_CAP = 2_400;

function compact(value: unknown): string {
  const s = JSON.stringify(value);
  return s.length > RESULT_CHAR_CAP ? `${s.slice(0, RESULT_CHAR_CAP)}…(truncated)` : s;
}

export type ResearchToolContext = {
  orgId: string;
  userId: string;
  role: Role;
  /** Objects the caller's role can READ — the tools' entire universe. */
  readable: ObjectWithFields[];
  /** Open an org-scoped transaction (tool calls outlive the procedure's). */
  runInOrg: <T>(fn: (tx: DbExecutor) => Promise<T>) => Promise<T>;
  emit: (ev: ToolEvent) => void;
};

const SortSchema = z.object({ fieldKey: z.string(), direction: z.enum(['asc', 'desc']) });

/** Build the AI SDK tool set for this caller. Only allowed tools exist at
 *  all — the model never sees a tool the admin turned off for this role. */
export function buildResearchTools(
  allowed: EffectiveTool[],
  ctx: ResearchToolContext,
): Record<string, Tool> {
  const byKey = new Map(ctx.readable.map((o) => [o.object.key, o]));
  const adminish = isAdminish(ctx.role);

  const aclFor = (tx: DbExecutor, target: ObjectWithFields) =>
    target.object.defaultVisibility === 'private' && !adminish
      ? visibleSharedRecordIds(
          tx,
          { orgId: ctx.orgId, userId: ctx.userId, role: ctx.role },
          target.object.id,
        ).then((sharedRecordIds) => ({ userId: ctx.userId, sharedRecordIds, isAdminish: adminish }))
      : Promise.resolve({ userId: ctx.userId, sharedRecordIds: [], isAdminish: adminish });

  /** Wrap an executor with the approval + event lifecycle. */
  const guarded =
    (def: EffectiveTool, run: (input: unknown, tx: DbExecutor) => Promise<unknown>) =>
    async (input: unknown): Promise<string> => {
      const callId = randomUUID();
      if (!def.autoApprove) {
        ctx.emit({ type: 'tool-approval', callId, toolId: def.id, title: def.title, input });
        const approved = await awaitApproval(callId);
        if (!approved) {
          ctx.emit({ type: 'tool-end', callId, toolId: def.id, status: 'denied' });
          return 'The user declined this tool call. Continue without it.';
        }
      }
      ctx.emit({ type: 'tool-start', callId, toolId: def.id, title: def.title, input });
      try {
        const result = await ctx.runInOrg((tx) => run(input, tx));
        const summary = compact(result);
        ctx.emit({ type: 'tool-end', callId, toolId: def.id, status: 'done', summary });
        return summary;
      } catch (err) {
        const message = err instanceof Error ? err.message : 'tool failed';
        ctx.emit({ type: 'tool-end', callId, toolId: def.id, status: 'error', summary: message });
        return `Tool error: ${message}. Continue without this data.`;
      }
    };

  const requireObject = (objectKey: string): ObjectWithFields => {
    const target = byKey.get(objectKey);
    if (!target) throw new Error(`object '${objectKey}' not found or not readable`);
    return target;
  };

  const tools: Record<string, Tool> = {};
  for (const def of allowed) {
    if (def.id === 'search_records') {
      tools.search_records = tool({
        description: def.description,
        inputSchema: z.object({
          objectKey: z.string(),
          search: z.string().optional(),
          filters: z.array(FilterEntrySchema).default([]),
          sort: z.array(SortSchema).default([]),
          limit: z.number().int().min(1).max(20).default(10),
        }),
        execute: guarded(def, async (raw, tx) => {
          const input = raw as {
            objectKey: string;
            search?: string;
            filters: never[];
            sort: never[];
            limit: number;
          };
          const target = requireObject(input.objectKey);
          const fields = await hydratePicklistOptions(tx, ctx.orgId, target.fields);
          const rows = await listRecords(tx, {
            orgId: ctx.orgId,
            object: target.object,
            fields,
            search: input.search,
            filters: input.filters,
            sort: input.sort,
            limit: input.limit,
            acl: await aclFor(tx, target),
          });
          return rows.map((r) => ({ id: r.id, name: r.name, ...r.data }));
        }),
      });
    } else if (def.id === 'aggregate_records') {
      tools.aggregate_records = tool({
        description: def.description,
        inputSchema: z.object({
          objectKey: z.string(),
          groupBy: z.string().nullish(),
          groupByGrain: z.enum(['day', 'week', 'month', 'quarter', 'year']).optional(),
          groupBy2: z.string().nullish(),
          measure: z.object({ agg: ReportAggSchema, fieldKey: z.string().optional() }),
          having: ReportHavingSchema.optional(),
          filters: z.array(FilterEntrySchema).default([]),
          limit: z.number().int().min(1).max(50).default(25),
        }),
        execute: guarded(def, async (raw, tx) => {
          const input = raw as {
            objectKey: string;
            groupBy?: string | null;
            groupByGrain?: 'day' | 'week' | 'month' | 'quarter' | 'year';
            groupBy2?: string | null;
            measure: { agg: never; fieldKey?: string };
            having?: never;
            filters: never[];
            limit: number;
          };
          const target = requireObject(input.objectKey);
          const fields = await hydratePicklistOptions(tx, ctx.orgId, target.fields);
          const targetKeys = collectRefTargetKeys(
            fields,
            [input.groupBy, input.groupBy2],
            input.filters,
          );
          const targets = new Map(
            targetKeys.flatMap((k) => (byKey.has(k) ? [[k, requireObject(k)] as const] : [])),
          );
          const resolved = resolveReportSpec(
            fields,
            {
              groupBy: input.groupBy,
              groupByGrain: input.groupByGrain,
              groupBy2: input.groupBy2,
              measure: input.measure,
            },
            targets,
          );
          if (!resolved.ok) throw new Error(resolved.message);
          return aggregateRecords(tx, {
            orgId: ctx.orgId,
            object: target.object,
            fields,
            groups: resolved.value.groups,
            measure: { fn: input.measure.agg, field: resolved.value.measureField },
            having: input.having,
            filters: input.filters,
            refPaths: resolveFilterRefPaths(fields, targets, input.filters),
            acl: await aclFor(tx, target),
            limit: input.limit,
          });
        }),
      });
    } else if (def.id === 'run_query') {
      tools.run_query = tool({
        description: def.description,
        inputSchema: QuerySpecSchema,
        execute: guarded(def, async (raw, tx) => {
          const spec = raw as QuerySpecLike;
          const target = requireObject(spec.objectKey);
          const base = {
            object: target.object,
            fields: await hydratePicklistOptions(tx, ctx.orgId, target.fields),
          };
          const targets = new Map(
            collectQueryTargetKeys(base, spec).flatMap((k) =>
              byKey.has(k) ? [[k, requireObject(k)] as const] : [],
            ),
          );
          const resolved = resolveQuerySpec(base, targets, spec);
          if (!resolved.ok) throw new Error(resolved.message);
          return runQuery(tx, ctx.orgId, resolved.plan, {
            userId: ctx.userId,
            sharedRecordIds: (await aclFor(tx, target)).sharedRecordIds,
            isAdminish: adminish,
          });
        }),
      });
    } else if (def.id === 'get_record') {
      tools.get_record = tool({
        description: def.description,
        inputSchema: z.object({ objectKey: z.string(), id: z.string() }),
        execute: guarded(def, async (raw, tx) => {
          const input = raw as { objectKey: string; id: string };
          const target = requireObject(input.objectKey);
          // Same per-record visibility record.get applies: private objects
          // return null (= not found) unless owned/shared/adminish.
          const shared =
            target.object.defaultVisibility === 'private' && !adminish
              ? await visibleSharedRecordIds(
                  tx,
                  { orgId: ctx.orgId, userId: ctx.userId, role: ctx.role },
                  target.object.id,
                )
              : [];
          const row = await getRecord(tx, {
            orgId: ctx.orgId,
            object: target.object,
            fields: target.fields,
            id: input.id,
            acl: {
              userId: ctx.userId,
              isAdminish: adminish,
              hasShare: shared.includes(input.id),
            },
          });
          if (!row) throw new Error('record not found');
          return { id: row.id, name: row.name, ...row.data };
        }),
      });
    }
  }
  return tools;
}
