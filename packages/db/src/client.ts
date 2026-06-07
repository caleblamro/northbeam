// Postgres client + Drizzle. Each runtime calls `createDb()` once and passes
// the result wherever needed. Caching is handled per-process by module init.
import { type PostgresJsDatabase, drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

export type Database = PostgresJsDatabase<typeof schema>;

let cached: Database | undefined;

export function createDb(url = process.env.DATABASE_URL): Database {
  if (!url) throw new Error('DATABASE_URL is required');
  if (cached) return cached;
  const sql = postgres(url, { max: 10 });
  cached = drizzle(sql, { schema, casing: 'snake_case' });
  return cached;
}

export { schema };
