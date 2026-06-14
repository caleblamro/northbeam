// Postgres client + Drizzle. Each runtime calls `createDb()` once and passes
// the result wherever needed. Caching is handled per-process by module init.
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import {
  type PostgresJsDatabase,
  type PostgresJsQueryResultHKT,
  drizzle,
} from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export type Database = PostgresJsDatabase<typeof schema>;
export type DbTx = PgTransaction<
  PostgresJsQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;
/** Anything that can run queries — the root Database or a transaction inside it.
 *  All metadata-layer query helpers accept this so callers can pass either. */
export type DbExecutor = Database | DbTx;

let cached: Database | undefined;

export function createDb(url = process.env.DATABASE_URL): Database {
  if (!url) throw new Error('DATABASE_URL is required');
  if (cached) return cached;
  const sqlClient = postgres(url, { max: 10 });
  cached = drizzle(sqlClient, { schema, casing: 'snake_case' });
  return cached;
}

/** Run `fn` inside a transaction that has `app.org_id` set as a session GUC.
 *  RLS policies on metadata tables (object_def / field_def / record_type /
 *  salesforce_connection / migration_run / object_mapping / field_mapping) check
 *  this value, so every code path that reads or writes those tables must run
 *  through this wrapper. `protectedProcedure` does this automatically; non-tRPC
 *  entrypoints (org.create, executeRun, the seeder) call it directly. */
export async function withOrgContext<T>(
  db: Database,
  orgId: string,
  fn: (tx: DbTx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    // SET LOCAL is transaction-scoped, so the GUC is released when the
    // transaction commits or rolls back. set_config('…', '…', true) is the
    // parameterizable equivalent.
    await tx.execute(sql`select set_config('app.org_id', ${orgId}, true)`);
    return fn(tx);
  });
}

export { schema };
