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
  ArtifactFilterSchema,
  type ArtifactNode,
  ArtifactSortSchema,
} from '@northbeam/core';
import { DATE_GROUPABLE_TYPES, type FieldRow, GROUPABLE_TYPES, NUMERIC_TYPES } from '@northbeam/db';

export type ObjectFieldsByKey = Map<string, FieldRow[]>;

export type RepairResult = {
  artifact: Artifact;
  /** Human-readable notes on what was repaired/dropped — empty = untouched. */
  notes: string[];
};

const LIVE_COMPONENTS = new Set(['Metric', 'Chart', 'RecordTable', 'RecordGrid', 'RecordList']);
const CHART_TYPES: ReadonlySet<string> = new Set(ARTIFACT_CHART_TYPES);
const GRAINS: ReadonlySet<string> = new Set(ARTIFACT_DATE_GRAINS);

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

/** Keep only filters that parse AND reference a real field. */
function cleanFilters(props: Props, byKey: Map<string, FieldRow>, notes: string[], where: string) {
  if (!('filters' in props)) return;
  const raw = Array.isArray(props.filters) ? props.filters : [];
  const kept = raw.filter((f) => {
    const parsed = ArtifactFilterSchema.safeParse(f);
    if (!parsed.success || !byKey.has(parsed.data.fieldKey)) {
      notes.push(`${where}: dropped a filter on unknown field`);
      return false;
    }
    return true;
  });
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

/** Repair one node. Returns null when the node can't be made to query. */
function repairNode(
  node: ArtifactNode,
  objects: ObjectFieldsByKey,
  notes: string[],
): ArtifactNode | null {
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

  cleanFilters(props, byKey, notes, where);
  cleanSort(props, byKey, notes, where);
  cleanColumns(props, byKey, notes, where);

  if (node.component === 'Metric') {
    const fn = String(props.fn ?? 'count');
    if (fn !== 'count' && !isNumeric(byKey.get(String(props.fieldKey)))) {
      notes.push(`${where}: '${String(props.fieldKey)}' isn't numeric — using count instead`);
      props.fn = 'count';
      props.fieldKey = undefined;
    }
  }

  if (node.component === 'RecordList' && typeof props.secondaryField === 'string') {
    if (!byKey.has(props.secondaryField)) {
      notes.push(`${where}: dropped unknown secondary field '${props.secondaryField}'`);
      props.secondaryField = undefined;
    }
  }

  if (node.component === 'Chart') {
    const groupField = byKey.get(String(props.groupBy));
    if (!groupField || !isGroupable(groupField, 'primary')) {
      notes.push(`removed a Chart on '${objectKey}' — '${String(props.groupBy)}' isn't groupable`);
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
    let group2Field: FieldRow | undefined;
    if (props.groupBy2 !== undefined) {
      group2Field = byKey.get(String(props.groupBy2));
      if (!group2Field || !isGroupable(group2Field, 'secondary')) {
        notes.push(`${where}: dropped groupBy2 '${String(props.groupBy2)}' — not groupable`);
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
    if (fn !== 'count' && !isNumeric(byKey.get(String(props.measure)))) {
      notes.push(`${where}: '${String(props.measure)}' isn't numeric — using count instead`);
      props.fn = 'count';
      props.measure = undefined;
    }

    // chartType normalization + shape coherence (mirrors the walker's
    // coercions so what's SAVED is already clean).
    if (props.chartType !== undefined && !CHART_TYPES.has(String(props.chartType))) {
      notes.push(`${where}: unknown chartType '${String(props.chartType)}' — using bar`);
      props.chartType = 'bar';
    }
    const chartType = String(props.chartType ?? 'bar');
    const effectiveFn = String(props.fn ?? 'count');
    const nonAdditive = effectiveFn === 'avg' || effectiveFn === 'min' || effectiveFn === 'max';
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

/** Repair a whole artifact against the org's live metadata. Never throws;
 *  worst case the tree collapses to a single explanatory EmptyState. */
export function repairArtifact(artifact: Artifact, objects: ObjectFieldsByKey): RepairResult {
  const notes: string[] = [];
  const components: ArtifactNode[] = [];

  for (const node of artifact.components) {
    if (node.component === 'SectionCard') {
      const children = (node.children ?? [])
        .map((c) => repairNode(c, objects, notes))
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
    const repaired = repairNode(node, objects, notes);
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
