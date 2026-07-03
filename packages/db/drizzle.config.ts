import { defineConfig } from 'drizzle-kit';

// Schema tooling (push/generate/migrate/studio) runs as the OWNER role, not
// the RLS-restricted runtime role in DATABASE_URL — DDL needs ownership.
const url =
  process.env.DATABASE_ADMIN_URL ??
  process.env.DATABASE_URL ??
  'postgresql://northbeam:northbeam@localhost:5432/northbeam';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: './drizzle',
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
