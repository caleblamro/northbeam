// Dry-run the auto-mapper against a real org via the sf CLI — no DB, no server.
//   pnpm --filter @northbeam/api sf:dry-run-map <SObject> [sfAlias]
// Prints the proposed mapping summary so the translation can be eyeballed before
// an actual import.

import { execSync } from 'node:child_process';
import type { SObjectDescribe } from '@northbeam/salesforce';
import { mapSObject } from '../src/salesforce/mapper.js';

const [sobject, alias = 'testOrg'] = process.argv.slice(2);
if (!sobject) {
  console.error('usage: sf:dry-run-map <SObject> [sfAlias]');
  process.exit(1);
}

const out = JSON.parse(
  execSync(`sf sobject describe --sobject ${sobject} --target-org ${alias} --json`, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  }),
) as { result: SObjectDescribe };

const m = mapSObject(out.result);

const by = (s: string) => m.fields.filter((f) => f.status === s);
console.log(`\n${m.sfObject} → ${m.targetKey} (${m.action})  table=${m.tableName}`);
console.log(
  `fields: ${m.fields.length} total | ${by('mapped').length} mapped | ${by('review').length} review | ${by('skip').length} skip`,
);
console.log(
  `recordTypes: ${m.recordTypes.map((r) => r.key).join(', ') || '—'} | nameField=${m.nameFieldSf} | owner=${m.hasOwner}`,
);

const reasons = new Map<string, number>();
for (const f of m.fields) {
  if (f.reason)
    reasons.set(
      f.reason.split(' — ')[0] as string,
      (reasons.get(f.reason.split(' — ')[0] as string) ?? 0) + 1,
    );
}
console.log('\nreview/skip reasons:');
for (const [r, n] of [...reasons.entries()].sort((a, b) => b[1] - a[1]))
  console.log(`  ${n}× ${r}`);

console.log('\nsample of mapped fields:');
for (const f of by('mapped').slice(0, 25)) {
  console.log(
    `  ${f.sfField.padEnd(28)} ${f.sfType.padEnd(14)} → ${f.key.padEnd(28)} ${f.type.padEnd(13)} ${f.pgType}`,
  );
}
console.log('\nsample of review fields:');
for (const f of by('review').slice(0, 10)) {
  console.log(`  ${f.sfField.padEnd(28)} ${f.sfType.padEnd(22)} — ${f.reason}`);
}
console.log(
  `\nlayout: ${m.layout.sections?.length} sections; list=[${m.layout.listColumns?.join(', ')}]`,
);
