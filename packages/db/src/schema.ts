import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import type { FieldConfig, FieldType, ObjectLayout, PicklistOption } from './field-types.js';
import type { Role } from './roles.js';
import type {
  Filter,
  FilterEntry,
  FormatRule,
  ShareTarget,
  ViewIcon,
  ViewSort,
  ViewType,
} from './views.js';

type DefSource = 'system' | 'custom' | 'salesforce' | 'ai';

/** RLS policy every org-scoped metadata table carries. `withOrgContext` sets
 *  the `app.org_id` GUC per-transaction; Postgres then filters rows to the
 *  caller's org even if a query forgets its `where organization_id = ?`.
 *  `current_setting(..., true)` returns NULL (deny-all) when the GUC is unset.
 *  Enforcement requires the runtime role to be a non-owner non-superuser —
 *  see drizzle/0010_rls_enforcement.sql and scripts/setup-app-role.ts.
 *  Policy names match the hand-written 0005/0006/0008 migrations so existing
 *  databases converge instead of duplicating. */
const orgIsolation = (policyName: string) =>
  pgPolicy(policyName, {
    for: 'all',
    using: sql`organization_id = current_setting('app.org_id', true)`,
    withCheck: sql`organization_id = current_setting('app.org_id', true)`,
  });

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
   ROLES & PERMISSIONS — Directus-style custom roles.

   A `member.role` is a role KEY (string) naming a row here. The four system
   roles (owner/admin/member/viewer) are seeded per-org from
   @northbeam/core's SYSTEM_ROLE_SEEDS; orgs can also create custom roles.
   Authorization has two axes: org-level actions (`orgPermissions`, a set of the
   non-record Permission keys) and per-object CRUD (a role `default*` grant plus
   `objectPermission` overrides). See packages/core/src/roles.ts.
   ──────────────────────────────────────────────────────────────────────── */
export const role = pgTable(
  'role',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    /** Stored on member.role. System keys are the 4 built-ins; custom roles get
     *  a slug. Unique per org. */
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    /** Optional chip color for the roles UI (hex). */
    color: text('color'),
    /** The 4 built-ins — not deletable; owner is additionally immutable. */
    isSystem: boolean('is_system').notNull().default(false),
    /** Ordering + owner semantics (owner=3…viewer=0; custom default 1). Not a
     *  permission inheritance rank — grants are explicit per role. */
    rank: integer('rank').notNull().default(1),
    /** Granted org-level actions — a subset of @northbeam/core Permission keys
     *  (the non-record ones). Record CRUD lives in the default* grant below. */
    orgPermissions: jsonb('org_permissions').$type<string[]>().notNull().default([]),
    /** Default per-object CRUD, applied to any object without an explicit
     *  objectPermission override. */
    defaultCreate: boolean('default_create').notNull().default(false),
    defaultRead: boolean('default_read').notNull().default(true),
    defaultUpdate: boolean('default_update').notNull().default(false),
    defaultDelete: boolean('default_delete').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('role_org_key_uq').on(t.organizationId, t.key),
    orgIsolation('role_org_isolation'),
  ],
);

/** Per-role, per-object CRUD override. Absent row → the role's default* grant. */
export const objectPermission = pgTable(
  'object_permission',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    roleId: uuid('role_id')
      .notNull()
      .references(() => role.id, { onDelete: 'cascade' }),
    objectId: uuid('object_id')
      .notNull()
      .references(() => objectDef.id, { onDelete: 'cascade' }),
    canCreate: boolean('can_create').notNull().default(false),
    canRead: boolean('can_read').notNull().default(false),
    canUpdate: boolean('can_update').notNull().default(false),
    canDelete: boolean('can_delete').notNull().default(false),
    /** Optional row-level (criteria) scope — a FilterEntry[] (same model as
     *  views/lists). When set, the role can only see/act on records of this
     *  object matching the filter, AND-ed into the ACL predicate at the
     *  RecordAccess chokepoint. Null/empty = all records of the type. Fields
     *  referenced here are auto-indexed on save so the predicate stays fast. */
    filter: jsonb('filter').$type<FilterEntry[]>(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('object_permission_role_object_uq').on(t.roleId, t.objectId),
    orgIsolation('object_permission_org_isolation'),
  ],
);

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
    // Conditional formatting — Filter[]-based rules evaluated client-side.
    // Object-global (unlike layout, which record-type/audience overrides can
    // replace), so a sibling column rather than a layout key.
    formatRules: jsonb('format_rules').$type<FormatRule[]>().notNull().default([]),
    // System objects are the standard four — present in every workspace, not deletable.
    isSystem: boolean('is_system').notNull().default(false),
    /** Singleton objects hold exactly one record (a config/settings record, à la
     *  Directus singletons). The UI opens straight to that record's edit form;
     *  it's get-or-created on first access. No list view, no record types. */
    isSingleton: boolean('is_singleton').notNull().default(false),
    source: text('source').$type<DefSource>().notNull().default('custom'),
    /** Soft-archive: hidden from pickers and blocked for writes, reads stay
     *  live. NULL = active. Hard delete exists only for custom objects. */
    archivedAt: timestamp('archived_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('object_def_org_key_uq').on(t.organizationId, t.key),
    orgIsolation('object_def_org_isolation'),
  ],
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
  (t) => [
    uniqueIndex('field_def_obj_key_uq').on(t.objectId, t.key),
    orgIsolation('field_def_org_isolation'),
  ],
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
  (t) => [
    uniqueIndex('record_type_obj_key_uq').on(t.objectId, t.key),
    orgIsolation('record_type_org_isolation'),
  ],
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
  (t) => [
    uniqueIndex('layout_def_obj_rt_audience_name_uq').on(
      t.objectId,
      t.recordTypeId,
      t.audience,
      t.name,
    ),
    orgIsolation('layout_def_org_isolation'),
  ],
);

// Global picklist sets (SF Global Value Sets) — one shared option list many
// picklist fields can draw from. A field opts in via config.globalPicklistId;
// options are hydrated server-side at read time (reference-at-read), so
// editing a set updates every assigned field with a single row write.
export const globalPicklist = pgTable(
  'global_picklist',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    values: jsonb('values').$type<PicklistOption[]>().notNull().default([]),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('global_picklist_org_name_uq').on(t.organizationId, t.name),
    orgIsolation('global_picklist_org_isolation'),
  ],
);

// Validation rules — per-object Northbeam formula conditions that BLOCK a save
// when they evaluate truthy (Salesforce semantics). Enforced in the record
// write path (record.create/update/bulkCreate); the SF importer bypasses them.
export const validationRule = pgTable(
  'validation_rule',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    objectId: uuid('object_id')
      .notNull()
      .references(() => objectDef.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // Northbeam formula (src/formula/) evaluated against the record's data.
    condition: text('condition').notNull(),
    errorMessage: text('error_message').notNull(),
    /** Field key the error anchors to in the form. NULL = record-level. */
    errorFieldKey: text('error_field_key'),
    active: boolean('active').notNull().default(true),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('validation_rule_obj_name_uq').on(t.objectId, t.name),
    orgIsolation('validation_rule_org_isolation'),
  ],
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
  (t) => [
    uniqueIndex('record_share_unique').on(t.objectId, t.recordId, t.userId),
    orgIsolation('record_share_org_isolation'),
  ],
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
    // null = workspace-scoped view (not attached to any object) — the user's
    // customizable Home page is the first of these (key 'home'). Postgres
    // treats NULLs as distinct in the unique index below, so each user can
    // own their own workspace view under the same key.
    objectId: uuid('object_id').references(() => objectDef.id, { onDelete: 'cascade' }),
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
  (t) => [
    uniqueIndex('view_org_object_key_uq').on(t.organizationId, t.objectId, t.key),
    orgIsolation('view_org_isolation'),
  ],
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
  (t) => [
    uniqueIndex('audit_log_org_created_idx').on(t.organizationId, t.createdAt),
    orgIsolation('audit_log_org_isolation'),
  ],
);

/* ────────────────────────────────────────────────────────────────────────────
   AI AGENTS — org-level agent presets the composer runs as. Each row bundles a
   system prompt with scoping knobs: which models it may run on, which AI tools
   it exposes (intersected with the caller's effective tools), and which roles
   may use it. One system agent ('composer') is seeded per org; admins add more.
   ────────────────────────────────────────────────────────────────────────── */
export const aiAgent = pgTable(
  'ai_agent',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    /** Slug, unique per org (e.g. 'composer', 'pipeline-analyst'). */
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    /** Prepended to the composer's base prompt. Empty for the system agent —
     *  the API layer supplies the composer behavior. */
    systemPrompt: text('system_prompt').notNull().default(''),
    /** Model ids (see @northbeam/core AVAILABLE_AI_MODELS) the agent may run
     *  on. Empty = the org default model only. */
    models: jsonb('models').$type<string[]>().notNull().default([]),
    /** AI tool ids the agent exposes. null = all of the caller's effective
     *  tools; non-null = intersection with the caller's effective tools. */
    toolIds: jsonb('tool_ids').$type<string[] | null>().default(null),
    /** Role keys allowed to use the agent. null = every role. */
    roleKeys: jsonb('role_keys').$type<string[] | null>().default(null),
    /** Seeded agents — not deletable, key is stable. */
    isSystem: boolean('is_system').notNull().default(false),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('ai_agent_org_key_uq').on(t.organizationId, t.key),
    orgIsolation('ai_agent_org_isolation'),
  ],
);

/* ────────────────────────────────────────────────────────────────────────────
   AI COMPOSER SESSIONS — a user's conversations with the dashboard composer.
   Personal by default: each row is one thread — the messages, the latest
   composed artifact, and the target object — so a user can reopen the drawer
   and pick up where they left off. `sharedWith` opt-in shares a thread
   (read-only) with the org / a role / specific users. Saving a dashboard
   still goes through the `view` table; sessions are the working drafts.
   ────────────────────────────────────────────────────────────────────────── */

/** One chat turn persisted on an aiSession row. Mirrors the composer's
 *  in-memory shape minus transient flags (pending). Discriminated on `kind`;
 *  legacy rows predate the field, so no `kind` means a text turn. */
export type AiSessionMessage =
  | {
      kind?: 'text';
      role: 'user' | 'assistant';
      content: string;
      /** Repair-pass notes attached to an assistant turn. */
      repairs?: string[];
    }
  | {
      kind: 'tool';
      toolId: string;
      title: string;
      status: 'done' | 'denied' | 'error';
      inputSummary?: string;
      resultSummary?: string;
    }
  | { kind: 'artifact'; note?: string };

export const aiSession = pgTable(
  'ai_session',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** Object key the session composes against ('deal', 'account', …). */
    objectKey: text('object_key').notNull(),
    /** Agent preset the thread runs as. Null = the default composer. */
    agentId: uuid('agent_id').references(() => aiAgent.id, { onDelete: 'set null' }),
    /** Model id picked for the thread. Null = the org default model. */
    model: text('model'),
    /** Read-only shares — same ShareTarget vocabulary as saved views. */
    sharedWith: jsonb('shared_with').$type<ShareTarget[]>().notNull().default([]),
    /** First user prompt, trimmed — the list label. */
    title: text('title').notNull(),
    messages: jsonb('messages').$type<AiSessionMessage[]>().notNull().default([]),
    /** Latest composed artifact tree (config.artifact shape), null before the
     *  first completed generation. */
    artifact: jsonb('artifact').$type<unknown>(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('ai_session_owner_recency_idx').on(t.organizationId, t.userId, t.updatedAt),
    orgIsolation('ai_session_org_isolation'),
  ],
);

/** Admin policy: which AI tools a role may use (per-org override rows over
 *  the code defaults in @northbeam/core/ai-tools — read tools default
 *  allowed, write tools admin-only). Keyed by role KEY, not role id, so
 *  policy survives the static-matrix fallback for roles without a row. */
export const aiToolPolicy = pgTable(
  'ai_tool_policy',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    roleKey: text('role_key').notNull(),
    toolId: text('tool_id').notNull(),
    allowed: boolean('allowed').notNull(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('ai_tool_policy_uq').on(t.organizationId, t.roleKey, t.toolId),
    orgIsolation('ai_tool_policy_org_isolation'),
  ],
);

/** Per-user friction setting: an ALLOWED tool either runs automatically or
 *  pauses generation for an in-thread approval. Missing row = the tool-kind
 *  default (read auto-approves, write asks). */
export const aiToolPref = pgTable(
  'ai_tool_pref',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    toolId: text('tool_id').notNull(),
    autoApprove: boolean('auto_approve').notNull(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('ai_tool_pref_uq').on(t.organizationId, t.userId, t.toolId),
    orgIsolation('ai_tool_pref_org_isolation'),
  ],
);

/* ────────────────────────────────────────────────────────────────────────────
   SALESFORCE MIGRATION / MAPPING
   ────────────────────────────────────────────────────────────────────────── */

export const salesforceConnection = pgTable(
  'salesforce_connection',
  {
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
    // Two-way sync gates. Both default OFF: write-back mutates the customer's
    // Salesforce org and polling consumes API quota — enabling either is an
    // explicit admin decision per workspace.
    writebackEnabled: boolean('writeback_enabled').notNull().default(false),
    pollEnabled: boolean('poll_enabled').notNull().default(false),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  () => [orgIsolation('salesforce_connection_org_isolation')],
);

/** Write-back outbox: one row per record with un-synced local edits. dirtyKeys
 *  is the UNION of field keys changed since the last successful push, so rapid
 *  edits coalesce into one PATCH and a worker retry never loses keys. Rows are
 *  written inside the mutating transaction (atomic with the edit) and cleared
 *  by the sync worker after Salesforce accepts the write. */
export const sfSyncOutbox = pgTable(
  'sf_sync_outbox',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    objectKey: text('object_key').notNull(),
    recordId: uuid('record_id').notNull(),
    dirtyKeys: jsonb('dirty_keys').$type<string[]>().notNull().default([]),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique('sf_sync_outbox_record').on(t.organizationId, t.objectKey, t.recordId),
    orgIsolation('sf_sync_outbox_org_isolation'),
  ],
);

/** Poll cursor: high-water SystemModstamp per imported object. The poller only
 *  pulls changes for records that already exist locally (subtree discipline);
 *  the cursor bounds the modstamp probe so steady-state polls are one cheap
 *  id+modstamp SOQL per object. */
export const sfSyncCursor = pgTable(
  'sf_sync_cursor',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    objectKey: text('object_key').notNull(),
    sfObject: text('sf_object').notNull(),
    /** ISO SystemModstamp of the newest change applied (or probed past). */
    lastModstamp: text('last_modstamp').notNull(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    unique('sf_sync_cursor_object').on(t.organizationId, t.objectKey),
    orgIsolation('sf_sync_cursor_org_isolation'),
  ],
);

// One migration job. Goes mapping → ready → running → completed/failed.
export const migrationRun = pgTable(
  'migration_run',
  {
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
        // Report/dashboard import phase (import-views.ts) — best-effort, so it
        // carries its own error slot instead of failing the run.
        reportsFound?: number;
        reportsImported?: number;
        dashboardsFound?: number;
        dashboardsImported?: number;
        viewsSkipped?: number;
        reportsError?: string;
        skippedViews?: Array<{ label: string; reason: string }>;
        // Targeted (scoped) runs: crawl telemetry.
        crawlRounds?: number;
        crawlIds?: number;
        // Automation import phase (import-flows.ts) — same best-effort
        // contract: its own error slot, never fails the run.
        flowsFound?: number;
        flowsTranslated?: number;
        /** Reference rows (needs_rebuild) across flows, workflow rules, and
         *  apex triggers — the "rebuild manually" count. */
        flowsReferenced?: number;
        workflowRulesFound?: number;
        workflowRulesTranslated?: number;
        automationsSkipped?: number;
        skippedAutomations?: Array<{ label: string; reason: string }>;
        automationsError?: string;
      }>()
      .notNull()
      .default({}),
    // Targeted import: restrict the record phase to the relationship subtree
    // reachable from these root records (config/DDL still applies to every
    // mapped object). Null = unscoped run (MAX_RECORDS_PER_OBJECT sample).
    scope: jsonb('scope').$type<{
      kind: 'subtree';
      rootSfObject: string;
      rootSfIds: string[];
      label?: string;
    } | null>(),
    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  () => [orgIsolation('migration_run_org_isolation')],
);

// SF object → Northbeam object_def. `action` decides map-to-existing / create-new / skip.
export const objectMapping = pgTable(
  'object_mapping',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    runId: uuid('run_id')
      .notNull()
      .references(() => migrationRun.id, { onDelete: 'cascade' }),
    sfObject: text('sf_object').notNull(), // 'Account', 'Opportunity', 'Project__c'
    sfLabel: text('sf_label'),
    targetObjectId: uuid('target_object_id').references(() => objectDef.id, {
      onDelete: 'set null',
    }),
    action: text('action').$type<'map' | 'create' | 'skip'>().notNull().default('map'),
    recordCount: integer('record_count').notNull().default(0),
    // Mapper proposal for this object (target key/label/layout/record types/flags) —
    // field_defs/object_defs don't exist until execute, so the plan lives here.
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  () => [orgIsolation('object_mapping_org_isolation')],
);

// SF field → Northbeam field_def, with optional value transform + auto-mapper confidence.
export const fieldMapping = pgTable(
  'field_mapping',
  {
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
  },
  () => [orgIsolation('field_mapping_org_isolation')],
);

/* ────────────────────────────────────────────────────────────────────────────
   FLOW AUTOMATION — visual flow engine (docs plan: noble-watching-allen).
   Trigger/graph documents are authored + validated against the zod contracts
   in @northbeam/core (flow.ts). db CANNOT import core (core already depends
   on db), so the jsonb columns are $type'd to the loose structural mirrors
   below — core's schemas remain the source of truth and the API layer parses
   before every write.
   ────────────────────────────────────────────────────────────────────────── */

/** Structural mirror of core's FlowNode. `config` widens the per-type
 *  discriminated configs to a plain object — enough for typed storage. */
export type FlowNodeJson = {
  id: string;
  type: string;
  config: Record<string, unknown>;
  name?: string;
  description?: string;
};

/** Structural mirror of core's FlowTrigger (the 3 trigger node types). */
export type FlowTriggerJson = FlowNodeJson & {
  type: 'trigger_record' | 'trigger_scheduled' | 'trigger_webhook';
};

/** Structural mirror of core's FlowEdge. `sourceHandle` is a decision
 *  outcome id, 'default', or 'body'/'done' on loop nodes. */
export type FlowEdgeJson = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
};

/** Structural mirror of core's FlowGraph. */
export type FlowGraphJson = {
  nodes: FlowNodeJson[];
  edges: FlowEdgeJson[];
};

/** Read-only payload for Salesforce automations we could not translate —
 *  the flow row is a "rebuild manually" reference (status needs_rebuild). */
export type FlowReferenceMeta = {
  sfId: string;
  apiName: string;
  sfType: 'flow' | 'process-builder' | 'workflow-rule' | 'apex-trigger';
  sfObject?: string;
  description?: string;
  activeInSf: boolean;
  reason: string;
};

export type FlowStatus = 'draft' | 'active' | 'paused' | 'needs_rebuild';
export type FlowSource = 'native' | 'salesforce';
export type FlowTriggerType = FlowTriggerJson['type'];

export type FlowRunStatus = 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';

export type FlowRunTriggerType =
  | 'record_created'
  | 'record_updated'
  | 'record_deleted'
  | 'scheduled'
  | 'webhook'
  | 'test';

/** Serialized engine state — everything the walker needs to resume a parked
 *  run. Shapes are engine-owned (apps/api/src/automation); storage stays
 *  permissive so engine iterations don't need schema changes. */
export type FlowRunContext = {
  record?: Record<string, unknown>;
  oldRecord?: Record<string, unknown>;
  changedKeys?: string[];
  vars?: Record<string, unknown>;
  loopFrames?: unknown[];
  cursorNodeId?: string;
  actorUserId?: string | null;
  webhookBody?: unknown;
};

export type FlowRunStepStatus = 'completed' | 'failed' | 'skipped';

// An automation flow. Draft trigger/graph live here (edited in place); the
// engine only ever executes the snapshot referenced by activeVersionId.
// `activeTrigger`/`activeTriggerType` are denormalized copies of the active
// version's trigger, written by setActiveVersion — the dispatcher matches
// flows on the hot path without joining flow_version or parsing graphs.
export const flow = pgTable(
  'flow',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    /** NULL = global flow (scheduled/webhook triggers) or an SF reference on
     *  a non-imported object. */
    objectId: uuid('object_id').references(() => objectDef.id, { onDelete: 'cascade' }),
    /** Slug-style API name. Unique per org — SF import idempotency
     *  (onConflictDoNothing) depends on it. */
    key: text('key').notNull(),
    name: text('name').notNull(),
    description: text('description'),
    status: text('status').$type<FlowStatus>().notNull().default('draft'),
    source: text('source').$type<FlowSource>().notNull().default('native'),
    salesforceId: text('salesforce_id'),
    referenceMeta: jsonb('reference_meta').$type<FlowReferenceMeta>(),
    /** Editable working copy. NULL only for needs_rebuild references. */
    draftTrigger: jsonb('draft_trigger').$type<FlowTriggerJson>(),
    draftGraph: jsonb('draft_graph').$type<FlowGraphJson>(),
    /** Soft pointer into flow_version (no FK — the tables reference each
     *  other; version rows already cascade via their own flowId FK). */
    activeVersionId: uuid('active_version_id'),
    activeTrigger: jsonb('active_trigger').$type<FlowTriggerJson>(),
    /** Denormalized activeTrigger.type so schedule/webhook lookups filter on
     *  a plain column instead of a jsonb path. */
    activeTriggerType: text('active_trigger_type').$type<FlowTriggerType>(),
    /** HMAC secret for trigger_webhook flows. */
    webhookSecret: text('webhook_secret'),
    createdById: text('created_by_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('flow_org_key_uq').on(t.organizationId, t.key),
    index('flow_org_object_status_idx').on(t.organizationId, t.objectId, t.status),
    orgIsolation('flow_org_isolation'),
  ],
);

// Immutable snapshot taken at activate time. Runs pin the version they
// executed so history stays truthful after later edits.
export const flowVersion = pgTable(
  'flow_version',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    flowId: uuid('flow_id')
      .notNull()
      .references(() => flow.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    trigger: jsonb('trigger').$type<FlowTriggerJson>().notNull(),
    graph: jsonb('graph').$type<FlowGraphJson>().notNull(),
    createdById: text('created_by_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('flow_version_flow_version_uq').on(t.flowId, t.version),
    orgIsolation('flow_version_org_isolation'),
  ],
);

// One execution. Inserted `queued` inside the triggering transaction (outbox
// pattern); a worker claims it with the status-guarded UPDATE in
// queries/flow-runs.ts — that claim is the sole idempotency gate. Run rows +
// their steps ARE the automation log (auditLog gets lifecycle events only).
export const flowRun = pgTable(
  'flow_run',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    flowId: uuid('flow_id')
      .notNull()
      .references(() => flow.id, { onDelete: 'cascade' }),
    flowVersionId: uuid('flow_version_id')
      .notNull()
      .references(() => flowVersion.id, { onDelete: 'cascade' }),
    triggerType: text('trigger_type').$type<FlowRunTriggerType>().notNull(),
    /** Kept on object delete — run history outlives the object. */
    objectId: uuid('object_id').references(() => objectDef.id, { onDelete: 'set null' }),
    /** Soft pointer into the org's dynamic schema (org_<id>.t_<key>). */
    recordId: uuid('record_id'),
    status: text('status').$type<FlowRunStatus>().notNull().default('queued'),
    context: jsonb('context').$type<FlowRunContext>().notNull().default({}),
    /** Flows-triggering-flows recursion counter; dispatch skips at maxDepth. */
    depth: integer('depth').notNull().default(0),
    triggeredByRunId: uuid('triggered_by_run_id').references((): AnyPgColumn => flowRun.id, {
      onDelete: 'set null',
    }),
    /** `waiting` runs: when the sweeper should resume them (NULL = a delayed
     *  job owns the wake-up exclusively). */
    resumeAt: timestamp('resume_at'),
    /** One-shot claim token — resume paths race the sweeper, so claims match
     *  on it (WHERE status='waiting' AND resume_token = ?). */
    resumeToken: text('resume_token'),
    stepCount: integer('step_count').notNull().default(0),
    error: text('error'),
    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    /** Doubles as the worker heartbeat — the sweeper fails `running` runs
     *  whose updatedAt has gone stale. */
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('flow_run_org_created_idx').on(t.organizationId, t.createdAt),
    index('flow_run_flow_created_idx').on(t.flowId, t.createdAt),
    // Partial index for the sweeper's stale-queued / overdue-waiting scans —
    // terminal rows dominate the table and never match.
    index('flow_run_sweeper_idx')
      .on(t.status, t.createdAt)
      .where(sql`status in ('queued', 'waiting')`),
    orgIsolation('flow_run_org_isolation'),
  ],
);

// Per-node execution trace. `stepIndex` is assigned by insertStep from the
// run's stepCount so ordering is deterministic (startedAt can tie).
export const flowRunStep = pgTable(
  'flow_run_step',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    runId: uuid('run_id')
      .notNull()
      .references(() => flowRun.id, { onDelete: 'cascade' }),
    stepIndex: integer('step_index').notNull().default(0),
    nodeId: text('node_id').notNull(),
    /** A core FlowNodeType literal — stored as text (contract lives in core). */
    nodeType: text('node_type').notNull(),
    status: text('status').$type<FlowRunStepStatus>().notNull(),
    /** Small human-readable result payload (executors cap it at ~8KB). */
    summary: jsonb('summary').$type<Record<string, unknown>>().notNull().default({}),
    error: text('error'),
    startedAt: timestamp('started_at').notNull().defaultNow(),
    durationMs: integer('duration_ms').notNull().default(0),
  },
  (t) => [
    index('flow_run_step_run_idx').on(t.runId, t.stepIndex),
    orgIsolation('flow_run_step_org_isolation'),
  ],
);

/* ────────────────────────────────────────────────────────────────────────────
   IN-APP NOTIFICATIONS — written by the flow engine's `notify` node (and any
   future producer); surfaced by the topbar bell. readAt NULL = unread.
   ────────────────────────────────────────────────────────────────────────── */
export const notification = pgTable(
  'notification',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    body: text('body'),
    /** In-app deep link (path), e.g. '/o/deal/r/<id>'. */
    link: text('link'),
    readAt: timestamp('read_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('notification_user_org_created_idx').on(t.userId, t.organizationId, t.createdAt),
    orgIsolation('notification_org_isolation'),
  ],
);
