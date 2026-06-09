# Plan — Northbeam: fully-native data model + in-app Salesforce migration + day-one platform

## Context

Northbeam is a Salesforce alternative with one-click migration. A metadata-driven core exists today —
`object_def` / `field_def` describe objects+fields, records live in a single `record` table with a JSONB
`data` document, plus generic record CRUD + list + detail UI and four seeded standard objects. The SF-mapping
tables (`salesforce_connection`, `migration_run`, `object_mapping`, `field_mapping`) and
`SF_TYPE_MAP`/`mapSalesforceType()` exist but have **zero engine** behind them; `/migrate` is static.

This plan does three things: (1) **re-platform the data layer from JSONB documents to a fully-native,
table-per-object model** (the user's explicit choice — real typed columns, runtime DDL); (2) build the **real
in-app Salesforce migration** (OAuth → describe → map → import); (3) build the **day-one platform features**
that make Northbeam a genuine SF replacement. **Planning deliverable** — implement in chunks (§D).

**Grounded in the real org** (`testOrg` = caleb@onqpm.com, via describe API):

| Object | Fields | Formulas | Refs | Picklists | Address | Record types |
|---|---|---|---|---|---|---|
| Account | 291 | 17 | 18 | 36 | 4 | 7 |
| Contact | 152 | 7 | 15 | 21 | 2 | – |
| Opportunity | 131 | 7 | 24 | 20 | – | 6 |
| Contract | 409 | **110** | 22 | 47 | 2 | 2 (Lease / Owner Agreement) |
| Property__c | 217 | 42 | 29 | 10 | – | – |

Also: `encryptedstring`, `address` compounds, dense references. The **On Q OS handoff** (`~/Downloads/OnQForce/`)
already implemented this feature surface (feed, audit, automation, approvals, record types, a `formula.js`
engine) and is the interaction/feature reference. Keep Northbeam's tokens + components (no visual change).

### Decisions locked with the user
- **Data model: fully-native, table-per-object, runtime DDL** (NOT JSONB; NOT generated-columns-for-all).
- **Formulas/rollups:** full native engine.
- **Record types:** supported (per-type layouts + record-type-scoped picklist values).
- **Field scope:** populated-threshold + all standard fields, via live describe + record counts (NOT the CSVs).
- **Owner/audit:** map SF `User` → member by email; carry `OwnerId`, `CreatedDate`, `CreatedById`.
- **Day-one set:** objects/fields/records + record types + Chatter feed + object history + flows/automation +
  approvals + file blobs + validation rules + roles & FLS.

---

## A0 — Data model: fully-native table-per-object (the foundation; reworks the JSONB core)

**Physical layout — schema-per-org (recommended).** Each org = a Postgres schema `org_<id>`; each object = a
real table in it (`org_x."account"`); each field = a typed column. Add a field → `ALTER TABLE … ADD COLUMN`
(nullable = metadata-only, fast in PG11+). Drop an org → `DROP SCHEMA … CASCADE`. Strong tenant isolation;
references become real same-schema FKs. (Alt: table-per-`(org,object)` with prefixed names in `public` — schema
-per-org is cleaner; flagged as adjustable.)

**DDL engine** `packages/db/src/dynamic/ddl.ts` — translates metadata → DDL, all transactional (object + its
fields created in one tx; Postgres DDL is transactional):
- `createObjectSchema(org)`, `createObjectTable(org, objectDef)`, `addField/alterField/dropField`,
  `dropObjectTable`, `ensureIndex`.
- **System columns** on every object table: `id uuid pk default gen_random_uuid()`, `owner_id uuid`,
  `record_type_id uuid`, `name text` (denorm display), `salesforce_id text unique`, `created_at`, `updated_at`,
  `created_by_id`. (org is implicit in the schema.)
- **Identifier safety:** store a deterministic safe `columnName` on `field_def` (sanitized SF API name,
  ≤63 bytes, unique per object, reserved-word-guarded) and `tableName` on `object_def`. Always quote identifiers.

**FieldType → Postgres type** (extends `SF_TYPE_MAP` with a `pgType`):
`text/textarea/email/phone/url`→`text`; `number`→`numeric`; `currency`→`numeric(18,2)`; `percent`→`numeric`;
`autonumber`→`bigint`+sequence; `date`→`date`; `datetime`→`timestamptz`; `checkbox`→`boolean`;
`picklist`→`text` (+ optional `CHECK`/restricted); `multipicklist`→`text[]` (native array, GIN-indexable);
`reference`→`uuid` FK to the target object's table (master-detail = `NOT NULL` + `ON DELETE CASCADE`);
`formula`/`rollup`→typed column populated by the engine (STORED generated column where the formula is pure-SQL-
expressible, else engine-written); `ai`→`text`. Constraints: `required`→`NOT NULL`, `unique`→`UNIQUE`.

**Dynamic query layer** `packages/db/src/dynamic/records.ts` — builds parameterized SQL (Drizzle `sql`
template) for list/get/create/update/delete/related/searchRefs against `schema."table"`. Coerces/validates
values by field type before binding; returns rows as `{columnName→value}` re-keyed to field keys via
`field_def`. **Filter/sort/aggregate run on native columns; references resolve via real JOINs.** Per-field
indexes via `field_def.indexed`; `name/owner_id/record_type_id/created_at` + `salesforce_id`-unique by default.

**What this REWORKS (the existing JSONB core, built earlier):**
- `packages/db/src/schema.ts`: **remove** the `record` JSONB table + its indexes; `object_def` gains
  `tableName`; `field_def` gains `columnName`, `pgType`, `indexed`.
- `packages/db/src/queries/crm.ts`: replace with the dynamic `ddl.ts` + `records.ts` engine.
- `packages/db/src/seed.ts`: `seedStandardObjects` now **creates the org schema + object tables + columns** then
  inserts via the dynamic layer.
- New migration drops `record`; the per-object tables are created at runtime, not by Drizzle migrations.

**What this PRESERVES (no rework):** the tRPC `record` router surface (list/get/create/update/related/searchRefs
still return `{data: {key: value}}`) and **all of apps/web** (`FieldInput`/`FieldValue`/`RecordView`/
`RecordListView`/`RecordFormDrawer`/layout) — they operate on `{key:value}` objects and don't care about storage.

**Caveats (flagged):** runtime DDL takes a brief `ACCESS EXCLUSIVE` lock (fine for create/import; brief for live
adds); schema-per-org means many tables at scale (Postgres handles thousands; catalog/relcache overhead is fine
at B2B tenant counts); 1600-column/table ceiling (Contract 409 is safe); type changes / `NOT NULL` adds on
populated tables need care; Drizzle can't statically type dynamic record rows → record rows are **runtime-typed**
via `field_def` (static Drizzle typing is retained for every fixed table below).

---

## A. Static schema (typed Drizzle tables in `public`) + per-object extensions

The metadata + all day-one feature tables are **fixed-shape typed Drizzle tables** in `public`. They reference a
record by a **soft `(object_id, record_id uuid)`** pair (no cross-schema FK into the dynamic object tables;
app-enforced) since record ids are globally-unique uuids.

### A1 — Record types
- `record_type` (public): `id, orgId, objectId→object_def, key (DeveloperName), label, isDefault, active, salesforceId`.
- Each object table gets the `record_type_id` system column (A0).
- `ObjectLayout` (field-types.ts): `sections[].recordTypes?: string[]` scoping; `FieldConfig.options[].availableFor?: string[]`
  (record-type-scoped picklist values).
- **SF map:** `describe.recordTypeInfos` + Tooling `RecordType` → `record_type`; record `RecordTypeId` → column.

### A2 — Field-model metadata (`field_def` / `FieldConfig`)
- `field_def` gains `columnName`, `pgType`, `indexed` (A0). `FieldConfig` gains `confidential` (FLS),
  `controllingField`+`valueMap` (dependent picklists), `encrypted`, `compoundKey`+`addressRole`, `defaultValue`, `restricted`.
- **Address compounds** → flattened into real subfield columns (`*_street/city/state/postal_code/country`) linked by `compoundKey`.
- **SF map:** describe attrs — `calculatedFormula`, `picklistValues`, `controllerName`, `referenceTo`, `encrypted`,
  `compoundFieldName`, `defaultValueFormula`, `restrictedPicklist`.

### A3 — Formula & rollup engine (new `packages/formula`)
- Parser + evaluator; function set ported/extended from On Q `~/Downloads/OnQForce/formula.js` (IF, CASE, AND/OR/NOT,
  ISBLANK, ROUND/ABS/MIN/MAX/MOD, TEXT/VALUE, LEN/LEFT/RIGHT/MID, UPPER/LOWER/CONTAINS/BEGINS, TODAY/NOW/DATE/YEAR/
  MONTH/DAY/DAYS, ISPICKVAL, cross-object refs). **SF→AST translation layer.** Rollups first, then formulas (multi-pass).
- Native storage: formula/rollup fields are typed columns **written by the engine** on create/update (and on child
  change for rollups); pure-SQL-expressible formulas may use Postgres `STORED GENERATED` columns.
- **Risk (flagged):** no snapshot fallback — a formula using an unsupported function surfaces as "needs review" in
  the mapping UI rather than importing wrong data. Contract's 110 formulas are the stress test.

### A4 — Chatter / feed
- `feed_post` (orgId, objectId, recordId, authorId, type post|call|email|text|note|system, body, payload jsonb,
  salesforceId, createdAt), `feed_comment`, `feed_reaction`, `feed_mention`.
- **SF map:** `FeedItem`→feed_post, `FeedComment`→feed_comment, `FeedLike`→reaction, `EmailMessage`→feed_post(email);
  @mentions via the user map (A10).

### A5 — Object history (audit)
- `record_history` (orgId, objectId, recordId, fieldKey, oldValue, newValue, changedById, source
  user|import|automation|salesforce, changedAt). Auto-logged in the dynamic update path (compares old/new column values).
- **SF map:** `<Object>History` / `<Object>FieldHistory` → record_history (where SF field-history tracking is on).

### A6 — Activities & tasks
- SF `Task`/`Event` → `activity` object records (seeded object), also surfaced in the feed timeline; extend `activity`
  with assignment/status/due fields; My-Day tasks reuse `activity`.

### A7 — Automation / flows
- `automation_rule` (orgId, objectId, name, trigger create|update|scheduled, conditions jsonb, actions jsonb
  [updateField|createTask|notify|email|assignOwner|createRecord], active, order, source native|salesforce),
  `automation_log`. Engine fires in the dynamic create/update path.
- **SF map:** simple `WorkflowRule`+field-update/task/email → auto-translated rule. `Flow`/ProcessBuilder/Apex →
  imported **read-only reference** (name/type/object/description) + flagged "manual rebuild" (no auto-translation of arbitrary logic).

### A8 — Approvals
- `approval_process` (objectId, name, entryCriteria, steps jsonb, active), `approval_request` (processId, recordId,
  status, submittedById, currentStep), `approval_decision` (requestId, step, approverId, decision, comment, decidedAt).
- **SF map:** `ProcessDefinition`/`ProcessInstance`/`ProcessInstanceStep`.

### A9 — Files
- `file` (orgId, objectId, recordId, name, mimeType, size, storageKey, uploadedById, salesforceId, createdAt).
  Blob storage: S3/R2 via `storageKey` + adapter (`packages/storage`) + env; local dev = MinIO/fs.
- **SF map:** `ContentVersion` (VersionData blob) + `ContentDocumentLink` (linkage), legacy `Attachment`.

### A10 — Users, roles, FLS
- `member` gains `salesforceUserId` (match SF `User` by email; unmatched → inactive external member, keep name).
  `crm_role` hierarchy (id, orgId, name, parentId). FLS via `FieldConfig.confidential` (+ optional `field_visibility` by role).
- **SF map:** `User`→member, `UserRole`→crm_role, `Profile`/`PermissionSet`→role + FLS.

### A11 — Validation rules
- `validation_rule` (objectId, name, condition (formula), errorMessage, errorField, active, source); enforced in the
  dynamic create/update path via the formula engine (A3).
- **SF map:** Tooling `ValidationRule` (`errorConditionFormula`→condition, `errorMessage`, `errorDisplayField`).

---

## B. Migration engine (`apps/api`, new `packages/salesforce`)
- **SF API client** `packages/salesforce` ({instanceUrl, accessToken}): `globalDescribe`, `describe(obj)`,
  `toolingQuery` (RecordType/ValidationRule/Flow), `query`/`queryMore` (paged SOQL), `downloadBlob`.
- **OAuth (web-server flow):** Hono routes `GET /api/salesforce/oauth/start` + `/callback` in `apps/api/src/index.ts`;
  Connected App → `SF_CLIENT_ID/SF_CLIENT_SECRET/SF_REDIRECT_URI` + `SF_TOKEN_KEY` (AES-GCM) in `lib/env.ts`; tokens
  stored **encrypted** in `salesforce_connection`. Callback resolves session/org via existing `getSession`.
  **Dev shortcut:** seed a connection from the `sf` CLI token to build/test the engine before the Connected App exists.
- **Pipeline:** connect → describe (global + per-object + Tooling) → auto-map (`mapSalesforceType`+pgType + record
  types + picklists + populated-threshold via SOQL `COUNT`) → **review UI** → **DDL: create org schema + object
  tables/columns** → import: paged SOQL → native typed INSERTs (by `salesforce_id`), resolve FKs after load, map
  owners/record types → then feed/history/files/approvals/automation/validation passes. `migration_run.stats` tracks counts.

## C. UI (`apps/web`, reuse existing components + tokens)
- **`/migrate`**: connect → mapping review (type/usage%/confidence) → run → live progress → summary (replaces static page).
- **Record page tabs** (`record-view.tsx`): add Activity (feed) / History / Files / Approvals.
- **Admin/setup** (port On Q `admin.jsx`/`adminx.jsx`/`layout-editor.jsx` + formula editor onto our components):
  object manager, field editor, record-type & layout editor, formula editor, automation builder, approval builder.

## D. Phasing (each chunk: migration generates + typecheck/lint/build green)
0. **Data-layer re-platform** — DDL engine + dynamic query layer; migrate `schema.ts`/`seed.ts`/`record` router off
   JSONB to table-per-object; verify Contacts list/detail/create still work unchanged. **← foundation, do first.**
1. `packages/salesforce` client + OAuth + encrypted connection (+ dev CLI-token shortcut).
2. Describe → object/field/record-type/picklist mapping + review UI + record import (DDL + native inserts, owner map, FKs). **← migration MVP**
3. Formula engine (`packages/formula`) + validation rules.
4. Object history + Chatter feed (+ record-page tabs).
5. Files (blobs + storage adapter).
6. Automation/flows (native + SF import/reference).
7. Approvals + roles/FLS.

## Verification
- Each chunk: `pnpm typecheck`, `pnpm lint`, `pnpm --filter @northbeam/web build`; Drizzle migration generates cleanly;
  DDL engine creates/alters tables in a scratch schema without error.
- End-to-end against `testOrg` via sf CLI/MCP: describe → map → DDL → import a small object (**Contact**) → spot-check
  a record's native columns, FK references, owner, record type, formula values, feed, history.
- Stress: import **Contract** (110 formulas, 2 record types, 409 cols) to exercise the formula engine, record-type
  layouts, and the column ceiling.
