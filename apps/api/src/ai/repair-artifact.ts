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
  type Artifact,
  ArtifactFilterSchema,
  type ArtifactNode,
  ArtifactSortSchema,
} from '@northbeam/core';
import { type FieldRow, GROUPABLE_TYPES, NUMERIC_TYPES } from '@northbeam/db';

export type ObjectFieldsByKey = Map<string, FieldRow[]>;

export type RepairResult = {
  artifact: Artifact;
  /** Human-readable notes on what was repaired/dropped — empty = untouched. */
  notes: string[];
};

const LIVE_COMPONENTS = new Set(['Metric', 'Chart', 'RecordTable', 'RecordGrid', 'RecordList']);

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
    const fn = props.fn;
    if ((fn === 'sum' || fn === 'avg') && !isNumeric(byKey.get(String(props.fieldKey)))) {
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
    if (!groupField || !GROUPABLE_TYPES.has(groupField.type)) {
      notes.push(`removed a Chart on '${objectKey}' — '${String(props.groupBy)}' isn't groupable`);
      return null;
    }
    const fn = props.fn;
    if ((fn === 'sum' || fn === 'avg') && !isNumeric(byKey.get(String(props.measure)))) {
      notes.push(`${where}: '${String(props.measure)}' isn't numeric — using count instead`);
      props.fn = 'count';
      props.measure = undefined;
    }
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
