// Preflight data summary for the AI artifact generator. Pulls the real
// numbers from the workspace's data so Claude can compose its tiles
// against truth instead of guessing. Cheap by design — bounded queries,
// one aggregate per summarized field.

import {
  type AggregateOpts,
  type DbExecutor,
  type FieldRow,
  type ObjectRow,
  aggregateRecords,
} from '@northbeam/db';
import type { DataSummary } from './artifact-generator.js';

const PICKLIST_GROUPS_TO_INCLUDE = 2;
const BUCKETS_PER_GROUP = 8;
const DATE_BUCKETS_TO_INCLUDE = 12;

/** Build a DataSummary for the given object. Errors are surfaced — the
 *  caller wraps in try/catch and falls back to an empty summary so a flaky
 *  query never blocks generation.
 *
 *  `acl` MUST carry the caller's visibility (same shape record.aggregate
 *  builds) — otherwise the model's note can cite numbers the user's rendered
 *  dashboard will never show. Every query below goes through aggregateRecords
 *  so the shared aclPredicate applies uniformly. */
export async function buildDataSummary(
  db: DbExecutor,
  opts: { orgId: string; object: ObjectRow; fields: FieldRow[]; acl?: AggregateOpts['acl'] },
): Promise<DataSummary> {
  const [countRow] = await aggregateRecords(db, {
    orgId: opts.orgId,
    object: opts.object,
    fields: opts.fields,
    groups: [],
    measure: { fn: 'count' },
    filters: [],
    acl: opts.acl,
  });
  const recordCount = countRow?.count ?? 0;

  // Picklist group-by counts — a real SQL GROUP BY per field (same
  // aggregateRecords helper record.aggregate uses), top buckets only to keep
  // the prompt budget bounded.
  const picklists = opts.fields
    .filter((f) => f.type === 'picklist')
    .slice(0, PICKLIST_GROUPS_TO_INCLUDE);
  const picklistCounts: DataSummary['picklistCounts'] = [];
  for (const f of picklists) {
    const buckets = await aggregateRecords(db, {
      orgId: opts.orgId,
      object: opts.object,
      fields: opts.fields,
      groups: [{ field: f }],
      measure: { fn: 'count' },
      filters: [],
      acl: opts.acl,
      limit: BUCKETS_PER_GROUP,
    });
    const counts = buckets
      .filter((b) => typeof b.group === 'string' && b.group.length > 0)
      .map((b) => ({ value: String(b.group), count: b.count }));
    picklistCounts.push({ fieldKey: f.key, fieldLabel: f.label, counts });
  }

  // First currency / number → sum + average.
  const numericField = opts.fields.find((f) => f.type === 'currency' || f.type === 'number');
  let numericSummary: DataSummary['numericSummary'] = null;
  if (numericField && recordCount > 0) {
    const [sumRow] = await aggregateRecords(db, {
      orgId: opts.orgId,
      object: opts.object,
      fields: opts.fields,
      groups: [],
      measure: { fn: 'sum', field: numericField },
      filters: [],
      acl: opts.acl,
    });
    const sum = sumRow?.value ?? 0;
    numericSummary = {
      fieldKey: numericField.key,
      fieldLabel: numericField.label,
      sum,
      avg: recordCount === 0 ? 0 : Math.round(sum / recordCount),
    };
  }

  // First date/datetime → month-grain record counts, so the model sees
  // whether a time-series chart has enough buckets to be interesting.
  const dateField = opts.fields.find((f) => f.type === 'date' || f.type === 'datetime');
  let dateSeries: DataSummary['dateSeries'] = null;
  if (dateField && recordCount > 0) {
    const buckets = await aggregateRecords(db, {
      orgId: opts.orgId,
      object: opts.object,
      fields: opts.fields,
      groups: [{ field: dateField, grain: 'month' }],
      measure: { fn: 'count' },
      filters: [],
      acl: opts.acl,
      limit: DATE_BUCKETS_TO_INCLUDE,
    });
    const points = buckets
      .filter((b) => typeof b.group === 'string' && b.group.length > 0)
      .map((b) => ({ bucket: String(b.group).slice(0, 7), count: b.count }));
    if (points.length > 0) {
      dateSeries = { fieldKey: dateField.key, fieldLabel: dateField.label, points };
    }
  }

  return { recordCount, picklistCounts, numericSummary, dateSeries };
}
