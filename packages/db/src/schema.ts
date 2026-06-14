import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { FieldConfig, FieldType, ObjectLayout } from './field-types.js';
import type { Role } from './roles.js';

type DefSource = 'system' | 'custom' | 'salesforce' | 'ai';

/* ────────────────────────────────────────────────────────────────────────────
   Better Auth core tables — singular names match Better Auth conventions
   ────────────────────────────────────────────────────────────────────────── */

export const user = pgTable('user', {
  id: text('id').primaryKey(),
  // Nullable: magic-link signup gives us an email but no name. User sets their
  // name later in Settings. Better Auth would otherwise fail user creation
  // silently and return INVALID_TOKEN to the magic-link verify call.
  name: text('name'),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

export const session = pgTable('session', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  // Better Auth organization plugin tracks the user's active org per session
  activeOrganizationId: text('active_organization_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// OAuth account links (GitHub, etc.) + magic-link credential storage
export const account = pgTable('account', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// Email verification + magic-link tokens
export const verification = pgTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

/* ────────────────────────────────────────────────────────────────────────────
   Better Auth organization plugin tables — extended with our custom fields
   ────────────────────────────────────────────────────────────────────────── */

export const organization = pgTable('organization', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  logo: text('logo'),
  metadata: text('metadata'), // JSON string; Better Auth manages this column
  // Northbeam-specific:
  plan: text('plan').notNull().default('trial'), // trial | starter | growth | scale
  trialEndsAt: timestamp('trial_ends_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const member = pgTable('member', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  role: text('role').$type<Role>().notNull().default('member'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

export const invitation = pgTable('invitation', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  role: text('role').$type<Role>().notNull().default('member'),
  status: text('status').notNull().default('pending'), // pending | accepted | rejected | expired
  expiresAt: timestamp('expires_at').notNull(),
  inviterId: text('inviter_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

/* ────────────────────────────────────────────────────────────────────────────
   METADATA-DRIVEN CRM — objects, fields, and records are all data.
   Standard objects (account/contact/deal/activity) are seeded as `isSystem`
   object defs; Salesforce custom objects/fields just become more defs. This is
   what lets us import "whatever they have" through one uniform path.
   ────────────────────────────────────────────────────────────────────────── */

// An object type (table) in a workspace — standard, custom, or SF-imported.
export const objectDef = pgTable(
  'object_def',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    key: text('key').notNull(), // API name, e.g. 'account', 'project__c'
    // Physical Postgres table name for this object's records (in the org's schema).
    // Set on insert via safeIdent(key); the dynamic record layer reads it.
    tableName: text('table_name').notNull().default(''),
    label: text('label').notNull(),
    labelPlural: text('label_plural').notNull(),
    icon: text('icon').notNull().default('cube'),
    color: text('color').notNull().default('#635bff'),
    description: text('description'),
    // The field key (or pipe-separated keys) whose value renders as a record's
    // display name. 'name' for accounts/deals, 'subject' for activities,
    // 'first_name|last_name' for contacts. Consumed by displayName(). NULL falls
    // back to a conventional heuristic — see queries/crm.ts.
    nameExpression: text('name_expression'),
    // Drives the record page, sectioned create/edit form, and default list columns.
    // Populated by the standard-object seed and the Salesforce importer.
    layout: jsonb('layout').$type<ObjectLayout>().notNull().default({}),
    // System objects are the standard four — present in every workspace, not deletable.
    isSystem: boolean('is_system').notNull().default(false),
    source: text('source').$type<DefSource>().notNull().default('custom'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    orgKey: uniqueIndex('object_def_org_key_uq').on(t.organizationId, t.key),
  }),
);

// A field on an object. `type` is from field-types.ts; `config` (JSONB) holds the
// type-specific settings (picklist options, reference target, formula, etc.).
export const fieldDef = pgTable(
  'field_def',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    objectId: uuid('object_id')
      .notNull()
      .references(() => objectDef.id, { onDelete: 'cascade' }),
    key: text('key').notNull(), // API name, e.g. 'amount', 'renewal_date__c'
    // Physical column name (f_<sanitized key>) + Postgres type for this field in the
    // object's table, and whether it gets its own index. Set on insert.
    columnName: text('column_name').notNull().default(''),
    pgType: text('pg_type').notNull().default('text'),
    indexed: boolean('indexed').notNull().default(false),
    label: text('label').notNull(),
    type: text('type').$type<FieldType>().notNull(),
    config: jsonb('config').$type<FieldConfig>().notNull().default({}),
    required: boolean('required').notNull().default(false),
    unique: boolean('is_unique').notNull().default(false),
    isSystem: boolean('is_system').notNull().default(false),
    source: text('source').$type<DefSource>().notNull().default('custom'),
    orderIndex: integer('order_index').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    objKey: uniqueIndex('field_def_obj_key_uq').on(t.objectId, t.key),
  }),
);

// NOTE: record VALUES are no longer stored here. Per the fully-native data model
// (docs/architecture-plan.md §A0), each object gets its own physical table in the
// org's Postgres schema, with a real typed column per field. Those tables are
// created/altered at runtime by the DDL engine (src/dynamic/ddl.ts) and queried by
// the dynamic record layer (src/dynamic/records.ts) — not declared as Drizzle tables.

// Record types — per-object segmentation (SF RecordType). Each object table has a
// record_type_id system column pointing at one of these (soft reference).
export const recordType = pgTable(
  'record_type',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    objectId: uuid('object_id')
      .notNull()
      .references(() => objectDef.id, { onDelete: 'cascade' }),
    key: text('key').notNull(), // DeveloperName, e.g. 'lease_agreement'
    label: text('label').notNull(),
    isDefault: boolean('is_default').notNull().default(false),
    active: boolean('active').notNull().default(true),
    salesforceId: text('salesforce_id'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    objKey: uniqueIndex('record_type_obj_key_uq').on(t.objectId, t.key),
  }),
);

/* ────────────────────────────────────────────────────────────────────────────
   SALESFORCE MIGRATION / MAPPING
   ────────────────────────────────────────────────────────────────────────── */

export const salesforceConnection = pgTable('salesforce_connection', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  instanceUrl: text('instance_url').notNull(),
  status: text('status')
    .$type<'connected' | 'disconnected' | 'error'>()
    .notNull()
    .default('connected'),
  // OAuth tokens are stored encrypted (ciphertext only — never plaintext).
  accessTokenEnc: text('access_token_enc'),
  refreshTokenEnc: text('refresh_token_enc'),
  connectedBy: text('connected_by').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

// One migration job. Goes mapping → ready → running → completed/failed.
export const migrationRun = pgTable('migration_run', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  connectionId: uuid('connection_id')
    .notNull()
    .references(() => salesforceConnection.id, { onDelete: 'cascade' }),
  status: text('status')
    .$type<'mapping' | 'ready' | 'running' | 'completed' | 'failed'>()
    .notNull()
    .default('mapping'),
  stats: jsonb('stats')
    .$type<{
      objects?: number;
      fields?: number;
      records?: number;
      needsReview?: number;
      imported?: number;
      refsResolved?: number;
      currentObject?: string;
      error?: string;
    }>()
    .notNull()
    .default({}),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// SF object → Northbeam object_def. `action` decides map-to-existing / create-new / skip.
export const objectMapping = pgTable('object_mapping', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  runId: uuid('run_id')
    .notNull()
    .references(() => migrationRun.id, { onDelete: 'cascade' }),
  sfObject: text('sf_object').notNull(), // 'Account', 'Opportunity', 'Project__c'
  sfLabel: text('sf_label'),
  targetObjectId: uuid('target_object_id').references(() => objectDef.id, { onDelete: 'set null' }),
  action: text('action').$type<'map' | 'create' | 'skip'>().notNull().default('map'),
  recordCount: integer('record_count').notNull().default(0),
  // Mapper proposal for this object (target key/label/layout/record types/flags) —
  // field_defs/object_defs don't exist until execute, so the plan lives here.
  meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});

// SF field → Northbeam field_def, with optional value transform + auto-mapper confidence.
export const fieldMapping = pgTable('field_mapping', {
  id: uuid('id').defaultRandom().primaryKey(),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  objectMappingId: uuid('object_mapping_id')
    .notNull()
    .references(() => objectMapping.id, { onDelete: 'cascade' }),
  sfField: text('sf_field').notNull(),
  sfLabel: text('sf_label'),
  sfType: text('sf_type'),
  targetFieldId: uuid('target_field_id').references(() => fieldDef.id, { onDelete: 'set null' }),
  transform: jsonb('transform')
    .$type<{ valueMap?: Record<string, string>; expression?: string }>()
    .notNull()
    .default({}),
  confidence: integer('confidence').notNull().default(0), // 0–100 from the auto-mapper
  status: text('status').$type<'mapped' | 'review' | 'skip'>().notNull().default('review'),
  // Mapper proposal for this field (key/columnName/type/pgType/config/usage/reason).
  meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
