// Post-generation repair. The model writes query specs (objectKey, field
// keys, filters, sorts) as free-form props — this pass checks every one
// against the org's real metadata so live nodes actually run at render time
// instead of soft-failing in the walker. Same validation rules the record
// router applies (GROUPABLE_TYPES for group-bys, NUMERIC_TYPES for measures).
//
// Repair over reject: a bad filter/sort/column entry is dropped, an invalid
// measure downgrades to count, and only nodes that can't possibly query
// (unknown object, ungroupable chart) are removed. Every intervention is
// recorded so the composer can tell the user what changed.

import {
  ARTIFACT_CHART_TYPES,
  ARTIFACT_DATE_GRAINS,
  type Artifact,
  ArtifactActionSchema,
  ArtifactFilterSchema,
  type ArtifactNode,
  ArtifactRowActionSchema,
  ArtifactSortSchema,
  QuerySpecSchema,
} from '@northbeam/core';
import {
  DATE_GROUPABLE_TYPES,
  type FieldRow,
  GROUPABLE_TYPES,
  NUMERIC_TYPES,
  type ObjectRow,
  type ObjectWithFields,
  type QuerySpecLike,
  isRelativeDateToken,
  resolveQuerySpec,
  resolveRelativeDate,
} from '@northbeam/db';

export type ObjectFieldsByKey = Map<string, FieldRow[]>;

export type RepairResult = {
  artifact: Artifact;
  /** Human-readable notes on what was repaired/dropped — empty = untouched. */
  notes: string[];
};

const LIVE_COMPONENTS = new Set(['Metric', 'Chart', 'RecordTable', 'RecordGrid', 'RecordList']);
const CHART_TYPES: ReadonlySet<string> = new Set(ARTIFACT_CHART_TYPES);
const GRAINS: ReadonlySet<string> = new Set(ARTIFACT_DATE_GRAINS);
const COMPARE_PERIODS: ReadonlySet<string> = new Set(['week', 'month', 'quarter']);

/** Groupable per the engine's rules — multipicklist explodes through a
 *  LATERAL unnest and is only supported in the primary position. */
function isGroupable(field: FieldRow, position: 'primary' | 'secondary'): boolean {
  if (GROUPABLE_TYPES.has(field.type) || DATE_GROUPABLE_TYPES.has(field.type)) return true;
  return field.type === 'multipicklist' && position === 'primary';
}

type Props = Record<string, unknown>;

function fieldMap(fields: FieldRow[]): Map<string, FieldRow> {
  return new Map(fields.map((f) => [f.key, f]));
}

/** Resolve a one-hop dot key ('account.industry') to the REMOTE field, using
 *  the org-wide field map as ground truth. Null when any hop is unknown. */
function resolveDotField(
  byKey: Map<string, FieldRow>,
  objects: ObjectFieldsByKey,
  key: string,
): FieldRow | null {
  const idx = key.indexOf('.');
  if (idx <= 0 || idx !== key.lastIndexOf('.') || idx === key.length - 1) return null;
  const refField = byKey.get(key.slice(0, idx));
  if (!refField || refField.type !== 'reference') return null;
  const targetKey = (refField.config as { targetObject?: string } | null)?.targetObject;
  const targetFields = targetKey ? objects.get(targetKey) : undefined;
  if (!targetFields) return null;
  return targetFields.find((f) => f.key === key.slice(idx + 1)) ?? null;
}

/** One leaf filter: must parse, reference a real field (base key or one-hop
 *  dot path), and (when the value is a relative-date token) sit on a date
 *  field with a token in the grammar. */
function validLeafFilter(
  f: unknown,
  byKey: Map<string, FieldRow>,
  objects: ObjectFieldsByKey,
  notes: string[],
  where: string,
): boolean {
  const parsed = ArtifactFilterSchema.safeParse(f);
  if (!parsed.success) {
    notes.push(`${where}: dropped a filter on unknown field`);
    return false;
  }
  const field = parsed.data.fieldKey.includes('.')
    ? resolveDotField(byKey, objects, parsed.data.fieldKey)
    : byKey.get(parsed.data.fieldKey);
  if (!field) {
    notes.push(`${where}: dropped a filter on unknown field`);
    return false;
  }
  if (isRelativeDateToken(parsed.data.value)) {
    if (!DATE_GROUPABLE_TYPES.has(field.type)) {
      notes.push(`${where}: dropped a relative-date filter on non-date '${field.key}'`);
      return false;
    }
    if (!resolveRelativeDate(parsed.data.value)) {
      notes.push(`${where}: dropped a filter with unknown token '${parsed.data.value}'`);
      return false;
    }
  }
  return true;
}

/** Keep only filters that can run. Entries may be leaves or `{ any: [...] }`
 *  OR groups (one level) — a group keeps its surviving leaves and drops
 *  entirely when none survive. */
function cleanFilters(
  props: Props,
  byKey: Map<string, FieldRow>,
  objects: ObjectFieldsByKey,
  notes: string[],
  where: string,
) {
  if (!('filters' in props)) return;
  const raw = Array.isArray(props.filters) ? props.filters : [];
  const kept: unknown[] = [];
  for (const entry of raw) {
    const anyArr = (entry as { any?: unknown } | null)?.any;
    if (Array.isArray(anyArr)) {
      const leaves = anyArr.filter((f) => validLeafFilter(f, byKey, objects, notes, where));
      if (leaves.length > 0) kept.push({ any: leaves });
      else notes.push(`${where}: dropped an OR group with no runnable filters`);
      continue;
    }
    if (validLeafFilter(entry, byKey, objects, notes, where)) kept.push(entry);
  }
  if (kept.length > 0) props.filters = kept;
  else props.filters = undefined;
}

function cleanSort(props: Props, byKey: Map<string, FieldRow>, notes: string[], where: string) {
  if (!('sort' in props)) return;
  const raw = Array.isArray(props.sort) ? props.sort : [];
  const kept = raw.filter((s) => {
    const parsed = ArtifactSortSchema.safeParse(s);
    if (!parsed.success || !byKey.has(parsed.data.fieldKey)) {
      notes.push(`${where}: dropped a sort on unknown field`);
      return false;
    }
    return true;
  });
  if (kept.length > 0) props.sort = kept;
  else props.sort = undefined;
}

function cleanColumns(props: Props, byKey: Map<string, FieldRow>, notes: string[], where: string) {
  if (!('columns' in props)) return;
  const raw = Array.isArray(props.columns) ? props.columns : [];
  const kept = raw.filter((c) => typeof c === 'string' && byKey.has(c));
  if (kept.length < raw.length) notes.push(`${where}: dropped unknown columns`);
  if (kept.length > 0) props.columns = kept;
  else props.columns = undefined; // walker falls back to the first fields
}

function isNumeric(f: FieldRow | undefined): boolean {
  return !!f && NUMERIC_TYPES.has(f.type);
}

const AGG_FNS: ReadonlySet<string> = new Set([
  'count',
  'sum',
  'avg',
  'min',
  'max',
  'countDistinct',
  'median',
]);

/** Can `fn` run over this measure field? countDistinct takes any scalar
 *  column; the numeric aggs (incl. median's percentile ordering) need
 *  NUMERIC_TYPES — same gates as resolveReportSpec. */
function measureOk(fn: string, f: FieldRow | undefined): boolean {
  if (fn === 'countDistinct') return !!f && f.type !== 'multipicklist';
  return isNumeric(f);
}

const HAVING_OPS: ReadonlySet<string> = new Set(['gt', 'gte', 'lt', 'lte']);

/** Drop malformed `having` specs (shape-checked; the engine also ignores
 *  having without groupings, so groupBy presence isn't re-checked here). */
function cleanHaving(props: Props, notes: string[], where: string) {
  if (props.having === undefined) return;
  const h = props.having as { target?: unknown; op?: unknown; value?: unknown } | null;
  const ok =
    h !== null &&
    (h.target === 'value' || h.target === 'count') &&
    HAVING_OPS.has(String(h.op)) &&
    typeof h.value === 'number' &&
    Number.isFinite(h.value);
  if (!ok) {
    notes.push(`${where}: dropped a malformed having threshold`);
    props.having = undefined;
  }
}

/** Picklist option values for a field, when its config carries any. */
function picklistValues(field: FieldRow): string[] | null {
  const options = (field.config as { options?: { value?: unknown }[] } | null)?.options;
  if (!Array.isArray(options)) return null;
  return options.map((o) => String(o?.value ?? '')).filter((v) => v.length > 0);
}

const ROW_ACTION_FIELD_TYPES: ReadonlySet<string> = new Set(['picklist', 'checkbox', 'text']);

/** Keep `props.rowAction` only when it can actually run: known field of a
 *  settable type, and (picklist) a value that is a real option — the model
 *  must never invent picklist values. */
function cleanRowAction(props: Props, byKey: Map<string, FieldRow>, notes: string[], where: string) {
  if (props.rowAction === undefined) return;
  const parsed = ArtifactRowActionSchema.safeParse(props.rowAction);
  const field = parsed.success ? byKey.get(parsed.data.fieldKey) : undefined;
  if (!parsed.success || !field || !ROW_ACTION_FIELD_TYPES.has(field.type)) {
    notes.push(`${where}: dropped a row action on an unknown or unsupported field`);
    props.rowAction = undefined;
    return;
  }
  if (field.type === 'picklist') {
    const values = picklistValues(field);
    if (values && !values.includes(String(parsed.data.value))) {
      notes.push(
        `${where}: dropped row action — '${String(parsed.data.value)}' isn't an option on '${field.key}'`,
      );
      props.rowAction = undefined;
    }
  }
}

/** ActionBar items — each must parse against the closed action vocabulary
 *  AND reference real metadata. createRecord defaults lose unknown keys. */
function repairActionBar(
  node: ArtifactNode,
  objects: ObjectFieldsByKey,
  notes: string[],
): ArtifactNode | null {
  const props: Props = { ...(node.props ?? {}) };
  const raw = Array.isArray(props.items) ? props.items : [];
  const kept: unknown[] = [];
  for (const item of raw.slice(0, 4)) {
    const parsed = ArtifactActionSchema.safeParse(item);
    if (!parsed.success) {
      notes.push('ActionBar: dropped an action outside the vocabulary');
      continue;
    }
    const action = parsed.data;
    if (action.kind === 'openComposer') {
      kept.push(action);
      continue;
    }
    const fields = objects.get(action.objectKey);
    if (!fields) {
      notes.push(`ActionBar: dropped '${action.label}' — unknown object '${action.objectKey}'`);
      continue;
    }
    if (action.kind === 'createRecord' && action.defaults) {
      const byKey = fieldMap(fields);
      const entries = Object.entries(action.defaults).filter(([k]) => byKey.has(k));
      if (entries.length < Object.keys(action.defaults).length) {
        notes.push(`ActionBar: dropped unknown default fields on '${action.label}'`);
      }
      kept.push({
        ...action,
        defaults: entries.length > 0 ? Object.fromEntries(entries) : undefined,
      });
      continue;
    }
    kept.push(action);
  }
  if (raw.length > 4) notes.push('ActionBar: trimmed to 4 actions');
  if (kept.length === 0) {
    notes.push('removed an ActionBar with no runnable actions');
    return null;
  }
  return { ...node, props: { ...props, items: kept } } as ArtifactNode;
}

/** Repair one node. Returns null when the node can't be made to query. */
function repairNode(
  node: ArtifactNode,
  objects: ObjectFieldsByKey,
  notes: string[],
): ArtifactNode | null {
  if (node.component === 'ActionBar') return repairActionBar(node, objects, notes);
  if (!LIVE_COMPONENTS.has(node.component)) return node;

  const props: Props = { ...(node.props ?? {}) };
  const objectKey = typeof props.objectKey === 'string' ? props.objectKey : undefined;

  // A Metric without objectKey is a legitimate static tile; every other live
  // component needs a real target.
  if (!objectKey) {
    if (node.component === 'Metric') return node;
    notes.push(`removed a ${node.component} with no objectKey`);
    return null;
  }
  const fields = objects.get(objectKey);
  if (!fields) {
    notes.push(`removed a ${node.component} targeting unknown object '${objectKey}'`);
    return null;
  }
  const byKey = fieldMap(fields);
  const where = `${node.component} on '${objectKey}'`;

  cleanFilters(props, byKey, objects, notes, where);
  cleanSort(props, byKey, notes, where);
  cleanColumns(props, byKey, notes, where);
  cleanRowAction(props, byKey, notes, where);

  if (node.component === 'Metric') {
    const fn = String(props.fn ?? 'count');
    if (!AGG_FNS.has(fn)) {
      notes.push(`${where}: unknown fn '${fn}' — using count`);
      props.fn = 'count';
      props.fieldKey = undefined;
    } else if (fn !== 'count' && !measureOk(fn, byKey.get(String(props.fieldKey)))) {
      notes.push(`${where}: '${String(props.fieldKey)}' can't be ${fn}'d — using count instead`);
      props.fn = 'count';
      props.fieldKey = undefined;
    }
    // `compare` renders a REAL % change — keep it only when it can actually
    // run (date field on this object + known period). A surviving compare
    // supersedes any free-text delta: invented delta strings are fabricated
    // numbers, and the prompt forbids them.
    if (props.compare !== undefined) {
      const compare = props.compare as { dateFieldKey?: unknown; period?: unknown } | null;
      const dateField = byKey.get(String(compare?.dateFieldKey));
      const periodOk = COMPARE_PERIODS.has(String(compare?.period));
      if (!dateField || !DATE_GROUPABLE_TYPES.has(dateField.type) || !periodOk) {
        notes.push(`${where}: dropped compare — needs a date field and a known period`);
        props.compare = undefined;
      } else if (props.delta !== undefined) {
        props.delta = undefined;
      }
    }
  }

  if (node.component === 'RecordList' && typeof props.secondaryField === 'string') {
    if (!byKey.has(props.secondaryField)) {
      notes.push(`${where}: dropped unknown secondary field '${props.secondaryField}'`);
      props.secondaryField = undefined;
    }
  }

  if (node.component === 'Chart') {
    // groupBy may be a base field or a one-hop dot path — for dot paths the
    // REMOTE field's type gates groupability (remote multipicklist excluded:
    // it would need unnest inside the lateral).
    const groupKey = String(props.groupBy);
    const groupField = groupKey.includes('.')
      ? resolveDotField(byKey, objects, groupKey)
      : byKey.get(groupKey);
    const groupOk =
      groupField &&
      (groupKey.includes('.')
        ? GROUPABLE_TYPES.has(groupField.type) || DATE_GROUPABLE_TYPES.has(groupField.type)
        : isGroupable(groupField, 'primary'));
    if (!groupField || !groupOk) {
      notes.push(`removed a Chart on '${objectKey}' — '${groupKey}' isn't groupable`);
      return null;
    }

    // dateGrain rides date/datetime group-bys only; invalid values default.
    const groupIsDate = DATE_GROUPABLE_TYPES.has(groupField.type);
    if (groupIsDate) {
      if (props.dateGrain !== undefined && !GRAINS.has(String(props.dateGrain))) {
        notes.push(`${where}: unknown dateGrain '${String(props.dateGrain)}' — using month`);
        props.dateGrain = 'month';
      }
    } else if (props.dateGrain !== undefined) {
      notes.push(`${where}: dropped dateGrain — '${groupField.key}' isn't a date field`);
      props.dateGrain = undefined;
    }

    // Second grouping: must exist and be groupable (multipicklist is
    // primary-only — it explodes through a LATERAL unnest server-side).
    // Dot paths allowed with the same remote-type gates as groupBy.
    let group2Field: FieldRow | undefined | null;
    if (props.groupBy2 !== undefined) {
      const group2Key = String(props.groupBy2);
      group2Field = group2Key.includes('.')
        ? resolveDotField(byKey, objects, group2Key)
        : byKey.get(group2Key);
      const ok2 =
        group2Field &&
        (group2Key.includes('.')
          ? GROUPABLE_TYPES.has(group2Field.type) || DATE_GROUPABLE_TYPES.has(group2Field.type)
          : isGroupable(group2Field, 'secondary'));
      if (!group2Field || !ok2) {
        notes.push(`${where}: dropped groupBy2 '${group2Key}' — not groupable`);
        props.groupBy2 = undefined;
        props.groupBy2Grain = undefined;
        group2Field = undefined;
      } else if (!DATE_GROUPABLE_TYPES.has(group2Field.type)) {
        props.groupBy2Grain = undefined;
      } else if (props.groupBy2Grain !== undefined && !GRAINS.has(String(props.groupBy2Grain))) {
        props.groupBy2Grain = 'month';
      }
    }

    const fn = String(props.fn ?? 'count');
    if (!AGG_FNS.has(fn)) {
      notes.push(`${where}: unknown fn '${fn}' — using count`);
      props.fn = 'count';
      props.measure = undefined;
    } else if (fn !== 'count' && !measureOk(fn, byKey.get(String(props.measure)))) {
      notes.push(`${where}: '${String(props.measure)}' can't be ${fn}'d — using count instead`);
      props.fn = 'count';
      props.measure = undefined;
    }
    cleanHaving(props, notes, where);

    // chartType normalization + shape coherence (mirrors the walker's
    // coercions so what's SAVED is already clean).
    if (props.chartType !== undefined && !CHART_TYPES.has(String(props.chartType))) {
      notes.push(`${where}: unknown chartType '${String(props.chartType)}' — using bar`);
      props.chartType = 'bar';
    }
    const chartType = String(props.chartType ?? 'bar');
    const effectiveFn = String(props.fn ?? 'count');
    // Part-to-whole charts need additive parts — avg/min/max/median/distinct
    // counts aren't (mirrors NON_ADDITIVE_FNS in the web coercion).
    const nonAdditive = effectiveFn !== 'count' && effectiveFn !== 'sum';
    if ((chartType === 'donut' || chartType === 'funnel') && nonAdditive) {
      notes.push(`${where}: ${chartType} can't chart ${effectiveFn} — using bar`);
      props.chartType = 'bar';
    }
    if (chartType === 'scatter' && effectiveFn === 'count') {
      notes.push(`${where}: scatter needs a numeric measure — using bar`);
      props.chartType = 'bar';
    }
    if (chartType === 'matrix' && !props.groupBy2) {
      notes.push(`${where}: matrix needs groupBy2 — using table`);
      props.chartType = 'table';
    }
    const finalType = String(props.chartType ?? 'bar');
    if (props.groupBy2 && !['bar', 'line', 'area', 'matrix', 'table'].includes(finalType)) {
      notes.push(`${where}: ${finalType} can't draw a second dimension — dropped groupBy2`);
      props.groupBy2 = undefined;
      props.groupBy2Grain = undefined;
    }
    if (props.stacked && !props.groupBy2) props.stacked = undefined;
    // Time-series never fold their tail into "Other".
    if (groupIsDate && (finalType === 'line' || finalType === 'area')) props.limit = undefined;
  }

  return { ...node, props } as ArtifactNode;
}

export type RepairOptions = {
  /** 'detail' keeps the record-bound components (RecordFields / RelatedList /
   *  StagePath) and validates them against `baseObjectKey`; dashboard mode
   *  drops them — they can't render without a record context. */
  mode?: 'dashboard' | 'detail';
  baseObjectKey?: string;
};

const RECORD_CONTEXT_COMPONENTS = new Set(['RecordFields', 'RelatedList', 'StagePath']);

/** QueryBlock — the spec either fully resolves against live metadata or the
 *  node drops. No partial mutation of a query spec: a silently-narrowed
 *  query would answer a different question than the model composed. */
function repairQueryBlock(
  node: ArtifactNode,
  objects: ObjectFieldsByKey,
  notes: string[],
): ArtifactNode | null {
  const props: Props = { ...(node.props ?? {}) };
  const parsed = QuerySpecSchema.safeParse(props.query);
  if (!parsed.success) {
    notes.push('removed a QueryBlock with a malformed query spec');
    return null;
  }
  // Stub ObjectWithFields (key + fields is all resolution reads) — the
  // org-wide field map is the ground truth here, same as everywhere else.
  const stub = (key: string, fields: FieldRow[]): ObjectWithFields => ({
    object: { key } as ObjectRow,
    fields,
  });
  const baseFields = objects.get(parsed.data.objectKey);
  if (!baseFields) {
    notes.push(`removed a QueryBlock targeting unknown object '${parsed.data.objectKey}'`);
    return null;
  }
  const targets = new Map<string, ObjectWithFields>();
  for (const [key, fields] of objects) targets.set(key, stub(key, fields));
  const resolved = resolveQuerySpec(
    stub(parsed.data.objectKey, baseFields),
    targets,
    parsed.data as QuerySpecLike,
  );
  if (!resolved.ok) {
    notes.push(`removed a QueryBlock — ${resolved.message}`);
    return null;
  }
  return { ...node, props: { ...props, query: parsed.data } } as ArtifactNode;
}

/** Validate one record-context node against the base object. Null = drop. */
function repairRecordContextNode(
  node: ArtifactNode,
  objects: ObjectFieldsByKey,
  opts: RepairOptions,
  notes: string[],
): ArtifactNode | null {
  const baseFields = opts.baseObjectKey ? objects.get(opts.baseObjectKey) : undefined;
  if (opts.mode !== 'detail' || !baseFields) {
    notes.push(`removed a ${node.component} — record components need a record page`);
    return null;
  }
  const props: Props = { ...(node.props ?? {}) };
  const baseByKey = fieldMap(baseFields);

  if (node.component === 'RecordFields') {
    const raw = Array.isArray(props.fieldKeys) ? props.fieldKeys.map(String) : [];
    const kept = raw.filter((k) => baseByKey.has(k));
    if (kept.length < raw.length) notes.push('RecordFields: dropped unknown field keys');
    props.fieldKeys = kept.length > 0 ? kept : undefined; // walker falls back to all fields
    return { ...node, props } as ArtifactNode;
  }
  if (node.component === 'StagePath') {
    if (typeof props.fieldKey === 'string' && !baseByKey.has(props.fieldKey)) {
      notes.push(`StagePath: dropped unknown fieldKey '${props.fieldKey}'`);
      props.fieldKey = undefined; // walker auto-detects
    }
    return { ...node, props } as ArtifactNode;
  }
  // RelatedList: objectKey must exist and refFieldKey must be a reference on
  // it pointing back at the base object.
  const childKey = String(props.objectKey ?? '');
  const childFields = objects.get(childKey);
  const refField = childFields?.find((f) => f.key === String(props.refFieldKey));
  const pointsBack =
    refField?.type === 'reference' &&
    (refField.config as { targetObject?: string } | null)?.targetObject === opts.baseObjectKey;
  if (!childFields || !refField || !pointsBack) {
    notes.push(
      `removed a RelatedList — '${childKey}.${String(props.refFieldKey)}' doesn't reference this object`,
    );
    return null;
  }
  return { ...node, props } as ArtifactNode;
}

/** Repair a whole artifact against the org's live metadata. Never throws;
 *  worst case the tree collapses to a single explanatory EmptyState. */
export function repairArtifact(
  artifact: Artifact,
  objects: ObjectFieldsByKey,
  opts: RepairOptions = {},
): RepairResult {
  const notes: string[] = [];
  const components: ArtifactNode[] = [];

  const repairOne = (node: ArtifactNode): ArtifactNode | null => {
    if (node.component === 'QueryBlock') return repairQueryBlock(node, objects, notes);
    return RECORD_CONTEXT_COMPONENTS.has(node.component)
      ? repairRecordContextNode(node, objects, opts, notes)
      : repairNode(node, objects, notes);
  };

  for (const node of artifact.components) {
    if (node.component === 'SectionCard') {
      const children = (node.children ?? [])
        .map((c) => repairOne(c))
        .filter((c): c is NonNullable<typeof c> => c !== null);
      // A SectionCard that lost all its children (and has no title worth
      // keeping alone) is an empty box — drop it.
      if (children.length === 0 && (node.children?.length ?? 0) > 0) {
        notes.push('removed a SectionCard whose contents could not query');
        continue;
      }
      components.push({ ...node, children } as ArtifactNode);
      continue;
    }
    const repaired = repairOne(node);
    if (repaired) components.push(repaired);
  }

  if (components.length === 0) {
    components.push({
      component: 'EmptyState',
      props: {
        title: 'Nothing could be composed',
        body: 'The generated components referenced fields that do not exist. Try rephrasing.',
      },
    });
  }

  return { artifact: { version: '1', components: components.slice(0, 20) }, notes };
}
