// Dry-run Salesforce automation retrieval (Flows / Workflow Rules / Apex
// Triggers) against a real org via the sf CLI — no DB, no server.
//   pnpm --filter @northbeam/api sf:dry-run-flow                       → inventory
//   pnpm --filter @northbeam/api sf:dry-run-flow <id> [sfAlias]        → shape summary
//   pnpm --filter @northbeam/api sf:dry-run-flow <id> [sfAlias] --raw  → dump Metadata JSON
// Flow definition ids start with 300 (resolved to ActiveVersionId, falling
// back to LatestVersionId), flow version ids with 301, workflow rule ids
// with 01Q.
//
// Tooling constraint (verified live): queries selecting Metadata or FullName
// must resolve to exactly one row, so every Metadata fetch is Id-filtered —
// the same shape the SalesforceClient methods use in a real import.

import { execSync } from 'node:child_process';
import type {
  FlowDefinitionListItem,
  FlowMetadata,
  SObjectDescribe,
  ToolingMetadataRecord,
  WorkflowAlertMetadata,
  WorkflowFieldUpdateMetadata,
  WorkflowRuleMetadata,
  WorkflowTaskMetadata,
} from '@northbeam/salesforce';
import {
  type TranslatedAutomation,
  type WorkflowActionBundle,
  emptyWorkflowActionBundle,
  translateFlow,
  translateWorkflowRule,
} from '../src/salesforce/flow-mapper.js';
import { mapSObject } from '../src/salesforce/mapper.js';
import { type ObjectResolution, buildResolution } from '../src/salesforce/report-mapper.js';

const args = process.argv.slice(2).filter((a) => a !== '--raw');
const raw = process.argv.includes('--raw');
const [id, alias = 'fixture'] = args;

const sfJson = <T>(cmd: string): T =>
  JSON.parse(execSync(cmd, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })) as T;
const toolingSoql = <T>(q: string): T[] =>
  sfJson<{ result: { records: T[] } }>(
    `sf data query --use-tooling-api --query "${q}" --target-org ${alias} --json`,
  ).result.records;

const sfId = (value: string): string => {
  if (!/^[a-zA-Z0-9]{15}([a-zA-Z0-9]{3})?$/.test(value)) {
    throw new Error(`not a Salesforce id: ${value}`);
  }
  return value;
};

if (!id) {
  // Multi-row Flow queries are legal as long as Metadata/FullName are not
  // selected — this join gives labels + processType for the whole inventory.
  const versions = new Map(
    toolingSoql<{
      Id: string;
      DefinitionId: string;
      MasterLabel: string;
      ProcessType: string;
      Status: string;
      VersionNumber: number;
    }>('SELECT Id, DefinitionId, MasterLabel, ProcessType, Status, VersionNumber FROM Flow').map(
      (v) => [v.Id, v],
    ),
  );
  console.log('flow definitions:');
  for (const d of toolingSoql<FlowDefinitionListItem>(
    'SELECT Id, DeveloperName, ActiveVersionId, LatestVersionId FROM FlowDefinition ORDER BY DeveloperName',
  )) {
    const v = versions.get(d.ActiveVersionId ?? d.LatestVersionId ?? '');
    const state = d.ActiveVersionId ? 'active' : 'inactive';
    const versionNote = v ? `  (v${v.VersionNumber} ${v.Id})` : '';
    console.log(
      `  ${d.Id}  ${state.padEnd(8)} ${(v?.ProcessType ?? '?').padEnd(24)} ${d.DeveloperName}${versionNote}`,
    );
  }

  console.log('\nworkflow rules:');
  const rules = toolingSoql<{ Id: string; Name: string; TableEnumOrId: string }>(
    'SELECT Id, Name, TableEnumOrId FROM WorkflowRule ORDER BY Name',
  );
  if (rules.length === 0) console.log('  (none)');
  for (const r of rules) console.log(`  ${r.Id}  ${r.TableEnumOrId.padEnd(24)} ${r.Name}`);

  console.log('\napex triggers:');
  const triggers = toolingSoql<{ Id: string; Name: string; TableEnumOrId: string; Status: string }>(
    'SELECT Id, Name, TableEnumOrId, Status FROM ApexTrigger ORDER BY Name',
  );
  if (triggers.length === 0) console.log('  (none)');
  for (const t of triggers) {
    console.log(`  ${t.Id}  ${t.Status.padEnd(9)} ${t.TableEnumOrId.padEnd(24)} ${t.Name}`);
  }
  process.exit(0);
}

function fetchFlowVersion(versionId: string): {
  Id: string;
  FullName: string;
  Metadata: FlowMetadata;
} {
  const rows = toolingSoql<{ Id: string; FullName: string; Metadata: FlowMetadata }>(
    `SELECT Id, FullName, Metadata FROM Flow WHERE Id = '${sfId(versionId)}'`,
  );
  const row = rows[0];
  if (!row) throw new Error(`Flow version ${versionId} not found`);
  return row;
}

/** Build an ObjectResolution by mapping the live sobject describe — the same
 *  path a real import's `create`-action objects take (mirrors
 *  sf-dry-run-report's resolutionFor). Standard objects map onto curated seed
 *  keys in a real import, which this dry run can't see. */
function resolutionFor(sobject: string): ObjectResolution | null {
  try {
    const out = sfJson<{ result: SObjectDescribe }>(
      `sf sobject describe --sobject ${sobject} --target-org ${alias} --json`,
    );
    const m = mapSObject(out.result);
    return buildResolution({
      obj: { sfObject: m.sfObject, targetKey: m.targetKey, nameFieldSf: m.nameFieldSf },
      fields: m.fields,
    });
  } catch {
    return null;
  }
}

function printTranslation(t: TranslatedAutomation) {
  if (!t.ok) {
    console.log(`\ntranslate: REFERENCE (${t.sfType}) — ${t.reason}`);
    console.log(
      `  key='${t.key}' activeInSf=${t.activeInSf}${t.sfObject ? ` object=${t.sfObject}` : ''}`,
    );
    return;
  }
  console.log(
    `\ntranslate: '${t.name}' → flow '${t.key}' on '${t.targetObjectKey}' (status ${t.status})`,
  );
  console.log(JSON.stringify({ trigger: t.trigger, graph: t.graph }, null, 2));
  for (const n of t.notes) console.log(`  note: ${n}`);
}

function printFlow(versionId: string) {
  const flow = fetchFlowVersion(versionId);
  if (raw) {
    console.log(JSON.stringify(flow, null, 2));
    return;
  }
  const m = flow.Metadata;
  console.log(`${flow.FullName} — '${m.label ?? '?'}'`);
  console.log(`  processType: ${m.processType ?? '?'}   status: ${m.status ?? '?'}`);
  if (m.start) {
    const s = m.start;
    console.log(
      `  start: triggerType=${s.triggerType ?? '—'} recordTriggerType=${s.recordTriggerType ?? '—'} object=${s.object ?? '—'}`,
    );
    console.log(
      `         filters=${s.filters?.length ?? 0} filterFormula=${s.filterFormula ? 'yes' : '—'} scheduledPaths=${s.scheduledPaths?.length ?? 0} → ${s.connector?.targetReference ?? '—'}`,
    );
  } else {
    console.log(`  start: (none) startElementReference=${m.startElementReference ?? '—'}`);
  }
  const counts: Array<[string, number]> = [
    ['assignments', m.assignments?.length ?? 0],
    ['decisions', m.decisions?.length ?? 0],
    ['loops', m.loops?.length ?? 0],
    ['recordLookups', m.recordLookups?.length ?? 0],
    ['recordCreates', m.recordCreates?.length ?? 0],
    ['recordUpdates', m.recordUpdates?.length ?? 0],
    ['recordDeletes', m.recordDeletes?.length ?? 0],
    ['waits', m.waits?.length ?? 0],
    ['actionCalls', m.actionCalls?.length ?? 0],
    ['screens', m.screens?.length ?? 0],
    ['subflows', m.subflows?.length ?? 0],
    ['formulas', m.formulas?.length ?? 0],
    ['variables', m.variables?.length ?? 0],
  ];
  console.log(
    `  elements: ${counts
      .filter(([, n]) => n > 0)
      .map(([k, n]) => `${k}=${n}`)
      .join(' ')}`,
  );
  for (const a of m.actionCalls ?? []) {
    console.log(`  actionCall: ${a.name ?? '?'} actionType=${a.actionType ?? '?'}`);
  }

  // Translate with live mapSObject resolutions for every object the flow
  // touches (trigger object + lookup/create/update/delete objects).
  const objects = new Set<string>();
  if (m.start?.object) objects.add(m.start.object);
  for (const el of [
    ...(m.recordLookups ?? []),
    ...(m.recordCreates ?? []),
    ...(m.recordUpdates ?? []),
    ...(m.recordDeletes ?? []),
  ]) {
    if (el.object) objects.add(el.object);
  }
  const resolutions = new Map<string, ObjectResolution>();
  for (const sobject of objects) {
    const res = resolutionFor(sobject);
    if (res) resolutions.set(res.sfObject, res);
  }
  printTranslation(translateFlow(flow, resolutions, new Set(resolutions.keys())));
}

function printWorkflowRule(ruleId: string) {
  const rows = toolingSoql<ToolingMetadataRecord<WorkflowRuleMetadata>>(
    `SELECT Id, FullName, Metadata FROM WorkflowRule WHERE Id = '${sfId(ruleId)}'`,
  );
  const rule = rows[0];
  if (!rule) throw new Error(`WorkflowRule ${ruleId} not found`);
  if (raw) {
    console.log(JSON.stringify(rule, null, 2));
    return;
  }
  const m = rule.Metadata;
  console.log(`${rule.FullName} (active=${m.active ?? '?'})`);
  console.log(`  triggerType: ${m.triggerType ?? '?'}`);
  console.log(
    `  criteria: items=${m.criteriaItems?.length ?? 0} booleanFilter=${m.booleanFilter ?? '—'} formula=${m.formula ? 'yes' : '—'}`,
  );
  for (const a of m.actions ?? []) console.log(`  action: ${a.type ?? '?'} ${a.name ?? '?'}`);
  for (const t of m.workflowTimeTriggers ?? []) {
    console.log(
      `  timeTrigger: ${t.timeLength ?? '?'} ${t.workflowTimeTriggerUnit ?? '?'} from ${t.offsetFromField ?? 'rule eval'} (${t.actions?.length ?? 0} actions)`,
    );
  }

  // FullName is object-qualified ('Case.MyRule') — the prefix is the object.
  const sfObject = rule.FullName.split('.')[0] ?? '';
  const resolutions = new Map<string, ObjectResolution>();
  const res = resolutionFor(sfObject);
  if (res) resolutions.set(res.sfObject, res);
  printTranslation(translateWorkflowRule(rule, sfObject, resolutions, loadWorkflowActions()));
}

/** Resolve action metadata by DeveloperName (FullName suffix) — list ids
 *  first, then one single-row Metadata fetch each (Tooling restriction). */
function loadWorkflowActions(): WorkflowActionBundle {
  const bundle = emptyWorkflowActionBundle();
  const load = <M>(sobject: string, into: Map<string, M>) => {
    try {
      for (const row of toolingSoql<{ Id: string }>(`SELECT Id FROM ${sobject} LIMIT 100`)) {
        const rec = toolingSoql<ToolingMetadataRecord<M>>(
          `SELECT Id, FullName, Metadata FROM ${sobject} WHERE Id = '${sfId(row.Id)}'`,
        )[0];
        if (rec) into.set(rec.FullName.split('.').pop() ?? rec.FullName, rec.Metadata);
      }
    } catch {
      // Best-effort: rules whose actions are missing translate to references.
    }
  };
  load<WorkflowFieldUpdateMetadata>('WorkflowFieldUpdate', bundle.fieldUpdates);
  load<WorkflowAlertMetadata>('WorkflowAlert', bundle.alerts);
  load<WorkflowTaskMetadata>('WorkflowTask', bundle.tasks);
  return bundle;
}

if (id.startsWith('01Q')) {
  printWorkflowRule(id);
} else if (id.startsWith('300')) {
  const defs = toolingSoql<FlowDefinitionListItem>(
    `SELECT Id, DeveloperName, ActiveVersionId, LatestVersionId FROM FlowDefinition WHERE Id = '${sfId(id)}'`,
  );
  const def = defs[0];
  if (!def) throw new Error(`FlowDefinition ${id} not found`);
  const versionId = def.ActiveVersionId ?? def.LatestVersionId;
  if (!versionId) throw new Error(`FlowDefinition ${def.DeveloperName} has no versions`);
  console.log(
    `${def.DeveloperName}: using ${def.ActiveVersionId ? 'active' : 'latest'} version ${versionId}\n`,
  );
  printFlow(versionId);
} else if (id.startsWith('301')) {
  printFlow(id);
} else {
  throw new Error(`unrecognized id prefix: ${id} (expected 300…, 301…, or 01Q…)`);
}
