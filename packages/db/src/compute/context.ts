// Builds the evaluation context for a record's formulas. Same-record field
// values come straight from record.data; cross-object dotted paths
// (e.g. 'account.owner.name') are pre-resolved here by walking reference
// fields and reading the *stored* value on the related record — so the pure
// evaluator never touches the DB. Related formula values are read as stored
// (compute-on-write), not recomputed live; they refresh when that record
// itself changes.

import type { DbExecutor } from '../client.js';
import { getRecord } from '../dynamic/records.js';
import { narrowFieldConfig } from '../field-types.js';
import { collectFieldKeys, parseFormula } from '../formula/index.js';
import {
  type FieldRow,
  type ObjectRow,
  type ObjectWithFields,
  getObjectByKey,
} from '../queries/crm.js';

/** Distinct dotted (cross-object) paths referenced by the object's formulas. */
function crossObjectPaths(fields: FieldRow[]): Set<string> {
  const paths = new Set<string>();
  for (const f of fields) {
    if (f.type !== 'formula') continue;
    const cfg = narrowFieldConfig('formula', f.config);
    if (!cfg.formula) continue;
    try {
      for (const key of collectFieldKeys(parseFormula(cfg.formula))) {
        if (key.includes('.')) paths.add(key);
      }
    } catch {
      // A malformed formula is rejected at field-save; ignore here.
    }
  }
  return paths;
}

/** Flatten record.data plus every cross-object path the object's formulas read.
 *  Dotted keys (`account.owner.name`) are added alongside the same-record keys
 *  so the evaluator can look up either by a single map access. */
export async function buildComputeContext(
  db: DbExecutor,
  opts: {
    orgId: string;
    object: ObjectRow;
    fields: FieldRow[];
    record: { id: string; data: Record<string, unknown> };
    maxDepth?: number;
  },
): Promise<Record<string, unknown>> {
  const flat: Record<string, unknown> = { ...opts.record.data };
  const paths = crossObjectPaths(opts.fields);
  if (paths.size === 0) return flat;

  const maxDepth = opts.maxDepth ?? 5;
  const objCache = new Map<string, ObjectWithFields | null>();
  const recCache = new Map<string, Record<string, unknown> | null>();

  const loadObject = async (key: string) => {
    if (!objCache.has(key)) objCache.set(key, await getObjectByKey(db, opts.orgId, key));
    return objCache.get(key) ?? null;
  };
  const loadRecordData = async (owf: ObjectWithFields, id: string) => {
    const ck = `${owf.object.key}:${id}`;
    if (!recCache.has(ck)) {
      const row = await getRecord(db, {
        orgId: opts.orgId,
        object: owf.object,
        fields: owf.fields,
        id,
      });
      recCache.set(ck, row?.data ?? null);
    }
    return recCache.get(ck) ?? null;
  };

  for (const path of paths) {
    const segments = path.split('.');
    let curFields = opts.fields;
    let curData: Record<string, unknown> | null = opts.record.data;
    let value: unknown = null;

    for (let i = 0; i < segments.length; i++) {
      if (i > maxDepth || !curData) {
        value = null;
        break;
      }
      const seg = segments[i] as string;
      const field = curFields.find((f) => f.key === seg);
      if (!field) {
        value = null;
        break;
      }
      const raw = curData[seg] ?? null;
      if (i === segments.length - 1) {
        value = raw; // terminal segment → its stored value
        break;
      }
      // Intermediate segment must be a reference we can hop through.
      if (field.type !== 'reference' || raw == null) {
        value = null;
        break;
      }
      const refCfg = narrowFieldConfig('reference', field.config);
      if (!refCfg.targetObject) {
        value = null;
        break;
      }
      const target = await loadObject(refCfg.targetObject);
      if (!target) {
        value = null;
        break;
      }
      curData = await loadRecordData(target, String(raw));
      curFields = target.fields;
    }

    flat[path] = value;
  }

  return flat;
}
