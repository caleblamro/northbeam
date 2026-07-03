// Backfill the 4 system roles (owner/admin/member/viewer) for every existing
// org. New orgs get them in org.create; this covers orgs created before custom
// roles landed. Idempotent — seedRoles skips existing (org, key) rows.
//
//   pnpm --filter @northbeam/api seed:roles
//
// Uses DATABASE_ADMIN_URL (owner) so it can write without a per-request GUC —
// it sets app.org_id per org itself via withOrgContext.

import { SYSTEM_ROLE_SEEDS } from '@northbeam/core';
import { createDb, schema, seedRoles, withOrgContext } from '@northbeam/db';

async function main() {
  const url = process.env.DATABASE_ADMIN_URL ?? process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_ADMIN_URL (or DATABASE_URL) is required');
    process.exit(1);
  }
  const db = createDb(url);
  const orgs = await db.select({ id: schema.organization.id }).from(schema.organization);
  const seeds = SYSTEM_ROLE_SEEDS.map((s) => ({
    key: s.key,
    name: s.name,
    description: s.description,
    rank: s.rank,
    isSystem: true,
    orgPermissions: s.orgPermissions,
    defaultGrant: s.defaultGrant,
  }));

  for (const org of orgs) {
    await withOrgContext(db, org.id, (tx) => seedRoles(tx, org.id, seeds));
  }
  console.log(`[seed:roles] seeded system roles for ${orgs.length} org(s)`);
  process.exit(0);
}

main().catch((err) => {
  console.error('[seed:roles] failed:', err);
  process.exit(1);
});
