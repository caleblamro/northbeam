// Salesforce Flow / Workflow Rule → Northbeam flow-graph translator.
// Pure — no DB, no network — so it's unit-testable and dry-runnable against
// `sf data query --use-tooling-api` JSON (see scripts/sf-dry-run-flow.ts).
//
// Fidelity policy: an automation either translates COMPLETELY or becomes a
// read-only reference (ok:false → flow row status 'needs_rebuild'). The only
// sanctioned partial translations are (a) per-field degrades on record
// create/update values (cross-object / formula-valued fields drop with a
// note, never the whole write silently) and (b) faultConnector edges, which
// drop with a note because Northbeam fails the run on error instead of
// branching. Translated flows land 'paused' (active in SF) or 'draft' —
// never auto-active.
//
// Shapes verified against a real org (fixture, Tooling REST v67, 2026-07 —
// see the @northbeam/salesforce header): start/assignment/decision element
// bodies, the value union (explicit nulls everywhere), connector shape,
// pre-v49 startElementReference. UNVERIFIED (fixture org had zero instances;
// handled defensively, reference on any surprise): actionCalls actionType
// literals, scheduledPaths field names, recordLookups/Updates/Creates/Deletes
// /loops element bodies, WorkflowRule/Alert/Task metadata. Flow `waits`
// elements (waitEvents) are entirely unverified, so any flow containing one
// becomes a reference — SF "scheduled paths" on the start element are the
// supported wait form.

import {
  FLOW_LIMITS,
  type FlowCondition,
  type FlowEdge,
  type FlowFilter,
  type FlowFilterOp,
  type FlowGraph,
  FlowGraphSchema,
  type FlowNode,
  type FlowNodeOfType,
  type FlowTrigger,
  validateFlowGraph,
} from '@northbeam/core';
import { type FieldType, type FlowReferenceMeta, validateFormula } from '@northbeam/db';
import type {
  FlowActionCallElement,
  FlowConnector,
  FlowElementValue,
  FlowMetadata,
  FlowRecordFilterItem,
  FlowVersionRecord,
  ToolingMetadataRecord,
  WorkflowAlertMetadata,
  WorkflowFieldUpdateMetadata,
  WorkflowRuleMetadata,
  WorkflowTaskMetadata,
} from '@northbeam/salesforce';
import { sfToKey } from './mapper.js';
import {
  NAME_SENTINEL,
  type ObjectResolution,
  normalizeToken,
  resolveToken,
} from './report-mapper.js';
import { type FieldResolver, type TranspileResult, transpileFormula } from './transpile.js';

class Unsupported extends Error {}

/* ── Public result shape ─────────────────────────────────────────────────── */

export type TranslatedAutomation =
  | {
      ok: true;
      sfId: string;
      apiName: string;
      key: string;
      name: string;
      description: string | null;
      sfObject: string;
      targetObjectKey: string;
      trigger: FlowTrigger;
      graph: FlowGraph;
      /** Active in SF → paused, inactive → draft. Never 'active'. */
      status: 'paused' | 'draft';
      activeInSf: boolean;
      notes: string[];
    }
  | {
      ok: false;
      sfId: string;
      apiName: string;
      key: string;
      name: string;
      sfType: FlowReferenceMeta['sfType'];
      sfObject?: string;
      description?: string;
      activeInSf: boolean;
      reason: string;
    };

/** Flow key from an SF api name: KEY_RE-safe, ≤48 chars, optional kind prefix. */
export function flowKeyFrom(apiName: string, prefix = ''): string {
  const key = `${prefix}${sfToKey(apiName)}`.slice(0, 48).replace(/_+$/, '');
  return key || 'imported_flow';
}

export function resolutionForSfObject(
  resolutions: Map<string, ObjectResolution>,
  sfObject: string,
): ObjectResolution | null {
  const direct = resolutions.get(sfObject);
  if (direct) return direct;
  const norm = normalizeToken(sfObject.replace(/__c$/i, ''));
  for (const res of resolutions.values()) {
    if (normalizeToken(res.sfObject.replace(/__c$/i, '')) === norm) return res;
  }
  return null;
}

/** Same-object field only — the name sentinel and cross-object paths are not
 *  addressable in flow configs (`name` is a system column, not a FieldRow). */
function resolveDataField(
  res: ObjectResolution,
  token: string,
): { key: string; type: FieldType } | null {
  const hit = resolveToken(res, token);
  if (!hit || hit.key === NAME_SENTINEL || !('type' in hit)) return null;
  return hit;
}

/* ── SF formula pre-normalizer over transpile.ts ─────────────────────────── */

const MERGE_RE = /\{!\s*([^}]+?)\s*\}/g;

/** Transpile an SF flow formula (merge-field syntax allowed): `{!$Record.X}`
 *  unwraps to a field ref, `$Record__Prior` maps to the `{oldRecord.<key>}`
 *  scope condition.ts flattens, and `{!formulaName}` inlines the named flow
 *  formula. Residual `{!…}` or `$` globals → unsupported. */
export function transpileFlowFormula(
  sfFormula: string,
  res: ObjectResolution,
  formulasByName?: Map<string, string>,
): TranspileResult {
  let src = sfFormula?.trim() ?? '';
  if (!src) return { ok: false, reason: 'empty formula' };

  for (let depth = 0; MERGE_RE.test(src); depth++) {
    if (depth >= 5) return { ok: false, reason: 'formula references nest too deep' };
    let changed = false;
    src = src.replace(MERGE_RE, (whole, expr: string) => {
      const inline = formulasByName?.get(expr);
      if (inline != null) {
        changed = true;
        return `(${inline})`;
      }
      if (/^[$A-Za-z_][A-Za-z0-9_.$]*$/.test(expr)) {
        changed = true;
        return expr; // bare merge of a reference — unwrap for the tokenizer
      }
      return whole;
    });
    if (!changed) break;
  }
  if (/\{!/.test(src)) return { ok: false, reason: 'unresolvable {!…} merge field' };

  // The transpile tokenizer rejects '$'; rewrite the two supported globals to
  // plain dotted paths first, then refuse anything else ($User, $Flow, …).
  src = src.replace(/\$Record__Prior\./g, 'NBPRIOR.').replace(/\$Record\./g, 'NBRECORD.');
  if (src.includes('$')) return { ok: false, reason: 'unsupported $ global variable' };

  const resolve: FieldResolver = (path) => {
    if (path.startsWith('NBPRIOR.')) {
      const field = resolveDataField(res, path.slice('NBPRIOR.'.length));
      return field ? `oldRecord.${field.key}` : null;
    }
    const raw = path.startsWith('NBRECORD.') ? path.slice('NBRECORD.'.length) : path;
    const field = resolveDataField(res, raw);
    return field ? field.key : null;
  };
  return transpileFormula(src, resolve);
}

/* ── Value translation ───────────────────────────────────────────────────── */

type FlowValue = string | number | boolean | null;
type ValueResult = { ok: true; value: FlowValue } | { ok: false; reason: string };

type Ctx = {
  res: ObjectResolution;
  formulas: Map<string, string>;
  constants: Map<string, FlowValue>;
  /** SF variable/element name → `{{…}}` template path (without braces). */
  varTemplates: Map<string, string>;
  /** SF name → resolution of the record(s) it holds. */
  recordVars: Map<string, { nbName: string; res: ObjectResolution }>;
  collectionVars: Map<string, { nbName: string; res: ObjectResolution }>;
  loopVars: Map<string, ObjectResolution>;
  usedVarNames: Set<string>;
  notes: string[];
};

/** SF reference (`$Record.X`, `Get_First.Field`, loop-item paths…) → a
 *  `{{scope.path}}` template string. */
function refToTemplate(ref: string, ctx: Ctx): ValueResult {
  const segments = ref.split('.');
  const head = segments[0] ?? '';
  const rest = segments.slice(1);

  if (head === '$Record' || head === '$Record__Prior') {
    const scope = head === '$Record' ? 'record' : 'oldRecord';
    if (rest.length !== 1) return { ok: false, reason: `cross-object reference '${ref}'` };
    const field = resolveDataField(ctx.res, rest[0] as string);
    if (!field) return { ok: false, reason: `field '${ref}' was not imported` };
    return { ok: true, value: `{{${scope}.${field.key}}}` };
  }
  if (head.startsWith('$')) return { ok: false, reason: `unsupported global '${ref}'` };

  if (rest.length === 0) {
    const constant = ctx.constants.get(head);
    if (constant !== undefined) return { ok: true, value: constant };
    const template = ctx.varTemplates.get(head);
    if (template) return { ok: true, value: `{{${template}}}` };
    if (ctx.formulas.has(head)) {
      return { ok: false, reason: `formula '${head}' cannot be used as a value` };
    }
    return { ok: false, reason: `reference '${ref}' is not translatable` };
  }
  if (rest.length === 1) {
    const fieldToken = rest[0] as string;
    const loopRes = ctx.loopVars.get(head);
    if (loopRes) {
      const field = resolveDataField(loopRes, fieldToken);
      if (!field) return { ok: false, reason: `loop-item field '${ref}' was not imported` };
      return { ok: true, value: `{{loopItem.${field.key}}}` };
    }
    const recordVar = ctx.recordVars.get(head);
    if (recordVar) {
      const field = resolveDataField(recordVar.res, fieldToken);
      if (!field) return { ok: false, reason: `field '${ref}' was not imported` };
      return { ok: true, value: `{{vars.${recordVar.nbName}.${field.key}}}` };
    }
  }
  return { ok: false, reason: `reference '${ref}' is not translatable` };
}

/** Translate merge fields embedded in a text value ('Hi {!$Record.Name__c}'). */
function mergeString(s: string, ctx: Ctx): ValueResult {
  let failure: string | null = null;
  const out = s.replace(MERGE_RE, (_whole, expr: string) => {
    const r = refToTemplate(expr, ctx);
    if (!r.ok) {
      failure = failure ?? `merge field '{!${expr}}': ${r.reason}`;
      return '';
    }
    return r.value == null ? '' : String(r.value);
  });
  return failure ? { ok: false, reason: failure } : { ok: true, value: out };
}

/** Flow value union → literal or `{{merge}}` template. At most one member is
 *  non-null (verified); unknown non-null members are refused, not guessed. */
function valueToFlowValue(v: FlowElementValue | null | undefined, ctx: Ctx): ValueResult {
  if (!v) return { ok: true, value: null };
  if (v.numberValue != null) return { ok: true, value: v.numberValue };
  if (v.booleanValue != null) return { ok: true, value: v.booleanValue };
  if (v.dateValue != null) return { ok: true, value: v.dateValue };
  if (v.dateTimeValue != null) return { ok: true, value: v.dateTimeValue };
  if (v.elementReference != null) return refToTemplate(String(v.elementReference), ctx);
  if (v.stringValue != null) return mergeString(String(v.stringValue), ctx);
  if (v.formulaExpression != null) {
    return { ok: false, reason: 'formula-valued — needs the formula engine' };
  }
  for (const [kind, member] of Object.entries(v)) {
    if (member != null && kind !== 'processMetadataValues') {
      return { ok: false, reason: `unsupported value kind '${kind}'` };
    }
  }
  return { ok: true, value: null };
}

/* ── Conditions ──────────────────────────────────────────────────────────── */

type RawCond = {
  leftRef: string;
  operator: string;
  value: FlowElementValue | null | undefined;
};

const COND_OPS: Record<string, FlowFilterOp> = {
  EqualTo: 'eq',
  NotEqualTo: 'neq',
  GreaterThan: 'gt',
  GreaterThanOrEqualTo: 'gte',
  LessThan: 'lt',
  LessThanOrEqualTo: 'lte',
  Contains: 'contains',
  StartsWith: 'startsWith',
  EndsWith: 'endsWith',
};

/** 'and'/'or'/null, or numbered forms that cover every condition with a single
 *  operator ('1 OR 2 OR 3'); anything else ('(1 OR 2) AND 3') is 'advanced'. */
function classifyLogic(logic: string | null | undefined, n: number): 'and' | 'or' | 'advanced' {
  if (!logic) return 'and';
  const s = logic.trim().toLowerCase();
  if (s === 'and') return 'and';
  if (s === 'or') return 'or';
  for (const word of ['and', 'or'] as const) {
    const re = new RegExp(`^\\d+(\\s+${word}\\s+\\d+)*$`);
    if (re.test(s)) {
      const nums = s.match(/\d+/g) ?? [];
      const seen = new Set(nums.map(Number));
      if (nums.length === n && seen.size === n && [...seen].every((i) => i >= 1 && i <= n)) {
        return word;
      }
    }
  }
  return 'advanced';
}

function filterFrom(
  field: { key: string; type: FieldType },
  op: FlowFilterOp,
  value: FlowValue,
): FlowFilter {
  if (field.type === 'checkbox' && (op === 'eq' || op === 'neq')) {
    const truthy = value === true || value === 'true' || value === '1';
    const wantTrue = op === 'eq' ? truthy : !truthy;
    return { fieldKey: field.key, op: wantTrue ? 'isTrue' : 'isFalse' };
  }
  if (value == null || value === '') {
    if (op === 'eq') return { fieldKey: field.key, op: 'isEmpty' };
    if (op === 'neq') return { fieldKey: field.key, op: 'isSet' };
  }
  if ((field.type === 'date' || field.type === 'datetime') && (op === 'gt' || op === 'lt')) {
    return { fieldKey: field.key, op: op === 'gt' ? 'after' : 'before', value };
  }
  return { fieldKey: field.key, op, ...(value == null ? {} : { value }) };
}

/** One condition → a Northbeam FlowFilter (filters mode). Throws Unsupported. */
function condToFilter(cond: RawCond, fieldRes: ObjectResolution, ctx: Ctx): FlowFilter {
  const token = cond.leftRef.startsWith('$Record.')
    ? cond.leftRef.slice('$Record.'.length)
    : cond.leftRef;
  if (token.startsWith('$') || cond.leftRef.startsWith('$Record__Prior.')) {
    throw new Unsupported(`condition on '${cond.leftRef}' is not a record field`);
  }
  const field = resolveDataField(fieldRes, token);
  if (!field) throw new Unsupported(`condition field '${cond.leftRef}' was not imported`);

  if (cond.operator === 'IsNull') {
    const isNull = cond.value?.booleanValue !== false;
    return { fieldKey: field.key, op: isNull ? 'isEmpty' : 'isSet' };
  }
  const op = COND_OPS[cond.operator];
  if (!op) throw new Unsupported(`condition operator '${cond.operator}' has no equivalent`);
  const value = valueToFlowValue(cond.value, ctx);
  if (!value.ok) throw new Unsupported(`condition value on '${cond.leftRef}': ${value.reason}`);
  return filterFrom(field, op, value.value);
}

/** Formula-mode literal: `$Record.X` → `{x}`, `$Record__Prior.X` →
 *  `{oldRecord.x}`, plain literals quoted. Templates are NOT valid inside
 *  formulas, so var/loop references are refused here. */
function formulaLiteral(v: FlowElementValue | null | undefined, ctx: Ctx): string {
  if (!v) return 'NULL';
  if (v.numberValue != null) return String(v.numberValue);
  if (v.booleanValue != null) return v.booleanValue ? 'TRUE' : 'FALSE';
  if (v.stringValue != null) return `"${String(v.stringValue).replace(/"/g, '\\"')}"`;
  if (v.dateValue != null) return `"${v.dateValue}"`;
  if (v.dateTimeValue != null) return `"${v.dateTimeValue}"`;
  if (v.elementReference != null) {
    const ref = String(v.elementReference);
    const braced = formulaRefOrNull(ref, ctx);
    if (braced) return braced;
    throw new Unsupported(`reference '${ref}' cannot appear in condition logic`);
  }
  throw new Unsupported('unsupported condition value');
}

function formulaRefOrNull(ref: string, ctx: Ctx): string | null {
  if (ref.startsWith('$Record__Prior.')) {
    const field = resolveDataField(ctx.res, ref.slice('$Record__Prior.'.length));
    return field ? `{oldRecord.${field.key}}` : null;
  }
  if (ref.startsWith('$Record.')) {
    const field = resolveDataField(ctx.res, ref.slice('$Record.'.length));
    return field ? `{${field.key}}` : null;
  }
  if (!ref.includes('.') && !ref.startsWith('$')) {
    const field = resolveDataField(ctx.res, ref);
    return field ? `{${field.key}}` : null;
  }
  return null;
}

function condToFormulaSnippet(cond: RawCond, ctx: Ctx): string {
  let left: string;
  const inline = ctx.formulas.get(cond.leftRef);
  if (inline != null) {
    const t = transpileFlowFormula(inline, ctx.res, ctx.formulas);
    if (!t.ok) throw new Unsupported(`formula '${cond.leftRef}': ${t.reason}`);
    left = `(${t.formula})`;
  } else {
    const braced = formulaRefOrNull(cond.leftRef, ctx);
    if (!braced) throw new Unsupported(`condition on '${cond.leftRef}' is not a record field`);
    left = braced;
  }
  switch (cond.operator) {
    case 'EqualTo':
      return `(${left} = ${formulaLiteral(cond.value, ctx)})`;
    case 'NotEqualTo':
      return `(${left} <> ${formulaLiteral(cond.value, ctx)})`;
    case 'GreaterThan':
      return `(${left} > ${formulaLiteral(cond.value, ctx)})`;
    case 'GreaterThanOrEqualTo':
      return `(${left} >= ${formulaLiteral(cond.value, ctx)})`;
    case 'LessThan':
      return `(${left} < ${formulaLiteral(cond.value, ctx)})`;
    case 'LessThanOrEqualTo':
      return `(${left} <= ${formulaLiteral(cond.value, ctx)})`;
    case 'Contains':
      return `CONTAINS(${left}, ${formulaLiteral(cond.value, ctx)})`;
    case 'StartsWith':
      return `BEGINS(${left}, ${formulaLiteral(cond.value, ctx)})`;
    case 'IsNull':
      return cond.value?.booleanValue !== false ? `ISBLANK(${left})` : `NOT (ISBLANK(${left}))`;
    default:
      throw new Unsupported(`condition operator '${cond.operator}' has no equivalent`);
  }
}

/** Conditions + condition logic → FlowCondition. Simple and/or logic over
 *  plain `$Record` fields becomes filters mode; `$Record__Prior` refs,
 *  formula lefts, and advanced numbered logic ('(1 OR 2) AND 3') become
 *  formula mode with full fidelity. Throws Unsupported otherwise. */
function flowCondition(
  conds: RawCond[],
  logic: string | null | undefined,
  ctx: Ctx,
): FlowCondition {
  if (conds.length === 0) throw new Unsupported('empty condition');
  if (conds.length > 10) throw new Unsupported(`too many conditions (${conds.length} > 10)`);
  const kind = classifyLogic(logic, conds.length);

  const needsFormula =
    kind === 'advanced' ||
    conds.some(
      (c) =>
        c.leftRef.startsWith('$Record__Prior.') ||
        ctx.formulas.has(c.leftRef) ||
        c.value?.elementReference != null,
    );

  if (!needsFormula) {
    return {
      mode: 'filters',
      logic: kind,
      filters: conds.map((c) => condToFilter(c, ctx.res, ctx)),
    };
  }

  const snippets = conds.map((c) => condToFormulaSnippet(c, ctx));
  let formula: string;
  if (kind === 'advanced') {
    formula = (logic as string).replace(/\d+/g, (num) => {
      const snippet = snippets[Number(num) - 1];
      if (!snippet) throw new Unsupported(`condition logic references missing row ${num}`);
      return snippet;
    });
  } else {
    formula = snippets.join(kind === 'or' ? ' OR ' : ' AND ');
  }
  const check = validateFormula(formula);
  if (!check.ok) throw new Unsupported(`condition formula invalid: ${check.message}`);
  return { mode: 'formula', formula };
}

/** Record filter items (get_records / query-target updates) → filters +
 *  logic. Field keys resolve against `fieldRes` (the queried object); values
 *  resolve against the trigger context. Formula fallback is not available in
 *  query configs, so advanced logic is unsupported here. */
function queryFilters(
  items: FlowRecordFilterItem[] | null | undefined,
  logic: string | null | undefined,
  fieldRes: ObjectResolution,
  ctx: Ctx,
): { filters: FlowFilter[]; logic: 'and' | 'or' } {
  const conds: RawCond[] = (items ?? []).map((f) => ({
    leftRef: f.field ?? '',
    operator: f.operator ?? 'EqualTo',
    value: f.value,
  }));
  if (conds.length > 10) throw new Unsupported(`too many filters (${conds.length} > 10)`);
  const kind = classifyLogic(logic, conds.length);
  if (kind === 'advanced') throw new Unsupported(`filter logic '${logic}' is not representable`);
  return { filters: conds.map((c) => condToFilter(c, fieldRes, ctx)), logic: kind };
}

/* ── Identifier helpers ──────────────────────────────────────────────────── */

/** Northbeam flow var names: /^[a-z][a-zA-Z0-9_]{0,39}$/. */
function makeVarName(sfName: string, used: Set<string>): string {
  let base = sfName.replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+/, '');
  if (!/^[a-z]/.test(base)) base = `v${base}`;
  base = (base.charAt(0).toLowerCase() + base.slice(1)).slice(0, 36) || 'v';
  let name = base;
  for (let n = 2; used.has(name); n++) name = `${base}${n}`;
  used.add(name);
  return name;
}

function makeOutcomeId(
  sfName: string | null | undefined,
  index: number,
  used: Set<string>,
): string {
  let base = sfToKey(sfName || `outcome_${index + 1}`).slice(0, 28);
  if (!/^[a-z]/.test(base)) base = `o_${base}`.slice(0, 28);
  if (base === 'default') base = 'o_default';
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}_${n}`;
  used.add(id);
  return id;
}

/* ── Graph assembly ──────────────────────────────────────────────────────── */

type Pending = { sourceId: string; sourceHandle?: string; targetName: string };

class GraphAssembler {
  readonly nodes: FlowNode[] = [];
  private readonly pendings: Pending[] = [];
  private readonly ids = new Set<string>();
  private readonly idByName = new Map<string, string>();

  /** Register an element's entry node id under its SF element name so
   *  connectors targeting that name resolve to it. */
  register(elementName: string): string {
    const id = this.fresh(elementName);
    this.idByName.set(elementName, id);
    return id;
  }

  /** An id for a synthesized chain node (e.g. the assign_owner split). */
  fresh(base: string): string {
    const stem = base.slice(0, 58) || 'node';
    let id = stem;
    for (let n = 2; this.ids.has(id); n++) id = `${stem}_${n}`;
    this.ids.add(id);
    return id;
  }

  add(node: FlowNode): void {
    this.nodes.push(node);
  }

  connect(
    sourceId: string,
    connector: FlowConnector | null | undefined,
    sourceHandle?: string,
  ): void {
    const target = connector?.targetReference;
    if (!target) return;
    this.pendings.push({
      sourceId,
      targetName: String(target),
      ...(sourceHandle ? { sourceHandle } : {}),
    });
  }

  /** Direct edge between two already-known node ids (chain splits). */
  chain(sourceId: string, targetId: string): void {
    this.pendings.push({ sourceId, targetName: `#${targetId}` });
  }

  edges(): FlowEdge[] {
    return this.pendings.map((p, i) => {
      const target = p.targetName.startsWith('#')
        ? p.targetName.slice(1)
        : this.idByName.get(p.targetName);
      if (!target) {
        throw new Unsupported(`connector targets unknown element '${p.targetName}'`);
      }
      return {
        id: `e${i + 1}`,
        source: p.sourceId,
        target,
        ...(p.sourceHandle ? { sourceHandle: p.sourceHandle } : {}),
      };
    });
  }
}

function noteFault(
  ctx: Ctx,
  elementName: string,
  faultConnector: FlowConnector | null | undefined,
): void {
  if (faultConnector?.targetReference) {
    ctx.notes.push(
      `fault path on '${elementName}' dropped — Northbeam fails the run on error instead of branching`,
    );
  }
}

function nodeName(label: string | null | undefined): { name?: string } {
  const trimmed = label?.trim();
  return trimmed ? { name: trimmed.slice(0, 80) } : {};
}

/* ── Flow translation ────────────────────────────────────────────────────── */

const RECORD_TRIGGER_EVENTS: Record<string, FlowNodeOfType<'trigger_record'>['config']['event']> = {
  Create: 'created',
  Update: 'updated',
  CreateAndUpdate: 'created_or_updated',
  Delete: 'deleted',
};

/** Element kinds we can never translate — presence of any makes the whole
 *  flow a reference (never a silently-smaller automation). */
const UNSUPPORTED_ELEMENT_ARRAYS = [
  'screens',
  'subflows',
  'apexPluginCalls',
  'transforms',
  'orchestratedStages',
  'collectionProcessors',
  'customErrors',
  'steps',
  'waits', // waitEvents shape unverified — SF scheduled paths are the supported wait form
] as const;

export function translateFlow(
  record: FlowVersionRecord,
  resolutions: Map<string, ObjectResolution>,
  importedSfObjects: Set<string>,
): TranslatedAutomation {
  const m = record.Metadata;
  const apiName = record.FullName.replace(/-\d+$/, '');
  const name = m.label?.trim() || apiName;
  const activeInSf = (m.status ?? '') === 'Active';
  const description = m.description?.trim() || undefined;

  const reference = (
    sfType: FlowReferenceMeta['sfType'],
    reason: string,
    sfObject?: string,
  ): TranslatedAutomation => ({
    ok: false,
    sfId: record.Id,
    apiName,
    key: flowKeyFrom(apiName),
    name,
    sfType,
    ...(sfObject ? { sfObject } : {}),
    ...(description ? { description } : {}),
    activeInSf,
    reason,
  });

  // Routing gates — anything outside "record-triggered autolaunched flow on an
  // imported object" is a reference.
  const processType = m.processType ?? '';
  if (
    processType === 'Workflow' ||
    processType === 'CustomEvent' ||
    processType === 'InvocableProcess'
  ) {
    return reference(
      'process-builder',
      `Process Builder (${processType}) is retired in Salesforce — rebuild as a native flow`,
    );
  }
  if (processType !== 'AutoLaunchedFlow') {
    return reference('flow', `process type '${processType || '?'}' is not auto-translatable`);
  }
  if (!m.start) {
    return reference(
      'flow',
      m.startElementReference
        ? 'pre-v49 flow (startElementReference) — no trigger metadata to translate'
        : 'flow has no start element',
    );
  }
  const start = m.start;
  const triggerType = start.triggerType ?? '';
  if (triggerType === 'PlatformEvent') {
    return reference('flow', 'platform-event-triggered flows are not translatable');
  }
  if (triggerType === 'Scheduled' || start.schedule) {
    return reference(
      'flow',
      'scheduled flows are not auto-translated — rebuild on a scheduled trigger',
    );
  }
  const event = RECORD_TRIGGER_EVENTS[start.recordTriggerType ?? ''];
  if (
    !event ||
    !['RecordBeforeSave', 'RecordAfterSave', 'RecordBeforeDelete', 'RecordAfterDelete'].includes(
      triggerType,
    )
  ) {
    return reference(
      'flow',
      `trigger '${triggerType || 'none'}/${start.recordTriggerType ?? 'none'}' is not a record trigger`,
    );
  }
  if (!start.object) return reference('flow', 'record trigger has no object');
  // resolutionForSfObject already normalizes casing/suffix differences between
  // flow metadata and API names — don't re-check exact set membership here (it
  // defeats the fuzzy match; the other call sites rely on `!res` alone).
  const res = resolutionForSfObject(resolutions, start.object);
  if (!res) {
    return reference('flow', `object '${start.object}' was not part of this import`, start.object);
  }

  for (const kind of UNSUPPORTED_ELEMENT_ARRAYS) {
    const arr = m[kind];
    if (Array.isArray(arr) && arr.length > 0) {
      return reference('flow', `contains ${kind} — not auto-translatable`, start.object);
    }
  }

  const ctx: Ctx = {
    res,
    formulas: new Map(
      (m.formulas ?? []).flatMap((f) =>
        f.name && f.expression ? [[f.name, f.expression] as const] : [],
      ),
    ),
    constants: new Map(),
    varTemplates: new Map(),
    recordVars: new Map(),
    collectionVars: new Map(),
    loopVars: new Map(),
    usedVarNames: new Set(),
    notes: [],
  };
  for (const c of m.constants ?? []) {
    if (!c.name) continue;
    const v = valueToFlowValue(c.value, ctx);
    if (v.ok) ctx.constants.set(c.name, v.value);
  }

  try {
    // Pass 0 — variable registry: lookups/creates produce vars, loops read them.
    for (const lk of m.recordLookups ?? []) {
      if (!lk.name || !lk.object) continue;
      const objRes = resolutionForSfObject(resolutions, lk.object);
      if (!objRes) continue; // pass 1 fails the flow with a clear reason
      const sfVar = lk.storeOutputAutomatically ? lk.name : (lk.outputReference ?? lk.name);
      const nbName = makeVarName(sfVar, ctx.usedVarNames);
      const entry = { nbName, res: objRes };
      if (lk.getFirstRecordOnly) ctx.recordVars.set(sfVar, entry);
      else ctx.collectionVars.set(sfVar, entry);
      ctx.varTemplates.set(sfVar, `vars.${nbName}`);
    }
    for (const cr of m.recordCreates ?? []) {
      if (!cr.name || !cr.object) continue;
      const objRes = resolutionForSfObject(resolutions, cr.object);
      if (!objRes) continue;
      if (cr.storeOutputAutomatically) {
        const nbName = makeVarName(cr.name, ctx.usedVarNames);
        ctx.recordVars.set(cr.name, { nbName, res: objRes });
        ctx.varTemplates.set(cr.name, `vars.${nbName}`);
      } else if (cr.assignRecordIdToReference) {
        // SF stores just the created id in a variable; we store the record and
        // point id-references at `.id`.
        const nbName = makeVarName(cr.name, ctx.usedVarNames);
        ctx.recordVars.set(cr.name, { nbName, res: objRes });
        ctx.varTemplates.set(String(cr.assignRecordIdToReference), `vars.${nbName}.id`);
      }
    }
    for (const lp of m.loops ?? []) {
      if (!lp.name || !lp.collectionReference) continue;
      const coll = ctx.collectionVars.get(lp.collectionReference);
      if (coll) ctx.loopVars.set(lp.name, coll.res);
    }

    const g = new GraphAssembler();

    // Trigger node.
    const entryConds: RawCond[] = (start.filters ?? []).map((f) => ({
      leftRef: f.field ?? '',
      operator: f.operator ?? 'EqualTo',
      value: f.value,
    }));
    let entryCondition: FlowCondition | undefined;
    if (start.filterFormula) {
      const t = transpileFlowFormula(start.filterFormula, res, ctx.formulas);
      if (!t.ok) throw new Unsupported(`entry filter formula: ${t.reason}`);
      entryCondition = { mode: 'formula', formula: t.formula };
    } else if (entryConds.length > 0) {
      entryCondition = flowCondition(entryConds, start.filterLogic, ctx);
    }
    let watchedFieldKeys: string[] | undefined;
    if (start.doesRequireRecordChangedToMeetCriteria && entryCondition?.mode === 'filters') {
      watchedFieldKeys = [...new Set(entryCondition.filters.map((f) => f.fieldKey))];
      ctx.notes.push(
        "SF 'only when a record is changed to meet the conditions' approximated with watched fields",
      );
    } else if (start.doesRequireRecordChangedToMeetCriteria) {
      throw new Unsupported(
        "'changed to meet the conditions' with a formula entry filter is not representable",
      );
    }
    if (triggerType === 'RecordBeforeSave') {
      ctx.notes.push(
        'before-save flow imported as an after-save automation (writes become an update step)',
      );
    }

    const trigger: FlowTrigger = {
      id: 'trigger',
      type: 'trigger_record',
      config: {
        event,
        ...(watchedFieldKeys?.length ? { watchedFieldKeys } : {}),
        ...(entryCondition ? { entryCondition } : {}),
      },
    };
    g.add(trigger);

    // Trigger exit: an immediate connector, or exactly one scheduled path.
    const scheduledPaths = start.scheduledPaths ?? [];
    if (start.connector?.targetReference && scheduledPaths.length > 0) {
      throw new Unsupported('flow has both an immediate path and scheduled paths');
    }
    if (scheduledPaths.length > 1) {
      throw new Unsupported(
        `flow has ${scheduledPaths.length} scheduled paths — only one path is representable`,
      );
    }
    const scheduledPath = scheduledPaths[0];
    if (scheduledPath) {
      const waitId = g.register(scheduledPath.name || 'scheduled_path');
      g.add(buildScheduledWait(waitId, scheduledPath, ctx));
      g.chain('trigger', waitId);
      g.connect(waitId, scheduledPath.connector);
    } else {
      g.connect('trigger', start.connector);
    }

    translateElements(m, g, ctx, resolutions);

    const graph: FlowGraph = { nodes: g.nodes, edges: g.edges() };
    const guarded = guardGraph(graph, ctx.notes);
    if (!guarded.ok) return reference('flow', guarded.reason, start.object);

    return {
      ok: true,
      sfId: record.Id,
      apiName,
      key: flowKeyFrom(apiName),
      name,
      description: description ?? null,
      sfObject: start.object,
      targetObjectKey: res.targetKey,
      trigger,
      graph: guarded.graph,
      status: activeInSf ? 'paused' : 'draft',
      activeInSf,
      notes: ctx.notes,
    };
  } catch (err) {
    if (err instanceof Unsupported) return reference('flow', err.message, start.object);
    throw err;
  }
}

const WAIT_UNITS: Record<string, 'minutes' | 'hours' | 'days'> = {
  Minutes: 'minutes',
  Hours: 'hours',
  Days: 'days',
};

/** Scheduled path → wait node. Shape is doc-derived (UNVERIFIED — zero
 *  scheduled paths in the fixture org), so every field is checked. */
function buildScheduledWait(
  id: string,
  path: { [key: string]: unknown },
  ctx: Ctx,
): FlowNodeOfType<'wait'> {
  const offsetNumber = path.offsetNumber;
  const offset = typeof offsetNumber === 'number' ? offsetNumber : Number(offsetNumber);
  const unit = WAIT_UNITS[String(path.offsetUnit ?? '')];
  if (!Number.isInteger(offset) || !unit) {
    throw new Unsupported(
      `scheduled path offset '${String(path.offsetNumber)} ${String(path.offsetUnit)}' is not representable`,
    );
  }
  const label = typeof path.label === 'string' ? path.label : null;
  const timeSource = String(
    path.timeSource ?? (path.recordField ? 'RecordField' : 'RecordTriggerEvent'),
  );
  if (timeSource === 'RecordField' || path.recordField) {
    const field = resolveDataField(ctx.res, String(path.recordField ?? ''));
    if (!field) {
      throw new Unsupported(`scheduled path field '${String(path.recordField)}' was not imported`);
    }
    return {
      id,
      ...nodeName(label),
      type: 'wait',
      config: { kind: 'relative_to_field', fieldKey: field.key, offset, unit },
    };
  }
  if (offset < 1) {
    throw new Unsupported('scheduled path before the trigger event is not representable');
  }
  return {
    id,
    ...nodeName(label),
    type: 'wait',
    config: { kind: 'duration', amount: offset, unit },
  };
}

/** Translate every element array into nodes + pending edges. Throws
 *  Unsupported on anything that cannot be represented with full fidelity. */
function translateElements(
  m: FlowMetadata,
  g: GraphAssembler,
  ctx: Ctx,
  resolutions: Map<string, ObjectResolution>,
): void {
  for (const el of m.assignments ?? []) {
    if (!el.name) throw new Unsupported('assignment element has no name');
    const id = g.register(el.name);
    const items = el.assignmentItems ?? [];
    if (items.length === 0) throw new Unsupported(`assignment '${el.name}' has no items`);
    const assignments = items.map((item) => {
      const target = String(item.assignToReference ?? '');
      const match = /^\$Record\.([^.]+)$/.exec(target);
      if (!match || (item.operator ?? 'Assign') !== 'Assign') {
        // Add/Subtract math and variable targets change state we can't mirror.
        throw new Unsupported(
          `assignment '${el.name}' uses '${item.operator ?? '?'}' on '${target}' — only Assign onto $Record fields translates`,
        );
      }
      const field = resolveDataField(ctx.res, match[1] as string);
      if (!field) throw new Unsupported(`assignment field '${target}' was not imported`);
      const value = valueToFlowValue(item.value, ctx);
      if (!value.ok) throw new Unsupported(`assignment value on '${target}': ${value.reason}`);
      return { target: { scope: 'record' as const, fieldKey: field.key }, value: value.value };
    });
    g.add({ id, ...nodeName(el.label), type: 'assignment', config: { assignments } });
    g.connect(id, el.connector);
  }

  for (const el of m.decisions ?? []) {
    if (!el.name) throw new Unsupported('decision element has no name');
    const id = g.register(el.name);
    const rules = el.rules ?? [];
    if (rules.length === 0) throw new Unsupported(`decision '${el.name}' has no outcomes`);
    const usedOutcomeIds = new Set<string>();
    const outcomes = rules.map((rule, i) => {
      if (rule.doesRequireRecordChangedToMeetCriteria) {
        throw new Unsupported(
          `decision outcome '${rule.label ?? rule.name ?? i}' requires 'changed to meet criteria' — not representable`,
        );
      }
      if (!rule.connector?.targetReference) {
        throw new Unsupported(
          `decision outcome '${rule.label ?? rule.name ?? i}' has no connector — dead-end outcomes are not representable`,
        );
      }
      const conds: RawCond[] = (rule.conditions ?? []).map((c) => ({
        leftRef: String(c.leftValueReference ?? ''),
        operator: String(c.operator ?? ''),
        value: c.rightValue,
      }));
      const outcomeId = makeOutcomeId(rule.name, i, usedOutcomeIds);
      const label = (rule.label?.trim() || rule.name || outcomeId).slice(0, 60);
      g.connect(id, rule.connector, outcomeId);
      return { id: outcomeId, label, condition: flowCondition(conds, rule.conditionLogic, ctx) };
    });
    g.add({ id, ...nodeName(el.label), type: 'decision', config: { outcomes } });
    g.connect(id, el.defaultConnector, 'default');
  }

  for (const el of m.recordLookups ?? []) {
    if (!el.name) throw new Unsupported('record lookup element has no name');
    const id = g.register(el.name);
    if (!el.object) throw new Unsupported(`lookup '${el.name}' has no object`);
    const objRes = resolutionForSfObject(resolutions, el.object);
    if (!objRes) throw new Unsupported(`lookup object '${el.object}' was not part of this import`);
    const { filters, logic } = queryFilters(el.filters, el.filterLogic, objRes, ctx);
    const sfVar = el.storeOutputAutomatically ? el.name : (el.outputReference ?? el.name);
    const tracked = ctx.recordVars.get(sfVar) ?? ctx.collectionVars.get(sfVar);
    const assignTo = tracked?.nbName ?? makeVarName(sfVar, ctx.usedVarNames);
    const single = el.getFirstRecordOnly === true;
    if (!single) {
      ctx.notes.push(
        `lookup '${el.name}' is unbounded in SF — capped at ${FLOW_LIMITS.maxGetRecords} records`,
      );
    }
    let sort: { fieldKey: string; direction: 'asc' | 'desc' } | undefined;
    if (el.sortField) {
      const field = resolveDataField(objRes, el.sortField);
      if (!field) throw new Unsupported(`lookup sort field '${el.sortField}' was not imported`);
      sort = {
        fieldKey: field.key,
        direction: (el.sortOrder ?? '').toLowerCase() === 'desc' ? 'desc' : 'asc',
      };
    }
    g.add({
      id,
      ...nodeName(el.label),
      type: 'get_records',
      config: {
        objectKey: objRes.targetKey,
        ...(filters.length ? { filters, logic } : {}),
        ...(sort ? { sort } : {}),
        limit: single ? 1 : FLOW_LIMITS.maxGetRecords,
        assignTo,
      },
    });
    noteFault(ctx, el.name, el.faultConnector);
    g.connect(id, el.connector);
  }

  for (const el of m.loops ?? []) {
    if (!el.name) throw new Unsupported('loop element has no name');
    const id = g.register(el.name);
    const coll = el.collectionReference
      ? ctx.collectionVars.get(el.collectionReference)
      : undefined;
    if (!coll) {
      throw new Unsupported(
        `loop '${el.name}' iterates '${el.collectionReference ?? '?'}' — not a translated record collection`,
      );
    }
    if (!el.nextValueConnector?.targetReference) {
      throw new Unsupported(`loop '${el.name}' has an empty body`);
    }
    if (!el.noMoreValuesConnector?.targetReference) {
      throw new Unsupported(`loop '${el.name}' has no after-last path — not representable`);
    }
    g.add({ id, ...nodeName(el.label), type: 'loop', config: { sourceVar: coll.nbName } });
    g.connect(id, el.nextValueConnector, 'body');
    g.connect(id, el.noMoreValuesConnector, 'done');
  }

  for (const el of m.recordUpdates ?? []) {
    if (!el.name) throw new Unsupported('record update element has no name');
    const entryId = g.register(el.name);
    const { target, fieldRes } = updateTarget(el, ctx, resolutions);
    const { fields, owner } = inputFields(el.inputAssignments, el.name, fieldRes, ctx);

    const chain: FlowNode[] = [];
    if (Object.keys(fields).length > 0) {
      chain.push({
        id: entryId,
        ...nodeName(el.label),
        type: 'update_records',
        config: { target, fields },
      });
    }
    if (owner) {
      if (target.kind === 'query') {
        // assign_owner takes a record target, not a query.
        ctx.notes.push(
          `owner assignment on '${el.name}' dropped — bulk owner changes need manual review`,
        );
      } else {
        const ownerId = chain.length === 0 ? entryId : g.fresh(`${el.name}_owner`);
        chain.push({
          id: ownerId,
          type: 'assign_owner',
          config: { target, owner: { kind: 'template', value: owner } },
        });
      }
    }
    if (chain.length === 0) {
      throw new Unsupported(`update '${el.name}' — no field survived translation`);
    }
    for (const [i, node] of chain.entries()) {
      g.add(node);
      const next = chain[i + 1];
      if (next) g.chain(node.id, next.id);
    }
    noteFault(ctx, el.name, el.faultConnector);
    g.connect((chain[chain.length - 1] as FlowNode).id, el.connector);
  }

  for (const el of m.recordCreates ?? []) {
    if (!el.name) throw new Unsupported('record create element has no name');
    const id = g.register(el.name);
    if (!el.object) throw new Unsupported(`create '${el.name}' has no object`);
    if (el.inputReference) {
      throw new Unsupported(`create '${el.name}' inserts from a variable — not representable`);
    }
    const objRes = resolutionForSfObject(resolutions, el.object);
    if (!objRes) throw new Unsupported(`create object '${el.object}' was not part of this import`);
    const { fields, owner } = inputFields(el.inputAssignments, el.name, objRes, ctx);
    if (owner) {
      ctx.notes.push(
        `owner assignment on create '${el.name}' dropped — set an assign-owner step manually`,
      );
    }
    if (Object.keys(fields).length === 0) {
      throw new Unsupported(`create '${el.name}' — no field survived translation`);
    }
    const tracked = ctx.recordVars.get(el.name);
    g.add({
      id,
      ...nodeName(el.label),
      type: 'create_record',
      config: {
        objectKey: objRes.targetKey,
        fields,
        ...(tracked ? { assignTo: tracked.nbName } : {}),
      },
    });
    noteFault(ctx, el.name, el.faultConnector);
    g.connect(id, el.connector);
  }

  for (const el of m.recordDeletes ?? []) {
    if (!el.name) throw new Unsupported('record delete element has no name');
    const id = g.register(el.name);
    const target = recordTarget(el.inputReference, ctx);
    if (!target) {
      throw new Unsupported(
        `delete '${el.name}' targets '${el.inputReference ?? 'a filter query'}' — only the trigger record, a loop item, or a stored record translates`,
      );
    }
    g.add({ id, ...nodeName(el.label), type: 'delete_record', config: { target } });
    noteFault(ctx, el.name, el.faultConnector);
    g.connect(id, el.connector);
  }

  for (const el of m.actionCalls ?? []) {
    if (!el.name) throw new Unsupported('action element has no name');
    const id = g.register(el.name);
    g.add(actionNode(id, el, ctx));
    noteFault(ctx, el.name, el.faultConnector);
    g.connect(id, el.connector);
  }
}

type UpdateTarget = FlowNodeOfType<'update_records'>['config']['target'];
type RecordTarget = FlowNodeOfType<'delete_record'>['config']['target'];

function recordTarget(inputReference: string | null | undefined, ctx: Ctx): RecordTarget | null {
  if (!inputReference) return null;
  if (inputReference === '$Record') return { kind: 'trigger_record' };
  if (ctx.loopVars.has(inputReference)) return { kind: 'loop_item' };
  const rv = ctx.recordVars.get(inputReference);
  if (rv) return { kind: 'var', name: rv.nbName };
  return null;
}

function updateTarget(
  el: {
    name?: string | null;
    inputReference?: string | null;
    object?: string | null;
    filters?: FlowRecordFilterItem[] | null;
    filterLogic?: string | null;
  },
  ctx: Ctx,
  resolutions: Map<string, ObjectResolution>,
): { target: UpdateTarget; fieldRes: ObjectResolution } {
  const direct = recordTarget(el.inputReference, ctx);
  if (direct) {
    const fieldRes =
      direct.kind === 'loop_item'
        ? (ctx.loopVars.get(el.inputReference as string) as ObjectResolution)
        : direct.kind === 'var'
          ? (ctx.recordVars.get(el.inputReference as string)?.res as ObjectResolution)
          : ctx.res;
    return { target: direct, fieldRes };
  }
  if (el.inputReference) {
    throw new Unsupported(
      `update '${el.name}' targets '${el.inputReference}' — not a translated record`,
    );
  }
  if (!el.object) throw new Unsupported(`update '${el.name}' has no target`);
  const objRes = resolutionForSfObject(resolutions, el.object);
  if (!objRes) throw new Unsupported(`update object '${el.object}' was not part of this import`);
  const { filters, logic } = queryFilters(el.filters, el.filterLogic, objRes, ctx);
  if (filters.length === 0) {
    throw new Unsupported(
      `update '${el.name}' has no filters — unbounded bulk updates are not representable`,
    );
  }
  ctx.notes.push(
    `bulk update '${el.name}' bounded to ${FLOW_LIMITS.maxGetRecords} records per run`,
  );
  return {
    target: {
      kind: 'query',
      objectKey: objRes.targetKey,
      filters,
      logic,
      limit: FLOW_LIMITS.maxGetRecords,
    },
    fieldRes: objRes,
  };
}

const SF_ID_RE = /^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/;

/** inputAssignments → field/value map with the sanctioned per-field degrade:
 *  a cross-object or formula-valued field drops WITH a note; OwnerId is split
 *  out for an assign_owner step (SF user-id literals are meaningless here and
 *  degrade too). */
function inputFields(
  assignments: Array<{ field?: string | null; value?: FlowElementValue | null }> | null | undefined,
  elementName: string,
  fieldRes: ObjectResolution,
  ctx: Ctx,
): { fields: Record<string, FlowValue>; owner: string | null } {
  const fields: Record<string, FlowValue> = {};
  let owner: string | null = null;
  for (const a of assignments ?? []) {
    const sfField = a.field ?? '';
    const value = valueToFlowValue(a.value, ctx);
    if (!value.ok) {
      ctx.notes.push(`field '${sfField}' on '${elementName}' dropped — ${value.reason}`);
      continue;
    }
    if (normalizeToken(sfField) === 'ownerid') {
      if (typeof value.value === 'string' && !SF_ID_RE.test(value.value)) {
        owner = value.value;
      } else {
        ctx.notes.push(
          `field 'OwnerId' on '${elementName}' dropped — Salesforce user ids do not map to workspace members`,
        );
      }
      continue;
    }
    const field = resolveDataField(fieldRes, sfField);
    if (!field) {
      ctx.notes.push(`field '${sfField}' on '${elementName}' dropped — not imported`);
      continue;
    }
    fields[field.key] = value.value;
  }
  if (Object.keys(fields).length > 50) {
    throw new Unsupported(`'${elementName}' writes ${Object.keys(fields).length} fields (max 50)`);
  }
  return { fields, owner };
}

/* ── actionCalls (all actionType literals doc-derived — UNVERIFIED) ───────── */

function actionParam(el: FlowActionCallElement, name: string): FlowElementValue | null | undefined {
  const lower = name.toLowerCase();
  return el.inputParameters?.find((p) => (p.name ?? '').toLowerCase() === lower)?.value;
}

function requireString(result: ValueResult, what: string): string {
  if (!result.ok) throw new Unsupported(`${what}: ${result.reason}`);
  if (typeof result.value !== 'string' || result.value.length === 0) {
    throw new Unsupported(`${what} is missing`);
  }
  return result.value;
}

function actionNode(id: string, el: FlowActionCallElement, ctx: Ctx): FlowNode {
  const actionType = el.actionType ?? '';
  const label = nodeName(el.label);

  if (actionType === 'emailSimple') {
    if (actionParam(el, 'emailAddressesArray') != null) {
      throw new Unsupported(`email '${el.name}' uses an address collection — not representable`);
    }
    const addresses = requireString(
      valueToFlowValue(actionParam(el, 'emailAddresses'), ctx),
      `email '${el.name}' recipient list`,
    );
    const to = addresses
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 10);
    if (to.length === 0) throw new Unsupported(`email '${el.name}' has no recipients`);
    const subject = requireString(
      valueToFlowValue(actionParam(el, 'emailSubject'), ctx),
      `email '${el.name}' subject`,
    ).slice(0, 200);
    const body = requireString(
      valueToFlowValue(actionParam(el, 'emailBody') ?? actionParam(el, 'emailPlainTextBody'), ctx),
      `email '${el.name}' body`,
    ).slice(0, 10_000);
    return { id, ...label, type: 'send_email', config: { to, subject, body } };
  }

  if (actionType === 'emailAlert') {
    // Recipients + template live on the WorkflowAlert record, which this pure
    // translator can't fetch — a placeholder email would be a lie.
    throw new Unsupported(
      `email alert '${el.actionName ?? el.name}' — recipients and template live outside the flow`,
    );
  }

  if (actionType === 'chatterPost') {
    const subjectRef =
      actionParam(el, 'subjectNameOrId')?.elementReference ??
      actionParam(el, 'subjectNameOrId')?.stringValue;
    const onTrigger = subjectRef === '$Record.Id' || subjectRef === '$Record';
    if (!onTrigger) {
      throw new Unsupported(
        `chatter post '${el.name}' targets '${String(subjectRef ?? '?')}' — only the trigger record translates`,
      );
    }
    const body = requireString(
      valueToFlowValue(actionParam(el, 'text'), ctx),
      `chatter post '${el.name}' text`,
    ).slice(0, 4000);
    return {
      id,
      ...label,
      type: 'post_timeline',
      config: { target: { kind: 'trigger_record' }, body },
    };
  }

  if (actionType === 'customNotificationAction') {
    const title = requireString(
      valueToFlowValue(actionParam(el, 'title'), ctx),
      `notification '${el.name}' title`,
    ).slice(0, 140);
    const bodyResult = valueToFlowValue(actionParam(el, 'body'), ctx);
    const body =
      bodyResult.ok && typeof bodyResult.value === 'string' ? bodyResult.value : undefined;
    ctx.notes.push(
      `notification '${el.name}' recipients could not be mapped — defaulted to the record owner; review before activating`,
    );
    return {
      id,
      ...label,
      type: 'notify',
      config: {
        recipients: [{ kind: 'record_owner' }],
        title,
        ...(body ? { body: body.slice(0, 1000) } : {}),
      },
    };
  }

  throw new Unsupported(
    `action '${actionType || '?'}' (${el.actionName ?? el.name}) is not auto-translatable`,
  );
}

/* ── Final graph guard (own-bug + fidelity gate) ─────────────────────────── */

function guardGraph(
  graph: FlowGraph,
  notes: string[],
): { ok: true; graph: FlowGraph } | { ok: false; reason: string } {
  const parsed = FlowGraphSchema.safeParse(graph);
  if (!parsed.success) {
    return {
      ok: false,
      reason: `translated graph failed validation: ${parsed.error.issues[0]?.message ?? 'malformed'}`,
    };
  }
  const validated = validateFlowGraph(parsed.data);
  if (!validated.ok) {
    const first = validated.issues.find((i) => i.severity === 'error');
    return {
      ok: false,
      reason: `translated graph failed validation: ${first?.message ?? 'invalid'}`,
    };
  }
  for (const issue of validated.issues) {
    if (issue.severity === 'warning') notes.push(`graph warning: ${issue.message}`);
  }
  return { ok: true, graph: parsed.data };
}

/* ── Workflow Rules ──────────────────────────────────────────────────────── */

/** Resolved action metadata, keyed by DeveloperName (the unqualified name the
 *  rule's actions[] use). The caller does the name→id→Metadata join —
 *  Tooling restricts Metadata fetches to single rows. */
export type WorkflowActionBundle = {
  fieldUpdates: Map<string, WorkflowFieldUpdateMetadata>;
  alerts: Map<string, WorkflowAlertMetadata>;
  tasks: Map<string, WorkflowTaskMetadata>;
};

export function emptyWorkflowActionBundle(): WorkflowActionBundle {
  return { fieldUpdates: new Map(), alerts: new Map(), tasks: new Map() };
}

const WF_TRIGGER_EVENTS: Record<string, FlowNodeOfType<'trigger_record'>['config']['event']> = {
  onCreateOnly: 'created',
  onAllChanges: 'created_or_updated',
  onCreateOrTriggeringUpdate: 'created_or_updated',
};

/** Metadata API criteria vocab (distinct from the flow condition vocab).
 *  Missing entries make the whole rule a reference — a dropped criterion
 *  would fire the automation more often than Salesforce did. */
const WF_CRITERIA_OPS: Record<string, FlowFilterOp> = {
  equals: 'eq',
  notEqual: 'neq',
  lessThan: 'lt',
  greaterThan: 'gt',
  lessOrEqual: 'lte',
  greaterOrEqual: 'gte',
  contains: 'contains',
  startsWith: 'startsWith',
};

export function translateWorkflowRule(
  rule: ToolingMetadataRecord<WorkflowRuleMetadata>,
  sfObject: string,
  resolutions: Map<string, ObjectResolution>,
  actions: WorkflowActionBundle,
): TranslatedAutomation {
  const m = rule.Metadata;
  const apiName = rule.FullName;
  const devName = apiName.split('.').pop() ?? apiName;
  const name = devName.replace(/_/g, ' ');
  const activeInSf = m.active === true;
  const description = m.description?.trim() || undefined;
  const key = flowKeyFrom(apiName, 'wfr_');

  const reference = (reason: string): TranslatedAutomation => ({
    ok: false,
    sfId: rule.Id,
    apiName,
    key,
    name,
    sfType: 'workflow-rule',
    sfObject,
    ...(description ? { description } : {}),
    activeInSf,
    reason,
  });

  const res = resolutionForSfObject(resolutions, sfObject);
  if (!res) return reference(`object '${sfObject}' was not part of this import`);

  const event = WF_TRIGGER_EVENTS[m.triggerType ?? ''];
  if (!event) return reference(`trigger type '${m.triggerType ?? '?'}' is not translatable`);

  const ctx: Ctx = {
    res,
    formulas: new Map(),
    constants: new Map(),
    varTemplates: new Map(),
    recordVars: new Map(),
    collectionVars: new Map(),
    loopVars: new Map(),
    usedVarNames: new Set(),
    notes: [],
  };

  try {
    // Entry condition.
    let entryCondition: FlowCondition | undefined;
    if (m.formula) {
      const t = transpileFlowFormula(m.formula, res, undefined);
      if (!t.ok) throw new Unsupported(`criteria formula: ${t.reason}`);
      entryCondition = { mode: 'formula', formula: t.formula };
    } else if ((m.criteriaItems ?? []).length > 0) {
      entryCondition = wfCriteria(m.criteriaItems ?? [], m.booleanFilter, res);
    }

    let watchedFieldKeys: string[] | undefined;
    if (m.triggerType === 'onCreateOrTriggeringUpdate' && entryCondition?.mode === 'filters') {
      watchedFieldKeys = [...new Set(entryCondition.filters.map((f) => f.fieldKey))];
      ctx.notes.push(
        "SF 'created, and any time it's edited to subsequently meet criteria' approximated with watched fields",
      );
    } else if (m.triggerType === 'onCreateOrTriggeringUpdate' && entryCondition) {
      throw new Unsupported(
        "'edited to subsequently meet criteria' with formula criteria is not representable",
      );
    }

    const trigger: FlowTrigger = {
      id: 'trigger',
      type: 'trigger_record',
      config: {
        event,
        ...(watchedFieldKeys?.length ? { watchedFieldKeys } : {}),
        ...(entryCondition ? { entryCondition } : {}),
      },
    };

    // Actions — immediate XOR exactly one time trigger (a Northbeam trigger
    // has a single exit).
    const g = new GraphAssembler();
    g.add(trigger);
    const immediate = m.actions ?? [];
    const timeTriggers = m.workflowTimeTriggers ?? [];
    if (immediate.length > 0 && timeTriggers.length > 0) {
      throw new Unsupported(
        'rule mixes immediate and time-triggered actions — split it into two flows manually',
      );
    }
    if (timeTriggers.length > 1) {
      throw new Unsupported(
        `rule has ${timeTriggers.length} time triggers — only one path is representable`,
      );
    }

    let cursor = 'trigger';
    const tt = timeTriggers[0];
    let ruleActions = immediate;
    if (tt) {
      const waitId = g.register('time_trigger');
      g.add(wfWait(waitId, tt, ctx));
      g.chain(cursor, waitId);
      cursor = waitId;
      ruleActions = tt.actions ?? [];
    }
    if (ruleActions.length === 0) throw new Unsupported('rule has no actions');

    for (const action of ruleActions) {
      const actionName = action.name ?? '';
      const id = g.register(actionName || `action_${g.nodes.length}`);
      g.add(wfActionNode(id, String(action.type ?? ''), actionName, actions, ctx));
      g.chain(cursor, id);
      cursor = id;
    }

    const graph: FlowGraph = { nodes: g.nodes, edges: g.edges() };
    const guarded = guardGraph(graph, ctx.notes);
    if (!guarded.ok) return reference(guarded.reason);

    return {
      ok: true,
      sfId: rule.Id,
      apiName,
      key,
      name,
      description: description ?? null,
      sfObject,
      targetObjectKey: res.targetKey,
      trigger,
      graph: guarded.graph,
      status: activeInSf ? 'paused' : 'draft',
      activeInSf,
      notes: ctx.notes,
    };
  } catch (err) {
    if (err instanceof Unsupported) return reference(err.message);
    throw err;
  }
}

/** criteriaItems (plain-string values, Metadata API op vocab) → filters mode.
 *  booleanFilter must collapse to a single and/or — anything grouped is a
 *  reference (flattening would change when the rule fires). */
function wfCriteria(
  items: NonNullable<WorkflowRuleMetadata['criteriaItems']>,
  booleanFilter: string | null | undefined,
  res: ObjectResolution,
): FlowCondition {
  if (items.length > 10) throw new Unsupported(`too many criteria (${items.length} > 10)`);
  const logic = classifyLogic(booleanFilter, items.length);
  if (logic === 'advanced') {
    throw new Unsupported(`criteria logic '${booleanFilter}' is not representable`);
  }
  const filters = items.map((item) => {
    const token = item.field ?? '';
    const field = resolveDataField(res, token);
    if (!field) throw new Unsupported(`criteria field '${token}' was not imported`);
    const op = WF_CRITERIA_OPS[item.operation ?? ''];
    if (!op)
      throw new Unsupported(`criteria operation '${item.operation ?? '?'}' has no equivalent`);
    const value = item.value ?? '';
    if (value.includes(',')) {
      // Comma values are OR-ed in SF; narrowing to one would change firing.
      throw new Unsupported(`multi-value criteria on '${token}' is not representable`);
    }
    return filterFrom(field, op, value === '' ? null : value);
  });
  return { mode: 'filters', logic, filters };
}

/** workflowTimeTriggers[0] → wait node (shape doc-derived, UNVERIFIED). */
function wfWait(
  id: string,
  tt: NonNullable<WorkflowRuleMetadata['workflowTimeTriggers']>[number],
  ctx: Ctx,
): FlowNodeOfType<'wait'> {
  const amount = Number(tt.timeLength);
  const unit = WAIT_UNITS[String(tt.workflowTimeTriggerUnit ?? '')];
  if (!Number.isInteger(amount) || !unit) {
    throw new Unsupported(
      `time trigger '${String(tt.timeLength)} ${String(tt.workflowTimeTriggerUnit)}' is not representable`,
    );
  }
  if (tt.offsetFromField) {
    const token = String(tt.offsetFromField).split('.').pop() ?? '';
    const field = resolveDataField(ctx.res, token);
    if (!field) {
      throw new Unsupported(`time trigger field '${tt.offsetFromField}' was not imported`);
    }
    return {
      id,
      type: 'wait',
      config: { kind: 'relative_to_field', fieldKey: field.key, offset: amount, unit },
    };
  }
  if (amount < 1) throw new Unsupported('time trigger before rule evaluation is not representable');
  return { id, type: 'wait', config: { kind: 'duration', amount, unit } };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function wfActionNode(
  id: string,
  type: string,
  actionName: string,
  bundle: WorkflowActionBundle,
  ctx: Ctx,
): FlowNode {
  if (type === 'FieldUpdate') {
    const fu = bundle.fieldUpdates.get(actionName);
    if (!fu) throw new Unsupported(`field update '${actionName}' metadata was not retrieved`);
    const field = resolveDataField(ctx.res, fu.field ?? '');
    if (!field)
      throw new Unsupported(
        `field update '${actionName}' targets '${fu.field ?? '?'}' — not imported`,
      );
    const value = wfFieldUpdateValue(fu, actionName, ctx);
    return {
      id,
      ...nodeName(fu.name),
      type: 'update_records',
      config: { target: { kind: 'trigger_record' }, fields: { [field.key]: value } },
    };
  }
  if (type === 'Alert') {
    const alert = bundle.alerts.get(actionName);
    if (!alert) throw new Unsupported(`email alert '${actionName}' metadata was not retrieved`);
    const to = [
      ...(alert.ccEmails ?? []),
      ...(alert.recipients ?? []).map((r) => r.recipient ?? '').filter(Boolean),
    ]
      .filter((addr) => EMAIL_RE.test(addr))
      .slice(0, 10);
    if (to.length === 0) {
      throw new Unsupported(`email alert '${actionName}' has no literal recipient address`);
    }
    ctx.notes.push(
      `email alert '${actionName}' body is a placeholder — the SF email template '${alert.template ?? '?'}' was not imported; rewrite before activating`,
    );
    return {
      id,
      type: 'send_email',
      config: {
        to,
        subject: `Salesforce alert: ${actionName}`,
        body: `Imported from the Salesforce email alert '${actionName}' (template '${alert.template ?? '?'}'). The original email template was not imported — rewrite this message before activating the flow.`,
      },
    };
  }
  if (type === 'Task') {
    const task = bundle.tasks.get(actionName);
    if (!task) throw new Unsupported(`task '${actionName}' metadata was not retrieved`);
    const fields: Record<string, FlowValue> = { subject: task.subject ?? actionName };
    if (task.status) fields.status = task.status;
    if (task.priority) fields.priority = task.priority;
    if (task.dueDateOffset != null) {
      ctx.notes.push(`task '${actionName}' due-date offset dropped — set a due date manually`);
    }
    if (task.assignedTo) {
      ctx.notes.push(
        `task '${actionName}' assignee dropped — Salesforce assignees do not map to workspace members`,
      );
    }
    ctx.notes.push(
      `task '${actionName}' creates an 'activity' record — field keys are checked when the flow is activated`,
    );
    return { id, type: 'create_record', config: { objectKey: 'activity', fields } };
  }
  throw new Unsupported(
    `workflow action type '${type || '?'}' (${actionName}) is not auto-translatable`,
  );
}

function wfFieldUpdateValue(
  fu: WorkflowFieldUpdateMetadata,
  actionName: string,
  ctx: Ctx,
): FlowValue {
  const operation = fu.operation ?? '';
  if (operation === 'Literal') return fu.literalValue ?? null;
  if (operation === 'Null') return null;
  if (operation === 'Formula') {
    const t = transpileFlowFormula(fu.formula ?? '', ctx.res, undefined);
    if (!t.ok) throw new Unsupported(`field update '${actionName}' formula: ${t.reason}`);
    // Field-update values are literals/templates, not formulas — only trivial
    // transpile results (a single field ref or a constant) survive.
    const ref = /^\{(oldRecord\.)?([a-z0-9_]+)\}$/.exec(t.formula);
    if (ref) return `{{${ref[1] ? 'oldRecord' : 'record'}.${ref[2]}}}`;
    if (/^-?\d+(\.\d+)?$/.test(t.formula)) return Number(t.formula);
    if (t.formula === 'TRUE') return true;
    if (t.formula === 'FALSE') return false;
    const str = /^"(.*)"$/.exec(t.formula);
    if (str) return (str[1] as string).replace(/\\"/g, '"');
    throw new Unsupported(
      `field update '${actionName}' is a computed formula — needs the formula engine`,
    );
  }
  throw new Unsupported(`field update operation '${operation || '?'}' is not translatable`);
}
