// Dev shortcut: seed a Salesforce connection from the local `sf` CLI access token,
// so the import engine can be built/tested before a Connected App (OAuth) exists.
//
// Usage:
//   pnpm --filter @northbeam/api sf:dev-connect <northbeamOrgId> [sfAlias]
//
// Requires SF_TOKEN_KEY in the env and the `sf` CLI authenticated to <sfAlias>
// (default: testOrg). The CLI token is short-lived — re-run when it expires.

import { execSync } from 'node:child_process';
import { createDb, upsertConnection } from '@northbeam/db';
import { encryptSecret } from '../src/lib/crypto.js';

const [orgId, alias = 'testOrg'] = process.argv.slice(2);
if (!orgId) {
  console.error('usage: sf:dev-connect <northbeamOrgId> [sfAlias]');
  process.exit(1);
}

const out = JSON.parse(
  execSync(`sf org display --target-org ${alias} --json`, { encoding: 'utf8' }),
) as { result?: { accessToken?: string; instanceUrl?: string } };

const accessToken = out.result?.accessToken;
const instanceUrl = out.result?.instanceUrl;
if (!accessToken || !instanceUrl) {
  console.error('could not read accessToken/instanceUrl from sf CLI', out);
  process.exit(1);
}

const db = createDb();
await upsertConnection(db, {
  orgId,
  instanceUrl,
  accessTokenEnc: encryptSecret(accessToken),
  refreshTokenEnc: null,
  connectedBy: null,
});
console.log(`✓ connected org ${orgId} → ${instanceUrl} (via sf CLI alias '${alias}')`);
process.exit(0);
