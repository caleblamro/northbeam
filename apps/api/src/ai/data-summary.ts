// Preflight data summary for the AI artifact generator. Pulls the real
// numbers from the workspace's data so Claude can compose its tiles
// against truth instead of guessing. Cheap by design — bounded queries,
// one aggregate per summarized field.

import {
  type DbExecutor,
  type FieldRow,
  type ObjectRow,
  aggregateRecords,
  countRecords,
  sumField,
} from '@northbeam/db';
import type { DataSummary } from './artifact-generator.js';

const PICKLIST_GROUPS_TO_INCLUDE = 2;
const BUCKETS_PER_GROUP = 8;

/** Build a DataSummary for the given object. Errors are surfaced — the
 *  caller wraps in try/catch and falls back to an empty summary so a flaky
 *  query never blocks generation. */
export async function buildDataSummary(
  db: DbExecutor,
  opts: { orgId: string; object: ObjectRow; fields: FieldRow[] },
): Promise<DataSummary> {
  const recordCount = await countRecords(db, {
    orgId: opts.orgId,
    object: opts.object,
  });

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
      groupBy: f,
      measure: { fn: 'count' },
      filters: [],
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
    const sum = await sumField(db, {
      orgId: opts.orgId,
      object: opts.object,
      field: numericField,
    });
    numericSummary = {
      fieldKey: numericField.key,
      fieldLabel: numericField.label,
      sum,
      avg: recordCount === 0 ? 0 : Math.round(sum / recordCount),
    };
  }

  return { recordCount, picklistCounts, numericSummary };
}
