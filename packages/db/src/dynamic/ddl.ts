// DDL engine — translates object_def / field_def metadata into real Postgres
// tables/columns at runtime. One table per object, in the org's schema. All
// statements use pre-sanitized identifiers (see identifiers.ts).
//
// Constraints (required/unique/FK) are app-enforced for now, not DB-enforced, so
// imports never fail on a blank "required" SF field or an unresolved reference;
// per-field DB constraints can be layered on later.

import { sql } from 'drizzle-orm';
import type { DbExecutor } from '../client.js';
import type { FieldRow, ObjectRow } from '../queries/crm.js';
import { objectTableName, orgSchema, qid, qualified } from './identifiers.js';

// System columns on every object table. owner_id / created_by_id are TEXT to match
// user.id (Better Auth string ids). record_type_id is our own uuid.
const SYSTEM_COLUMNS = `
  "id" uuid primary key default gen_random_uuid(),
  "owner_id" text,
  "record_type_id" uuid,
  "name" text,
  "salesforce_id" text,
  "created_at" timestamptz not null default now(),
  "updated_at" timestamptz not null default now(),
  "created_by_id" text`;

function columnDef(field: FieldRow): string {
  return `${qid(field.columnName)} ${field.pgType}`;
}

export async function ensureSchema(db: DbExecutor, orgId: string): Promise<void> {
  await db.execute(sql.raw(`create schema if not exists ${qid(orgSchema(orgId))}`));
}

export async function createObjectTable(
  db: DbExecutor,
  orgId: string,
  object: ObjectRow,
  fields: FieldRow[],
): Promise<void> {
  await ensureSchema(db, orgId);
  const table = object.tableName || objectTableName(object.key);
  const tbl = qualified(orgId, table);
  const cols = fields.map(columnDef).join(',\n  ');
  await db.execute(
    sql.raw(`create table if not exists ${tbl} (${SYSTEM_COLUMNS}${cols ? `,\n  ${cols}` : ''}\n)`),
  );
  // Default indexes: name (search/sort), owner, created_at (the default list
  // sort — every list view / searchRefs orders by created_at desc), and a
  // partial-unique on salesforce_id.
  await db.execute(
    sql.raw(
      `create unique index if not exists ${qid(`${table}_sfid_uq`)} on ${tbl} ("salesforce_id") where "salesforce_id" is not null`,
    ),
  );
  await db.execute(
    sql.raw(`create index if not exists ${qid(`${table}_name_idx`)} on ${tbl} ("name")`),
  );
  await db.execute(
    sql.raw(`create index if not exists ${qid(`${table}_owner_idx`)} on ${tbl} ("owner_id")`),
  );
  await db.execute(
    sql.raw(
      `create index if not exists ${qid(`${table}_created_idx`)} on ${tbl} ("created_at" desc)`,
    ),
  );
  for (const f of fields) if (f.indexed) await ensureFieldIndex(db, orgId, object, f);
}

export async function addField(
  db: DbExecutor,
  orgId: string,
  object: ObjectRow,
  field: FieldRow,
): Promise<void> {
  await db.execute(
    sql.raw(
      `alter table ${qualified(orgId, object.tableName)} add column if not exists ${columnDef(field)}`,
    ),
  );
  if (field.indexed) await ensureFieldIndex(db, orgId, object, field);
}

export async function dropField(
  db: DbExecutor,
  orgId: string,
  object: ObjectRow,
  columnName: string,
): Promise<void> {
  await db.execute(
    sql.raw(
      `alter table ${qualified(orgId, object.tableName)} drop column if exists ${qid(columnName)}`,
    ),
  );
}

export async function ensureFieldIndex(
  db: DbExecutor,
  orgId: string,
  object: ObjectRow,
  field: FieldRow,
): Promise<void> {
  const idx = `${object.tableName}_${field.columnName}_idx`.slice(0, 63);
  await db.execute(
    sql.raw(
      `create index if not exists ${qid(idx)} on ${qualified(orgId, object.tableName)} (${qid(field.columnName)})`,
    ),
  );
}

export async function dropObjectTable(
  db: DbExecutor,
  orgId: string,
  object: ObjectRow,
): Promise<void> {
  await db.execute(sql.raw(`drop table if exists ${qualified(orgId, object.tableName)} cascade`));
}

export async function dropOrgSchema(db: DbExecutor, orgId: string): Promise<void> {
  await db.execute(sql.raw(`drop schema if exists ${qid(orgSchema(orgId))} cascade`));
}
