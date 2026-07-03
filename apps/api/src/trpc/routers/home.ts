// /trpc/home — workspace summary for the home dashboard. Wraps a few
// metadata-driven count/sum queries so the home page renders real numbers
// instead of mocked totals.

import {
  type FieldRow,
  countRecords,
  displayName,
  getObjectByKey,
  listRecords,
  sumField,
} from '@northbeam/db';
import { z } from 'zod';
import { protectedProcedure, router } from '../trpc.js';

const OPEN_STAGES = ['new', 'qualified', 'negotiation'];
const CLOSED_STAGES = new Set(['closed_won', 'closed_lost']);
const DAY_MS = 86_400_000;

type AttentionItem = {
  id: string;
  kind: 'activity_overdue' | 'activity_due_soon' | 'activity_high_priority' | 'deal_closing';
  severity: 'critical' | 'today' | 'week';
  title: string;
  sub: string;
  objectKey: string;
  recordId: string;
  dueAt: Date | null;
};

function asDate(value: unknown): Date | null {
  if (value == null || value === '') return null;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}

function optionLabel(fields: FieldRow[], fieldKey: string, value: unknown): string | null {
  const field = fields.find((f) => f.key === fieldKey);
  const options = (field?.config as { options?: Array<{ value: string; label: string }> } | null)
    ?.options;
  return options?.find((o) => o.value === value)?.label ?? null;
}

export const homeRouter = router({
  /** Counts + recent activity for the home dashboard. */
  summary: protectedProcedure.query(async ({ ctx }) => {
    const orgId = ctx.auth.organizationId;

    const [accountObj, contactObj, dealObj, activityObj] = await Promise.all([
      getObjectByKey(ctx.db, orgId, 'account'),
      getObjectByKey(ctx.db, orgId, 'contact'),
      getObjectByKey(ctx.db, orgId, 'deal'),
      getObjectByKey(ctx.db, orgId, 'activity'),
    ]);

    const [accountCount, contactCount, dealCount] = await Promise.all([
      accountObj ? countRecords(ctx.db, { orgId, object: accountObj.object }) : 0,
      contactObj ? countRecords(ctx.db, { orgId, object: contactObj.object }) : 0,
      dealObj ? countRecords(ctx.db, { orgId, object: dealObj.object }) : 0,
    ]);

    // Pipeline value across open stages (new/qualified/negotiation) — uses
    // sumField with a stage-field filter so the engine computes server-side.
    let pipelineValue = 0;
    if (dealObj) {
      const amountField = dealObj.fields.find((f) => f.key === 'amount');
      const stageField = dealObj.fields.find((f) => f.key === 'stage');
      if (amountField && stageField) {
        pipelineValue = await sumField(ctx.db, {
          orgId,
          object: dealObj.object,
          field: amountField,
          whereField: stageField,
          whereIn: OPEN_STAGES,
        });
      }
    }

    // Recent activity feed: last 6 rows from the activity object. Empty array
    // if the workspace was just seeded and has no records yet.
    let recentActivities: Array<{
      id: string;
      name: string;
      createdAt: Date;
      subtype: string | null;
    }> = [];
    if (activityObj) {
      const rows = await listRecords(ctx.db, {
        orgId,
        object: activityObj.object,
        fields: activityObj.fields,
        limit: 6,
      });
      recentActivities = rows.map((r) => ({
        id: r.id,
        name: displayName(activityObj.fields, r.data) || 'Activity',
        createdAt: r.createdAt,
        subtype: (r.data.type as string | undefined) ?? null,
      }));
    }

    return {
      counts: {
        accounts: accountCount,
        contacts: contactCount,
        deals: dealCount,
      },
      pipelineValue,
      recentActivities,
    };
  }),

  /** Needs-attention inbox: my open activities bucketed by due date, plus
   *  open deals closing within two weeks. The scans are filtered + sorted in
   *  SQL (open status, soonest due/close first) so the small row windows are
   *  the RIGHT rows; app code only buckets by severity. Returns the top
   *  `limit` items plus the true total so the UI can show "+N more". */
  attention: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(50).default(8) }).optional())
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 8;
      const orgId = ctx.auth.organizationId;
      const now = new Date();
      const endOfToday = new Date(now);
      endOfToday.setHours(23, 59, 59, 999);
      const weekAhead = new Date(now.getTime() + 7 * DAY_MS);
      const closeHorizon = new Date(now.getTime() + 14 * DAY_MS);

      const [activityObj, dealObj] = await Promise.all([
        getObjectByKey(ctx.db, orgId, 'activity'),
        getObjectByKey(ctx.db, orgId, 'deal'),
      ]);

      const items: AttentionItem[] = [];

      if (activityObj) {
        const rows = await listRecords(ctx.db, {
          orgId,
          object: activityObj.object,
          fields: activityObj.fields,
          // Open items with the soonest due dates first — the overdue/due-soon
          // buckets live at the top of this ordering, so a small window is
          // enough. (High-priority items with NO due date sort last and can
          // fall off in very busy workspaces — acceptable for an inbox.)
          filters: [{ fieldKey: 'status', op: 'neq', value: 'completed' }],
          sort: [{ fieldKey: 'due_date', direction: 'asc' }],
          limit: 60,
        });
        for (const r of rows) {
          if (r.ownerId !== ctx.auth.userId || r.data.status === 'completed') continue;
          const due = asDate(r.data.due_date);
          const high = r.data.priority === 'high';
          let kind: AttentionItem['kind'];
          let severity: AttentionItem['severity'];
          if (due && due < now) {
            kind = 'activity_overdue';
            severity = 'critical';
          } else if (due && due <= endOfToday) {
            kind = 'activity_due_soon';
            severity = 'today';
          } else if (due && due <= weekAhead) {
            kind = 'activity_due_soon';
            severity = 'week';
          } else if (high) {
            kind = 'activity_high_priority';
            severity = 'week';
          } else {
            continue;
          }
          const typeLabel = optionLabel(activityObj.fields, 'type', r.data.type) ?? 'Activity';
          items.push({
            id: `${kind}:${r.id}`,
            kind,
            severity,
            title: displayName(activityObj.fields, r.data) || 'Activity',
            sub: high ? `${typeLabel} · High priority` : typeLabel,
            objectKey: 'activity',
            recordId: r.id,
            dueAt: due,
          });
        }
      }

      if (dealObj) {
        const rows = await listRecords(ctx.db, {
          orgId,
          object: dealObj.object,
          fields: dealObj.fields,
          // Earliest close dates first — every deal inside the 14-day horizon
          // (including already-overdue closes) sorts before the ones outside
          // it, so this window is exact, not a sample.
          //
          // "Not closed" must INCLUDE deals with no/unknown stage (imported
          // data often has null stages), but a bare `neq` excludes empty
          // values by the shared filter semantics — so each entry is an OR
          // group: (no stage) OR (stage differs). AND of the two groups =
          // empty-stage OR fully open.
          filters: [
            {
              any: [
                { fieldKey: 'stage', op: 'isEmpty', value: null },
                { fieldKey: 'stage', op: 'neq', value: 'closed_won' },
              ],
            },
            {
              any: [
                { fieldKey: 'stage', op: 'isEmpty', value: null },
                { fieldKey: 'stage', op: 'neq', value: 'closed_lost' },
              ],
            },
            { fieldKey: 'close_date', op: 'isSet', value: null },
          ],
          sort: [{ fieldKey: 'close_date', direction: 'asc' }],
          limit: 60,
        });
        const amountField = dealObj.fields.find((f) => f.key === 'amount');
        const currency =
          (amountField?.config as { currencyCode?: string } | null)?.currencyCode ?? 'USD';
        const fmtAmount = new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency,
          maximumFractionDigits: 0,
        });
        for (const r of rows) {
          if (typeof r.data.stage === 'string' && CLOSED_STAGES.has(r.data.stage)) continue;
          const close = asDate(r.data.close_date);
          if (!close || close > closeHorizon) continue;
          const stageLabel = optionLabel(dealObj.fields, 'stage', r.data.stage) ?? 'Open';
          const amount = r.data.amount == null ? Number.NaN : Number(r.data.amount);
          items.push({
            id: `deal_closing:${r.id}`,
            kind: 'deal_closing',
            severity: close <= endOfToday ? 'today' : 'week',
            title: displayName(dealObj.fields, r.data) || 'Deal',
            sub: Number.isFinite(amount)
              ? `${stageLabel} · ${fmtAmount.format(amount)}`
              : stageLabel,
            objectKey: 'deal',
            recordId: r.id,
            dueAt: close,
          });
        }
      }

      const rank: Record<AttentionItem['severity'], number> = { critical: 0, today: 1, week: 2 };
      items.sort(
        (a, b) =>
          rank[a.severity] - rank[b.severity] ||
          (a.dueAt?.getTime() ?? Number.POSITIVE_INFINITY) -
            (b.dueAt?.getTime() ?? Number.POSITIVE_INFINITY),
      );
      // Top-N by severity/urgency; `total` lets the UI say "+N more".
      return { items: items.slice(0, limit), total: items.length };
    }),
});
