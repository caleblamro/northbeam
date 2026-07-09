// The auto-mapper: SObjectDescribe → a proposed Northbeam object (defs + layout +
// record types). Pure — no DB, no network — so it's unit-testable and dry-runnable
// against `sf sobject describe` JSON (see scripts/sf-dry-run-map.ts).
//
// Key rules (learned from the real org):
// - SF describe NEVER reports type 'formula': formula fields surface as their
//   return type with `calculated: true`. Branch on that FIRST.
// - Compound fields (BillingAddress, Contact.Name) are parents of real subfields
//   (BillingStreet…, FirstName/LastName) — import the subfields, skip the parent.
// - Custom fields unpopulated in a recent-records sample default to 'skip'
//   (populated-threshold rule); standard fields are always proposed.

import {
  type FieldConfig,
  type FieldType,
  type ObjectLayout,
  fieldColumnName,
  mapSalesforceType,
  objectTableName,
  pgTypeFor,
} from '@northbeam/db';
import type { DescribeField, SObjectDescribe } from '@northbeam/salesforce';
import { transpileFormula } from './transpile.js';

/** SF standard objects that map onto our seeded system objects. */
export const STANDARD_TARGETS: Record<string, string> = {
  Account: 'account',
  Contact: 'contact',
  Opportunity: 'deal',
  Task: 'activity',
  Event: 'activity',
};

// System/audit/plumbing fields that map to system columns or carry no user value.
const SYSTEM_FIELDS = new Set([
  'Id',
  'OwnerId',
  'RecordTypeId',
  'CreatedDate',
  'CreatedById',
  'LastModifiedDate',
  'LastModifiedById',
  'SystemModstamp',
  'IsDeleted',
  'LastActivityDate',
  'LastViewedDate',
  'LastReferencedDate',
  'MasterRecordId',
  'CurrencyIsoCode',
  'ConnectionReceivedId',
  'ConnectionSentId',
]);

const UNSUPPORTED_TYPES = new Set(['address', 'location', 'base64', 'anytype', 'complexvalue']);

export type ProposedField = {
  sfField: string;
  sfLabel: string;
  sfType: string;
  key: string;
  columnName: string;
  label: string;
  type: FieldType;
  pgType: string;
  config: FieldConfig;
  required: boolean;
  confidence: number; // 0–100
  status: 'mapped' | 'review' | 'skip';
  reason?: string;
  /** % of sampled records with a value (null = no sample taken). */
  populatedPct: number | null;
};

export type ProposedRecordType = {
  key: string;
  label: string;
  salesforceId: string;
  isDefault: boolean;
};

export type MappedObject = {
  sfObject: string;
  sfLabel: string;
  /** Our object_def key — an existing standard object or a new one. */
  targetKey: string;
  action: 'map' | 'create';
  label: string;
  labelPlural: string;
  tableName: string;
  fields: ProposedField[];
  recordTypes: ProposedRecordType[];
  layout: ObjectLayout;
  /** SF field name whose value feeds the record's denormalized `name` column. */
  nameFieldSf: string | null;
  hasOwner: boolean;
  hasRecordTypes: boolean;
  hasCreatedDate: boolean;
};

/** 'AnnualRevenue' → 'annual_revenue'; 'Lease_End_Date__c' → 'lease_end_date'. */
export function sfToKey(apiName: string): string {
  return (
    apiName
      .replace(/__c$/i, '')
      .replace(/__r$/i, '')
      .replace(/__/g, '_')
      .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
      .toLowerCase()
      .replace(/[^a-z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '') || 'field'
  );
}

function pickType(f: DescribeField): { type: FieldType; confident: boolean } {
  // calculated FIRST — describe reports formulas as their return type.
  if (f.calculated) return { type: 'formula', confident: true };
  return mapSalesforceType(f.type);
}

export function mapSObject(
  d: SObjectDescribe,
  opts: {
    /** sf object names selected for this run — references to objects outside the
     *  set (and outside the standard targets) are flagged for review. */
    importSet?: Set<string>;
    /** recent-records sample for populated-% (field name → values implied by rows). */
    sample?: Record<string, unknown>[];
    populatedThresholdPct?: number;
  } = {},
): MappedObject {
  const threshold = opts.populatedThresholdPct ?? 1;
  const compoundParents = new Set(
    d.fields.map((f) => f.compoundFieldName).filter((n): n is string => Boolean(n)),
  );
  const nameField = d.fields.find((f) => f.nameField) ?? null;

  const usedKeys = new Map<string, number>();
  const uniqueKey = (base: string): string => {
    const n = usedKeys.get(base) ?? 0;
    usedKeys.set(base, n + 1);
    return n === 0 ? base : `${base}_${n + 1}`;
  };

  const pctOf = (sfName: string): number | null => {
    if (!opts.sample || opts.sample.length === 0) return null;
    const hit = opts.sample.filter((r) => {
      const v = r[sfName];
      return v !== null && v !== undefined && v !== '' && v !== false;
    }).length;
    return Math.round((100 * hit) / opts.sample.length);
  };

  const fields: ProposedField[] = [];
  for (const f of d.fields) {
    const base: Omit<ProposedField, 'status' | 'confidence' | 'reason'> = {
      sfField: f.name,
      sfLabel: f.label,
      sfType: f.calculated ? `${f.type} (formula)` : f.type,
      key: '',
      columnName: '',
      label: f.label,
      type: 'text',
      pgType: 'text',
      config: {},
      required: false,
      populatedPct: pctOf(f.name),
    };

    const skip = (reason: string): ProposedField => ({
      ...base,
      key: sfToKey(f.name),
      columnName: '',
      status: 'skip',
      confidence: 0,
      reason,
    });

    if (SYSTEM_FIELDS.has(f.name)) {
      fields.push(skip('system field (mapped to a system column)'));
      continue;
    }
    if (compoundParents.has(f.name)) {
      fields.push(skip('compound parent — subfields imported individually'));
      continue;
    }
    if (UNSUPPORTED_TYPES.has(f.type.toLowerCase())) {
      fields.push(skip(`unsupported type '${f.type}'`));
      continue;
    }

    const { type, confident } = pickType(f);
    // Emitted type can differ from the raw pick (a polymorphic SF reference maps
    // to our reference_any), so track it separately from the classification.
    let emitType = type;
    const key = uniqueKey(sfToKey(f.name));
    const config: FieldConfig = {};
    let status: ProposedField['status'] = confident ? 'mapped' : 'review';
    let confidence = confident ? 90 : 40;
    let reason: string | undefined;

    if (type === 'formula') {
      // Return type now; `config.formula` is set by the post-loop transpile
      // pass (needs every field's final key to resolve references).
      config.returnType = mapSalesforceType(f.type).type;
      status = 'review';
      confidence = 50;
      reason = 'formula pending transpile';
    } else if (type === 'picklist' || type === 'multipicklist') {
      config.options = f.picklistValues
        .filter((p) => p.active)
        .map((p) => ({ value: p.value, label: p.label }));
      config.restrictToOptions = f.restrictedPicklist ?? false;
    } else if (type === 'reference') {
      if (f.referenceTo.length === 1) {
        const target = f.referenceTo[0] as string;
        const targetKey = STANDARD_TARGETS[target] ?? sfToKey(target);
        config.targetObject = targetKey;
        config.relationshipName = f.relationshipName ?? undefined;
        const inSet =
          target === d.name || // self-reference always resolves
          Boolean(STANDARD_TARGETS[target]) ||
          (opts.importSet?.has(target) ?? false);
        if (target === 'User') {
          status = 'skip';
          confidence = 0;
          reason = 'User lookup — owner/user mapping handled separately';
        } else if (!inSet) {
          status = 'review';
          confidence = 40;
          reason = `references '${target}', which is not in this import`;
        }
      } else {
        // Polymorphic SF lookup (WhoId/WhatId) → native reference_any. Constrain
        // to the targets in this import; empty targetObjects = any object. It's
        // 'mapped' as long as at least one referenced object imports. (This
        // supersedes the per-target column-split approach from the direct-
        // integration branch — the crawler consumes config.targetObjects for
        // its traversal edges instead.)
        emitType = 'reference_any';
        config.targetObjects = f.referenceTo
          .filter((t) => t !== 'User')
          .map((t) => STANDARD_TARGETS[t] ?? sfToKey(t))
          .filter((k, i, a) => a.indexOf(k) === i);
        config.relationshipName = f.relationshipName ?? undefined;
        const anyInSet = f.referenceTo.some(
          (t) => t === d.name || Boolean(STANDARD_TARGETS[t]) || (opts.importSet?.has(t) ?? false),
        );
        if (anyInSet) {
          confidence = 75;
        } else {
          status = 'review';
          confidence = 30;
          reason = `polymorphic lookup (${f.referenceTo.slice(0, 3).join('/')}…) — no targets in this import`;
        }
      }
    } else if (type === 'currency' || type === 'percent' || type === 'number') {
      if (f.scale > 0) config.scale = f.scale;
      if (f.precision > 0) config.precision = f.precision;
    }
    if (f.type === 'encryptedstring') config.encrypted = true;

    // Populated-threshold: unpopulated CUSTOM fields default to skip; standard
    // fields always come (they're the shared CRM vocabulary).
    const pct = base.populatedPct;
    if (status !== 'skip' && f.custom && pct !== null && pct < threshold) {
      status = 'skip';
      confidence = 0;
      reason = `custom field populated on ${pct}% of sampled records (< ${threshold}%)`;
    }

    fields.push({
      ...base,
      key,
      columnName: fieldColumnName(key),
      type: emitType,
      pgType:
        emitType === 'formula'
          ? pgTypeFor(config.returnType ?? 'text', config)
          : pgTypeFor(emitType, config),
      config,
      required: !f.nillable && f.createable && type !== 'checkbox',
      status,
      confidence,
      reason,
      populatedPct: pct,
    });

  }

  // Formula transpile pass — runs after every field has its final key so refs
  // resolve. Same-object refs resolve to their NB key; cross-object paths and
  // unsupported functions leave the field as 'review' (we never store an
  // untranslated SF formula).
  const sfNameToKey = new Map(fields.map((pf) => [pf.sfField, pf.key]));
  for (const pf of fields) {
    if (pf.type !== 'formula' || pf.status === 'skip') continue;
    const sf = d.fields.find((x) => x.name === pf.sfField)?.calculatedFormula ?? '';
    const result = transpileFormula(sf, (path) => sfNameToKey.get(path) ?? null);
    if (result.ok) {
      pf.config.formula = result.formula;
      pf.status = 'mapped';
      pf.confidence = 80;
      pf.reason = undefined;
    } else {
      pf.config.formula = '';
      pf.status = 'review';
      pf.confidence = 40;
      pf.reason = `formula needs review: ${result.reason}`;
    }
  }

  const targetKey = STANDARD_TARGETS[d.name] ?? sfToKey(d.name);
  const mapped = fields.filter((f) => f.status === 'mapped');

  return {
    sfObject: d.name,
    sfLabel: d.label,
    targetKey,
    action: STANDARD_TARGETS[d.name] ? 'map' : 'create',
    label: d.label,
    labelPlural: d.labelPlural,
    tableName: objectTableName(targetKey),
    fields,
    recordTypes: d.recordTypeInfos
      .filter((rt) => !rt.master && rt.available)
      .map((rt) => ({
        key: sfToKey(rt.developerName),
        label: rt.name,
        salesforceId: rt.recordTypeId,
        isDefault: rt.defaultRecordTypeMapping,
      })),
    layout: buildLayout(d.label, mapped),
    nameFieldSf: nameField?.name ?? null,
    hasOwner: d.fields.some((f) => f.name === 'OwnerId'),
    hasRecordTypes: d.recordTypeInfos.some((rt) => !rt.master),
    hasCreatedDate: d.fields.some((f) => f.name === 'CreatedDate'),
  };
}

/** Sensible default layout from the mapped fields; editable later in the object manager. */
function buildLayout(objectLabel: string, mapped: ProposedField[]): ObjectLayout {
  const main = mapped.filter((f) => f.type !== 'textarea');
  const notes = mapped.filter((f) => f.type === 'textarea');
  const sections: ObjectLayout['sections'] = [];
  const CHUNK = 10;
  for (let i = 0; i < main.length; i += CHUNK) {
    sections.push({
      id: `s${sections.length + 1}`,
      label: i === 0 ? `${objectLabel} information` : 'Additional details',
      cols: 2,
      fields: main.slice(i, i + CHUNK).map((f) => f.key),
    });
  }
  if (notes.length) {
    sections.push({ id: 'notes', label: 'Notes', cols: 1, fields: notes.map((f) => f.key) });
  }
  const numeric = mapped.filter((f) => ['currency', 'number', 'percent'].includes(f.type));
  return {
    sections,
    compactKeys: main.slice(0, 3).map((f) => f.key),
    statKeys: numeric.slice(0, 3).map((f) => f.key),
    listColumns: main.slice(0, 5).map((f) => f.key),
  };
}
