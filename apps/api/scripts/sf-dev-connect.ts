// Dev shortcut: seed a Salesforce connection from the local `sf` CLI access token,
// so the import engine can be built/tested before a Connected App (OAuth) exists.
//
// Usage:
//   pnpm --filter @northbeam/api sf:dev-connect <northbeamOrgId> [sfAlias]
//
// Requires SF_TOKEN_KEY in the env and the `sf` CLI authenticated to <sfAlias>
// (default: testOrg). The CLI token is short-lived — re-run when it expires.

import { execSync } from 'node:child_process';
import { createDb, upsertConnection, withOrgContext } from '@northbeam/db';
import { encryptSecret } from '../src/lib/crypto.js';

const [orgId, alias = 'testOrg'] = process.argv.slice(2);
if (!orgId) {
  console.error('usage: sf:dev-connect <northbeamOrgId> [sfAlias]');
  process.exit(1);
}

// Modern `sf` CLI masks the access token as "[REDACTED] Use 'sf org auth
// show-access-token'…" everywhere in `org display` (even with --verbose), so we
// must fetch the real token via the dedicated command. `--json` also bypasses
// its interactive "you're about to reveal the access token" confirmation.
// `org display` still returns the (non-secret) instanceUrl unmasked.
const tokenOut = JSON.parse(
  execSync(`sf org auth show-access-token --target-org ${alias} --json`, { encoding: 'utf8' }),
) as { result?: string | { accessToken?: string } };
const accessToken =
  typeof tokenOut.result === 'string' ? tokenOut.result : tokenOut.result?.accessToken;

const displayOut = JSON.parse(
  execSync(`sf org display --target-org ${alias} --json`, { encoding: 'utf8' }),
) as { result?: { instanceUrl?: string } };
const instanceUrl = displayOut.result?.instanceUrl;

if (!accessToken || !instanceUrl) {
  console.error('could not read accessToken/instanceUrl from sf CLI', { tokenOut, displayOut });
  process.exit(1);
}
if (accessToken.startsWith('[REDACTED')) {
  console.error('sf CLI returned a masked access token');
  process.exit(1);
}

const db = createDb();
// RLS on salesforce_connection checks the app.org_id GUC — same as the API's
// protectedProcedure; a bare insert from a script is rejected (42501).
await withOrgContext(db, orgId, (tx) =>
  upsertConnection(tx, {
    orgId,
    instanceUrl,
    accessTokenEnc: encryptSecret(accessToken),
    refreshTokenEnc: null,
    connectedBy: null,
  }),
);
console.log(`✓ connected org ${orgId} → ${instanceUrl} (via sf CLI alias '${alias}')`);
process.exit(0);
