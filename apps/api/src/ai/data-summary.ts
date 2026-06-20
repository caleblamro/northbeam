// Preflight data summary for the AI artifact generator. Pulls the real
// numbers from the workspace's data so Claude can compose its tiles
// against truth instead of guessing. Cheap by design — bounded queries,
// no scans bigger than the visible record count.

import {
  countRecords,
  type FieldRow,
  listRecords,
  type ObjectRow,
  sumField,
} from '@northbeam/db';
import type { Database } from '@northbeam/db';
import type { DataSummary } from './artifact-generator.js';

const PICKLIST_GROUPS_TO_INCLUDE = 2;
const SAMPLE_ROWS_FOR_GROUPBY = 500;

/** Build a DataSummary for the given object. Errors are surfaced — the
 *  caller wraps in try/catch and falls back to an empty summary so a flaky
 *  query never blocks generation. */
export async function buildDataSummary(
  db: Database,
  opts: { orgId: string; object: ObjectRow; fields: FieldRow[] },
): Promise<DataSummary> {
  const recordCount = await countRecords(db, {
    orgId: opts.orgId,
    object: opts.object,
  });

  // Picklist group-by counts. We sample the first N rows (cap to keep this
  // bounded on big workspaces) and tally in JS — the dynamic record layer
  // doesn't have a generic GROUP BY helper yet, and a sample is enough for
  // a CRM dashboard prompt.
  const picklists = opts.fields.filter((f) => f.type === 'picklist').slice(0, PICKLIST_GROUPS_TO_INCLUDE);
  const picklistCounts: DataSummary['picklistCounts'] = [];
  if (picklists.length > 0) {
    const rows = await listRecords(db, {
      orgId: opts.orgId,
      object: opts.object,
      fields: opts.fields,
      limit: SAMPLE_ROWS_FOR_GROUPBY,
    });
    for (const f of picklists) {
      const tally = new Map<string, number>();
      for (const r of rows) {
        const v = r.data[f.key];
        if (typeof v !== 'string' || v.length === 0) continue;
        tally.set(v, (tally.get(v) ?? 0) + 1);
      }
      const counts = [...tally.entries()]
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count);
      picklistCounts.push({ fieldKey: f.key, fieldLabel: f.label, counts });
    }
  }

  // First currency / number → sum + average.
  const numericField = opts.fields.find(
    (f) => f.type === 'currency' || f.type === 'number',
  );
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
