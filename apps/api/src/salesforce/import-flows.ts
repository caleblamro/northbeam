// Phase 7 of the migration: import Salesforce automations (Flows, Workflow
// Rules, Apex Triggers) as native `flow` rows. Best-effort by design — this
// phase runs inside its own try/catch in executeRun (an automation failure
// must never fail the record import), and every item is individually guarded.
//
// Fidelity contract (flow-mapper.ts): translated automations land 'paused'
// (active in SF) or 'draft' — never active; anything untranslatable becomes a
// 'needs_rebuild' reference row with referenceMeta, so nothing is silently
// lost. Apex triggers are always references. Re-running a migration is
// idempotent via onConflictDoNothing on the (org, key) unique index.

import {
  type DbExecutor,
  type FieldRow,
  getObjectByKey,
  schema,
  writeAuditEvent,
} from '@northbeam/db';
import type { SalesforceClient } from '@northbeam/salesforce';
import {
  type TranslatedAutomation,
  type WorkflowActionBundle,
  emptyWorkflowActionBundle,
  flowKeyFrom,
  translateFlow,
  translateWorkflowRule,
} from './flow-mapper.js';
import type { MappedObject, ProposedField } from './mapper.js';
import { type ObjectResolution, buildResolution } from './report-mapper.js';

// Working-slice caps, same philosophy as REPORT_IMPORT_CAP: each Metadata
// fetch is one (large) Tooling round trip, so these bound the phase.
export const FLOW_FETCH_CAP = 100;
// One Tooling API metadata fetch per flow — 200 comfortably covers a real
// org's active flow inventory (OnQ: 90) without risking a runaway.
export const FLOW_TRANSLATE_CAP = 200;
export const WORKFLOW_RULE_CAP = 50;
export const APEX_TRIGGER_CAP = 100;
const MAX_SKIP_NOTES = 25;

type Plan = { obj: MappedObject; fields: ProposedField[] };
type Stats = NonNullable<typeof schema.migrationRun.$inferSelect.stats>;
type RunFn = <T>(fn: (tx: DbExecutor) => Promise<T>) => Promise<T>;

export async function importAutomations(opts: {
  run: RunFn;
  client: SalesforceClient;
  orgId: string;
  plans: Plan[];
  stats: Stats;
  writeStats: () => Promise<void>;
}): Promise<void> {
  const { run, client, orgId, plans, stats } = opts;

  const resolutions = new Map<string, ObjectResolution>();
  for (const plan of plans) {
    const res = buildResolution({
      obj: {
        sfObject: plan.obj.sfObject,
        targetKey: plan.obj.targetKey,
        nameFieldSf: plan.obj.nameFieldSf,
      },
      fields: plan.fields,
    });
    resolutions.set(res.sfObject, res);
  }
  const importedSfObjects = new Set(plans.map((p) => p.obj.sfObject));

  const skipped: Array<{ label: string; reason: string }> = [];
  const noteSkip = (label: string, reason: string) => {
    stats.automationsSkipped = (stats.automationsSkipped ?? 0) + 1;
    if (skipped.length < MAX_SKIP_NOTES) skipped.push({ label, reason });
  };

  // objectId lookups per target key (nullable — references on non-imported
  // objects and global rows carry NULL).
  const objectCache = new Map<string, { id: string; fields: FieldRow[] } | null>();
  const loadObject = async (targetKey: string) => {
    if (!objectCache.has(targetKey)) {
      const loaded = await run((tx) => getObjectByKey(tx, orgId, targetKey));
      objectCache.set(targetKey, loaded ? { id: loaded.object.id, fields: loaded.fields } : null);
    }
    return objectCache.get(targetKey) ?? null;
  };

  const insertFlowRow = async (values: typeof schema.flow.$inferInsert): Promise<boolean> => {
    const inserted = await run((tx) =>
      tx
        .insert(schema.flow)
        .values(values)
        // (org, key) unique index → re-running a migration is idempotent;
        // a conflict means "already imported".
        .onConflictDoNothing()
        .returning({ id: schema.flow.id }),
    );
    const row = inserted[0];
    if (row) {
      await run((tx) =>
        writeAuditEvent(tx, {
          organizationId: orgId,
          userId: null,
          action: 'flow.created',
          targetType: 'flow',
          targetId: row.id,
          meta: {
            name: values.name,
            status: values.status ?? 'draft',
            source: 'salesforce',
            ...(values.referenceMeta ? { sfType: values.referenceMeta.sfType } : {}),
          },
        }),
      );
    }
    return Boolean(row);
  };

  const insertTranslated = async (
    t: Extract<TranslatedAutomation, { ok: true }>,
    salesforceId: string,
  ): Promise<boolean> => {
    const obj = await loadObject(t.targetObjectKey);
    if (!obj) {
      noteSkip(t.name, `target object '${t.targetObjectKey}' missing`);
      return false;
    }
    const description =
      [
        t.description,
        t.notes.length
          ? `Imported from Salesforce with notes:\n${t.notes.map((n) => `• ${n}`).join('\n')}`
          : null,
      ]
        .filter(Boolean)
        .join('\n\n') || null;
    return insertFlowRow({
      organizationId: orgId,
      objectId: obj.id,
      key: t.key,
      name: t.name,
      description,
      status: t.status,
      source: 'salesforce',
      salesforceId,
      draftTrigger: t.trigger,
      draftGraph: t.graph,
    });
  };

  const insertReference = async (
    r: Extract<TranslatedAutomation, { ok: false }>,
    salesforceId: string,
  ): Promise<boolean> => {
    const plan = r.sfObject ? plans.find((p) => p.obj.sfObject === r.sfObject) : undefined;
    const obj = plan ? await loadObject(plan.obj.targetKey) : null;
    return insertFlowRow({
      organizationId: orgId,
      objectId: obj?.id ?? null,
      key: r.key,
      name: r.name,
      description: r.description ?? null,
      status: 'needs_rebuild',
      source: 'salesforce',
      salesforceId,
      referenceMeta: {
        sfId: r.sfId,
        apiName: r.apiName,
        sfType: r.sfType,
        ...(r.sfObject ? { sfObject: r.sfObject } : {}),
        ...(r.description ? { description: r.description } : {}),
        activeInSf: r.activeInSf,
        reason: r.reason,
      },
    });
  };

  // ── Flows ───────────────────────────────────────────────────────────────
  const defs = await client.listFlowDefinitions(FLOW_FETCH_CAP);
  stats.flowsFound = defs.length;
  stats.flowsTranslated = 0;
  stats.flowsReferenced = 0;
  await opts.writeStats();

  let translateBudget = FLOW_TRANSLATE_CAP;
  for (const def of defs) {
    try {
      const versionId = def.ActiveVersionId ?? def.LatestVersionId;
      if (!versionId) {
        noteSkip(def.DeveloperName, 'flow has no versions');
        continue;
      }
      if (translateBudget <= 0) {
        // Beyond the metadata-fetch budget everything still lands, as a
        // reference — nothing silently lost.
        const created = await insertReference(
          {
            ok: false,
            sfId: def.Id,
            apiName: def.DeveloperName,
            key: flowKeyFrom(def.DeveloperName),
            name: def.DeveloperName,
            sfType: 'flow',
            activeInSf: def.ActiveVersionId != null,
            reason: `flow translate cap (${FLOW_TRANSLATE_CAP}) reached — imported as a reference`,
          },
          def.Id,
        );
        if (created) stats.flowsReferenced = (stats.flowsReferenced ?? 0) + 1;
        continue;
      }
      translateBudget -= 1;
      const version = await client.getFlowVersion(versionId);
      if (!version) {
        noteSkip(def.DeveloperName, `flow version ${versionId} not found`);
        continue;
      }
      const t = translateFlow(version, resolutions, importedSfObjects);
      if (t.ok) {
        if (await insertTranslated(t, def.Id)) {
          stats.flowsTranslated = (stats.flowsTranslated ?? 0) + 1;
        }
      } else if (await insertReference(t, def.Id)) {
        stats.flowsReferenced = (stats.flowsReferenced ?? 0) + 1;
      }
    } catch (err) {
      noteSkip(def.DeveloperName, trimError(err));
    }
  }
  await opts.writeStats();

  // ── Workflow rules ──────────────────────────────────────────────────────
  const rules = await client.listWorkflowRules(WORKFLOW_RULE_CAP);
  stats.workflowRulesFound = rules.length;
  stats.workflowRulesTranslated = 0;
  const bundle = rules.length > 0 ? await loadWorkflowActions(client) : emptyWorkflowActionBundle();

  for (const r of rules) {
    try {
      const rec = await client.getWorkflowRuleMetadata(r.Id);
      if (!rec) {
        noteSkip(r.Name, 'workflow rule metadata not found');
        continue;
      }
      const t = translateWorkflowRule(rec, r.TableEnumOrId, resolutions, bundle);
      if (t.ok) {
        if (await insertTranslated(t, r.Id)) {
          stats.workflowRulesTranslated = (stats.workflowRulesTranslated ?? 0) + 1;
        }
      } else if (await insertReference(t, r.Id)) {
        stats.flowsReferenced = (stats.flowsReferenced ?? 0) + 1;
      }
    } catch (err) {
      noteSkip(r.Name, trimError(err));
    }
  }
  await opts.writeStats();

  // ── Apex triggers — always references (code is never auto-translated) ───
  const triggers = await client.listApexTriggers(APEX_TRIGGER_CAP);
  for (const tr of triggers) {
    try {
      const created = await insertReference(
        {
          ok: false,
          sfId: tr.Id,
          apiName: tr.Name,
          key: flowKeyFrom(tr.Name, 'apex_'),
          name: tr.Name,
          sfType: 'apex-trigger',
          sfObject: tr.TableEnumOrId,
          activeInSf: tr.Status === 'Active',
          reason: 'Apex trigger code cannot be auto-translated — rebuild as a native flow',
        },
        tr.Id,
      );
      if (created) stats.flowsReferenced = (stats.flowsReferenced ?? 0) + 1;
    } catch (err) {
      noteSkip(tr.Name, trimError(err));
    }
  }

  if (skipped.length) stats.skippedAutomations = skipped;
  await opts.writeStats();
}

/** Resolve workflow action metadata up front, keyed by DeveloperName. The
 *  Tooling API restricts FullName/Metadata selects to single-row queries, so
 *  this lists ids first and fetches each record individually. All best-effort
 *  — a missing action makes its rule a reference, not an import failure. */
async function loadWorkflowActions(client: SalesforceClient): Promise<WorkflowActionBundle> {
  const bundle = emptyWorkflowActionBundle();
  const CAP = 100;

  try {
    const rows = (
      await client.toolingQuery<{ Id: string }>(`SELECT Id FROM WorkflowFieldUpdate LIMIT ${CAP}`)
    ).records;
    for (const row of rows) {
      const rec = await client.getWorkflowFieldUpdate(row.Id);
      // FullName is object-qualified ('Case.ChangePriorityToHigh' — verified);
      // rule actions reference the unqualified DeveloperName.
      if (rec) bundle.fieldUpdates.set(devNameOf(rec.FullName), rec.Metadata);
    }
  } catch {
    // Restricted tokens or missing objects: rules needing these become references.
  }
  try {
    const rows = (
      await client.toolingQuery<{ Id: string }>(`SELECT Id FROM WorkflowAlert LIMIT ${CAP}`)
    ).records;
    for (const row of rows) {
      const rec = await client.getWorkflowAlert(row.Id);
      if (rec) bundle.alerts.set(devNameOf(rec.FullName), rec.Metadata);
    }
  } catch {
    /* same best-effort contract */
  }
  try {
    const rows = (
      await client.toolingQuery<{ Id: string }>(`SELECT Id FROM WorkflowTask LIMIT ${CAP}`)
    ).records;
    for (const row of rows) {
      const rec = await client.getWorkflowTask(row.Id);
      if (rec) bundle.tasks.set(devNameOf(rec.FullName), rec.Metadata);
    }
  } catch {
    /* same best-effort contract */
  }
  return bundle;
}

function devNameOf(fullName: string): string {
  return fullName.split('.').pop() ?? fullName;
}

function trimError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.length > 200 ? `${msg.slice(0, 200)}…` : msg;
}
