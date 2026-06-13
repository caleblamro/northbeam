// /trpc/home — workspace summary for the home dashboard. Wraps a few
// metadata-driven count/sum queries so the home page renders real numbers
// instead of mocked totals.

import { countRecords, displayName, getObjectByKey, listRecords, sumField } from '@northbeam/db';
import { protectedProcedure, router } from '../trpc.js';

const OPEN_STAGES = ['new', 'qualified', 'negotiation'];

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
        subtype: (r.data.subtype as string | undefined) ?? null,
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
});
