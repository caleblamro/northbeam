// Manual reseed CLI: `pnpm --filter @northbeam/db seed:org <orgId> [--force]`.
//
// Re-runs seedStandardObjects + seedSampleRecords against an existing org,
// inside the same `withOrgContext` transaction the real org.create handler
// uses. Useful when you want fresh sample views / records without nuking
// the workspace through the UI.
//
// Behaviour:
//   - seedStandardObjects is idempotent (uses onConflictDoNothing on every
//     insert + checks for existing rows on object_def) — safe to re-run.
//   - seedSampleRecords is NOT idempotent. By default the script skips it
//     when the account table already has records. Pass `--force` to insert
//     anyway (you'll end up with duplicates — useful for stress testing).

import { eq, or, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { qualified } from '../dynamic/identifiers.js';
import { getObjectByKey } from '../queries/crm.js';
import { seedSampleRecords } from '../sample-records.js';
import * as schema from '../schema.js';
import { seedStandardObjects } from '../seed.js';

async function main() {
  const [orgArg, ...rest] = process.argv.slice(2);
  const force = rest.includes('--force');

  if (!orgArg) {
    // eslint-disable-next-line no-console
    console.error('Usage: pnpm --filter @northbeam/db seed:org <orgIdOrSlug> [--force]');
    process.exit(1);
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    // eslint-disable-next-line no-console
    console.error('DATABASE_URL is required (dev: dotenv -e ../../.env.local)');
    process.exit(1);
  }

  const sqlClient = postgres(url, { max: 4 });
  const db = drizzle(sqlClient, { schema, casing: 'snake_case' });

  try {
    // Resolve the arg to a real org row. Accepts either organization.id
    // (Better Auth's text id) or organization.slug (the friendly name
    // shown in the UI), so the user doesn't have to remember either form.
    const [found] = await db
      .select({
        id: schema.organization.id,
        name: schema.organization.name,
        slug: schema.organization.slug,
      })
      .from(schema.organization)
      .where(or(eq(schema.organization.id, orgArg), eq(schema.organization.slug, orgArg)))
      .limit(1);

    if (!found) {
      // eslint-disable-next-line no-console
      console.error(
        `[seed:org] No workspace matches '${orgArg}'. Run \`select id, name, slug from organization;\` to list available workspaces.`,
      );
      process.exit(1);
    }

    const orgId = found.id;
    // eslint-disable-next-line no-console
    console.log(`[seed:org] Reseeding '${found.name}' (slug=${found.slug}, id=${orgId})…`);

    await db.transaction(async (tx) => {
      await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`);

      // eslint-disable-next-line no-console
      console.log('[seed:org] Syncing metadata + views…');
      await seedStandardObjects(tx, orgId);

      // Decide whether to add sample records. Look at the account table
      // record count to gauge whether the org is already populated.
      const accountObj = await getObjectByKey(tx, orgId, 'account');
      if (!accountObj) {
        // eslint-disable-next-line no-console
        console.warn('[seed:org] account object missing after seedStandardObjects — bailing.');
        return;
      }
      const tableRef = sql.raw(qualified(orgId, accountObj.object.tableName));
      const rows = (await tx.execute(
        sql`select count(*)::int as n from ${tableRef}`,
      )) as unknown as Array<{ n: number }>;
      const n = rows[0]?.n ?? 0;

      if (n > 0 && !force) {
        // eslint-disable-next-line no-console
        console.log(
          `[seed:org] Skipping sample records — account table already has ${n} rows. Pass --force to insert anyway.`,
        );
        return;
      }
      // eslint-disable-next-line no-console
      console.log('[seed:org] Inserting sample records…');
      await seedSampleRecords(tx, orgId);
    });

    // eslint-disable-next-line no-console
    console.log('[seed:org] Done.');
  } finally {
    await sqlClient.end({ timeout: 5 });
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[seed:org] failed:', err);
  process.exit(1);
});
