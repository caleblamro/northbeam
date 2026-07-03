// Dry-run the report/dashboard translator against a real org via the sf CLI —
// no DB, no server.
//   pnpm --filter @northbeam/api sf:dry-run-report                      → list reports + dashboards
//   pnpm --filter @northbeam/api sf:dry-run-report <id> [sfAlias]       → print proposed translation
//   pnpm --filter @northbeam/api sf:dry-run-report <id> [sfAlias] --raw → dump the describe JSON
// Report ids start with 00O, dashboard ids with 01Z.
//
// Field resolution runs the SAME mapper a real import uses (mapSObject on a
// live `sf sobject describe`), so the printed translation is faithful for
// objects the import would CREATE. Standard objects (Account/Contact/…) map
// onto curated seed keys in a real import, which this dry run can't see —
// their field keys may differ slightly.

import { execSync } from 'node:child_process';
import type {
  DashboardDescribeResult,
  ReportDescribeResult,
  SObjectDescribe,
} from '@northbeam/salesforce';
import { mapSObject } from '../src/salesforce/mapper.js';
import {
  type ObjectResolution,
  buildResolution,
  guessBaseSObjects,
  translateDashboard,
  translateReport,
} from '../src/salesforce/report-mapper.js';

const args = process.argv.slice(2).filter((a) => a !== '--raw');
const raw = process.argv.includes('--raw');
const [id, alias = 'testOrg'] = args;

const SF_V = 'v62.0';
const sfJson = <T>(cmd: string): T =>
  JSON.parse(execSync(cmd, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })) as T;
const rest = <T>(path: string): T =>
  sfJson<T>(`sf api request rest "${path}" --target-org ${alias}`);
const soql = <T>(q: string): T[] =>
  sfJson<{ result: { records: T[] } }>(`sf data query --query "${q}" --target-org ${alias} --json`)
    .result.records;

if (!id) {
  console.log('reports:');
  for (const r of soql<{ Id: string; Name: string; Format: string; FolderName: string | null }>(
    'SELECT Id, Name, DeveloperName, FolderName, Format FROM Report ORDER BY LastModifiedDate DESC LIMIT 50',
  )) {
    console.log(`  ${r.Id}  ${(r.Format ?? '?').padEnd(8)} ${r.FolderName ?? '—'} / ${r.Name}`);
  }
  console.log('\ndashboards:');
  for (const d of soql<{ Id: string; Title: string; FolderName: string | null }>(
    'SELECT Id, Title, DeveloperName, FolderName FROM Dashboard ORDER BY LastModifiedDate DESC LIMIT 50',
  )) {
    console.log(`  ${d.Id}  ${d.FolderName ?? '—'} / ${d.Title}`);
  }
  process.exit(0);
}

/** Build an ObjectResolution by mapping the live sobject describe — the same
 *  path a real import's `create`-action objects take. */
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

function printReport(reportId: string) {
  const describe = rest<ReportDescribeResult>(
    `/services/data/${SF_V}/analytics/reports/${reportId}/describe`,
  );
  if (raw) {
    console.log(JSON.stringify(describe, null, 2));
    return;
  }
  const resolutions = new Map<string, ObjectResolution>();
  for (const candidate of guessBaseSObjects(describe.reportMetadata)) {
    const res = resolutionFor(candidate);
    if (res) {
      resolutions.set(res.sfObject, res);
      break;
    }
  }
  const t = translateReport(describe, resolutions);
  if (!t.ok) {
    console.log(`SKIP ${t.label}: ${t.reason}`);
    return;
  }
  console.log(`${t.label} → ${t.viewType} view '${t.key}' on '${t.targetObjectKey}'`);
  console.log('config:', JSON.stringify(t.config, null, 2));
  console.log('filters:', JSON.stringify(t.filters));
  console.log('columns:', t.columns.join(', ') || '—');
  for (const n of t.notes) console.log(`  note: ${n}`);
}

function printDashboard(dashId: string) {
  const describe = rest<DashboardDescribeResult>(
    `/services/data/${SF_V}/analytics/dashboards/${dashId}/describe`,
  );
  if (raw) {
    console.log(JSON.stringify(describe, null, 2));
    return;
  }
  // Translate each source report first (memoized per report id).
  const reports = new Map<string, ReturnType<typeof translateReport>>();
  const resolutions = new Map<string, ObjectResolution>();
  for (const c of describe.components ?? []) {
    if (!c.reportId || reports.has(c.reportId)) continue;
    try {
      const rd = rest<ReportDescribeResult>(
        `/services/data/${SF_V}/analytics/reports/${c.reportId}/describe`,
      );
      for (const candidate of guessBaseSObjects(rd.reportMetadata)) {
        if ([...resolutions.values()].some((r) => r.sfObject === candidate)) break;
        const res = resolutionFor(candidate);
        if (res) {
          resolutions.set(res.sfObject, res);
          break;
        }
      }
      reports.set(c.reportId, translateReport(rd, resolutions));
    } catch (err) {
      console.log(`  note: report ${c.reportId} describe failed: ${String(err).slice(0, 120)}`);
    }
  }
  const t = translateDashboard(describe, reports);
  if (!t.ok) {
    console.log(`SKIP ${t.label}: ${t.reason}`);
    return;
  }
  console.log(`${t.label} → dashboard view '${t.key}' anchored on '${t.targetObjectKey}'`);
  console.log(JSON.stringify(t.artifact, null, 2));
  for (const n of t.notes) console.log(`  note: ${n}`);
}

if (id.startsWith('01Z')) printDashboard(id);
else printReport(id);
