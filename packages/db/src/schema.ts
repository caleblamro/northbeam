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
import type { Filter, ShareTarget, ViewIcon, ViewSort, ViewType } from './views.js';

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
    /** Default record-level visibility for the object. `public` (the v1
     *  default) means every workspace member can read every record; `private`
     *  means only the owner + explicit shares (recordShare) + admins+ can
     *  read. The dynamic-record listRecords/getRecord apply the filter. */
    defaultVisibility: text('default_visibility')
      .$type<'public' | 'private'>()
      .notNull()
      .default('public'),
    // The "default-default" layout. Overridden by matching rows in layoutDef
    // (per record type / per audience) — see resolveLayout in queries/layout.ts.
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

// Layout overrides — extracted from objectDef.layout (which becomes the
// fallback / default-default). One row per (object, optional recordType,
// optional audience) combination. The resolver picks the most specific match
// for a request; misses fall back to objectDef.layout. Audience is a free-form
// scope key — 'owner', 'admin', a role name, or a custom segment — so a future
// "compact mobile" layout or "sales-team accounts view" slots in without
// schema changes.
export const layoutDef = pgTable(
  'layout_def',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    objectId: uuid('object_id')
      .notNull()
      .references(() => objectDef.id, { onDelete: 'cascade' }),
    /** NULL = applies to every record type on the object. */
    recordTypeId: uuid('record_type_id').references(() => recordType.id, {
      onDelete: 'cascade',
    }),
    /** NULL = applies to every audience. */
    audience: text('audience'),
    name: text('name').notNull(),
    layout: jsonb('layout').$type<ObjectLayout>().notNull().default({}),
    /** Marks the row resolveLayout picks within an (object, recordType,
     *  audience) bucket when multiple rows exist. Most installs have one. */
    isDefault: boolean('is_default').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    objKey: uniqueIndex('layout_def_obj_rt_audience_name_uq').on(
      t.objectId,
      t.recordTypeId,
      t.audience,
      t.name,
    ),
  }),
);

/* ────────────────────────────────────────────────────────────────────────────
   PER-RECORD ACL — minimal sharing-rule surface
   ────────────────────────────────────────────────────────────────────────── */

/** A grant of access to a specific record for a specific user. The record
 *  itself lives in the org's dynamic schema (org_<id>.t_<key>), so this row
 *  carries the soft (object, recordId) pointer instead of a real FK. The
 *  level is conventional: 'read' | 'edit'. */
export const recordShare = pgTable(
  'record_share',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    objectId: uuid('object_id')
      .notNull()
      .references(() => objectDef.id, { onDelete: 'cascade' }),
    recordId: uuid('record_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    level: text('level').$type<'read' | 'edit'>().notNull().default('read'),
    grantedBy: text('granted_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    uniq: uniqueIndex('record_share_unique').on(t.objectId, t.recordId, t.userId),
  }),
);

/* ────────────────────────────────────────────────────────────────────────────
   VIEWS — saved view configurations for any object. A view is a row, not URL
   state: it carries a renderer type ('list' | 'grid' | 'kanban' | ...), the
   type-specific config, and shared filter / sort / columns slots that every
   renderer respects so users can flip view types without losing their query.

   Sharing is dynamic — `sharedWith` is an array of ShareTarget so a view can
   be org-wide, role-scoped, or directly shared with specific users. Owner
   always sees their own views; null `ownerId` means "system / org-seeded"
   (the default views every org gets per object).
   ────────────────────────────────────────────────────────────────────────── */
export const view = pgTable(
  'view',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    objectId: uuid('object_id')
      .notNull()
      .references(() => objectDef.id, { onDelete: 'cascade' }),
    key: text('key').notNull(), // slug-style, unique per (org, object)
    label: text('label').notNull(),
    type: text('type').$type<ViewType>().notNull().default('list'),
    // Type-specific config. JSON-encoded so adding a new renderer doesn't
    // need a schema change. Each renderer ships its own Zod schema and
    // validates the column at write time.
    config: jsonb('config').$type<unknown>().notNull().default({}),
    // Top-level so every renderer shares the same filter / sort / columns
    // contract — flipping view types carries them across.
    filters: jsonb('filters').$type<Filter[]>().notNull().default([]),
    sort: jsonb('sort').$type<ViewSort[]>().notNull().default([]),
    columns: jsonb('columns').$type<string[]>().notNull().default([]),
    // Visibility. See ShareTarget in views.ts for the kinds. A user sees a
    // view when they're the owner OR the array contains {org} OR matches
    // their role OR includes their user id.
    sharedWith: jsonb('shared_with').$type<ShareTarget[]>().notNull().default([]),
    /** Lucide-equivalent icon shown in the view picker. Pick from the
     *  curated `ViewIcon` set in views.ts so the picker stays cohesive. */
    icon: text('icon').$type<ViewIcon>().notNull().default('list'),
    // null = system-seeded default, otherwise the user who created the view.
    ownerId: text('owner_id').references(() => user.id, { onDelete: 'set null' }),
    // Default view for (object, type). The dispatcher lands on this when the
    // URL doesn't specify a `?view=…`.
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => ({
    orgObjectKey: uniqueIndex('view_org_object_key_uq').on(
      t.organizationId,
      t.objectId,
      t.key,
    ),
  }),
);

/* ────────────────────────────────────────────────────────────────────────────
   AUDIT LOG — append-only trail of every mutating action across the org.
   Every mutation that changes user-visible state calls writeAuditEvent
   (see packages/db/src/queries/audit.ts). The Setup → Audit Log page
   surfaces it; admins answer "who did that and when?" without leaving the app.
   ────────────────────────────────────────────────────────────────────────── */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    /** Acting user. Nullable for system / cron events. */
    userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
    /** Dot-notation action key, e.g. 'record.created', 'view.deleted',
     *  'object.layout.updated', 'ai.generated'. Stored verbatim — the UI
     *  knows how to pretty-print known prefixes. */
    action: text('action').notNull(),
    /** What the action affected. Combine with targetId for a stable
     *  primary-key-ish reference back to the affected row. */
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    /** Free-form context (record name, diff summary, etc.). */
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    ip: text('ip'),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => ({
    orgTime: uniqueIndex('audit_log_org_created_idx').on(t.organizationId, t.createdAt),
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
