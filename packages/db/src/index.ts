// Public entrypoint. Apps that need a db client call createDb(); apps that
// just need the schema (e.g. type imports) can use the schema export.
export * as schema from './schema.js';
export {
  assertRlsEnforced,
  createDb,
  withOrgContext,
  type Database,
  type DbExecutor,
  type DbTx,
} from './client.js';
export { ROLES, type Role, isRole } from './roles.js';
export {
  FIELD_TYPES,
  FIELD_TYPE_IDS,
  PICKABLE_FIELD_TYPES,
  fieldTypeMeta,
  isFieldTypeAvailable,
  mapSalesforceType,
  narrowFieldConfig,
  parsePolyRef,
  formatPolyRef,
  SF_TYPE_MAP,
  type PolyRef,
  type FieldType,
  type FieldStorage,
  type FieldConfig,
  type FieldConfigForType,
  type BaseFieldConfig,
  type TextFieldConfig,
  type NumberFieldConfig,
  type CurrencyFieldConfig,
  type DateFieldConfig,
  type CheckboxFieldConfig,
  type PicklistFieldConfig,
  type ReferenceFieldConfig,
  type FormulaFieldConfig,
  type RollupFieldConfig,
  type AiFieldConfig,
  type PicklistOption,
  type RollupFn,
  type ObjectLayout,
  type LayoutSection,
} from './field-types.js';
export {
  FieldConfigSchemas,
  PicklistOptionSchema,
  validateFieldConfig,
  safeValidateFieldConfig,
} from './field-config-schemas.js';
export { STANDARD_OBJECTS, seedStandardObjects } from './seed.js';
export { seedSampleRecords } from './sample-records.js';
// View types + saved-view queries.
export type {
  ViewType,
  ViewIcon,
  ShareTarget,
  ViewSort,
  Filter,
  FilterGroup,
  FilterEntry,
  FilterOp,
  FilterValue,
  FormatTone,
  FormatRule,
  ReportAgg,
  ReportHaving,
  ReportConfig,
  ReportChartType,
  DateGrain,
} from './views.js';
export { isFilterGroup } from './views.js';
// Relative-date filter tokens ('@today', '@-30d', …).
export {
  isRelativeDateToken,
  resolveRelativeDate,
  relativeDateLabel,
  RELATIVE_DATE_PRESETS,
} from './relative-date.js';
// Metadata key derivation + reserved-key guards.
export { keyFromLabel, KEY_RE, RESERVED_FIELD_KEYS } from './keys.js';
export {
  listViewsForUser,
  getHomeViewForUser,
  getView,
  getDefaultView,
  getDefaultDetailView,
  type ViewRow,
} from './queries/views.js';
// Metadata (object_def / field_def) queries.
export {
  listObjects,
  listObjectsWithFields,
  getObjectByKey,
  getObjectById,
  listRollupFields,
  displayName,
  sanitizeData,
  type ObjectRow,
  type FieldRow,
  type ObjectWithFields,
} from './queries/crm.js';
// Layout resolution (per-object, per-recordType, per-audience overrides).
export {
  resolveLayout,
  listLayouts,
  type LayoutRow,
} from './queries/layout.js';
// Per-record ACL — sharing rules on top of objectDef.defaultVisibility.
export {
  canEditRecord,
  editableRecordIds,
  grantShare,
  isAdminish,
  listSharesForRecord,
  revokeShare,
  visibleSharedRecordIds,
  type AccessLevel,
  type AclContext,
} from './queries/record-acl.js';
// Global picklist sets — CRUD, usage lookups, and the read-path option hydrator.
export {
  listGlobalPicklists,
  getGlobalPicklist,
  createGlobalPicklist,
  updateGlobalPicklist,
  deleteGlobalPicklist,
  globalPicklistUsedBy,
  globalPicklistUsageCounts,
  hydratePicklistOptions,
  type GlobalPicklistRow,
  type PicklistUsage,
} from './queries/picklists.js';
// Record types — per-object segmentation (SF RecordType) CRUD. Live counts +
// reassignment touch the per-org physical tables and live in dynamic/records.
export {
  listRecordTypes,
  getRecordType,
  createRecordType,
  updateRecordType,
  deleteRecordType,
  clearDefaultRecordType,
  type RecordTypeRow,
} from './queries/record-types.js';
// Record-write validation — pure required/rule checks + validation_rule CRUD.
export { requiredIssues, ruleIssues, type ValidationIssue } from './validation.js';
export {
  listValidationRules,
  getValidationRule,
  createValidationRule,
  updateValidationRule,
  deleteValidationRule,
  type ValidationRuleRow,
} from './queries/validation-rules.js';
// Formula engine — tokenize → parse → evaluate. The compute path also calls
// validateFormula at write time so a malformed expression can't reach storage.
export {
  evaluateFormula,
  evaluateAst,
  parseFormula,
  collectFieldKeys,
  supportedFunctionNames,
  tokenize,
  validateFormula,
  type AstNode,
  type EvalContext,
} from './formula/index.js';
// Native record CRUD (per-object physical tables).
export {
  listRecords,
  getRecord,
  countRecords,
  countByRecordType,
  reassignRecordType,
  sumField,
  createRecord,
  getOrCreateSingletonRecord,
  updateRecord,
  updateRecordOwner,
  deleteRecord,
  resolveRefLabels,
  labelsForIds,
  listRelated,
  listChildrenByRef,
  aclPredicate,
  type RecordRow,
  type RelatedGroup,
} from './dynamic/records.js';
export { aggregateChildField } from './dynamic/rollups.js';
// Report aggregation (group-by buckets over one object) + the type gates the
// routers validate against before building the query.
export {
  aggregateRecords,
  buildAggregateQuery,
  GROUPABLE_TYPES,
  DATE_GROUPABLE_TYPES,
  type AggregateBucket,
  type AggregateFn,
  type AggregateGrouping,
  type AggregateHaving,
  type AggregateOpts,
} from './dynamic/aggregate.js';
export { NUMERIC_TYPES, buildFilterPredicates } from './dynamic/filters-sql.js';
// One-hop reference traversal ("dot paths") for aggregate group-bys/filters.
export { planRefJoins, splitRefPath, type ResolvedRefPath } from './dynamic/ref-joins.js';
// QuerySpec compiler — the "almost raw SQL" declarative query engine.
export {
  buildQuery,
  collectQueryTargetKeys,
  resolveQuerySpec,
  runQuery,
  type QueryAcl,
  type QueryConditionLike,
  type QueryMeasureLike,
  type QueryRow,
  type QuerySpecLike,
  type ResolvedQueryPlan,
} from './dynamic/query-compiler.js';
// Compute orchestration — recompute formulas + rollups (topo-ordered) and the
// cross-object context builder the pure evaluator reads from.
export {
  recomputeRecord,
  recomputeAndPersist,
  recomputeParentRollups,
  recomputeObjectPage,
  ComputeError,
} from './compute/recompute.js';
export { buildComputeContext } from './compute/context.js';
// DDL engine + identifier/type helpers (used by seeding + the SF import engine).
export {
  ensureSchema,
  createObjectTable,
  addField,
  dropField,
  ensureFieldIndex,
  dropObjectTable,
  dropOrgSchema,
} from './dynamic/ddl.js';
export {
  orgSchema,
  objectTableName,
  fieldColumnName,
} from './dynamic/identifiers.js';
export { pgTypeFor, toDb, fromDb } from './dynamic/pgtypes.js';
export {
  bulkInsertRecords,
  resolveReferenceAnyBySfid,
  resolveReferencesBySfid,
  type ImportRow,
} from './dynamic/bulk.js';
// Salesforce connection persistence (ciphertext tokens only).
export {
  getConnection,
  upsertConnection,
  setConnectionStatus,
  rotateTokens,
  deleteConnection,
  type SalesforceConnectionRow,
  type ConnectionStatus,
} from './queries/salesforce.js';
// Roles & per-object permissions — custom roles + the CRUD grid storage.
export {
  seedRoles,
  listRoles,
  getRoleById,
  getRoleByKey,
  createRole,
  updateRole,
  deleteRole,
  listObjectPermissions,
  listObjectPermissionsWithKey,
  upsertObjectPermission,
  clearObjectPermission,
  countMembersWithRole,
  type RoleRow,
  type ObjectPermissionRow,
  type RoleSeedInput,
  type RoleUpdate,
  type Crud,
} from './queries/roles.js';
// Audit log — append-only event trail.
export {
  writeAuditEvent,
  listAuditEvents,
  type AuditEventRow,
  type AuditEventWithActor,
  type WriteAuditEventInput,
} from './queries/audit.js';

// AI composer sessions — personal threads with the dashboard composer.
export {
  listAiSessions,
  listSharedAiSessions,
  getAiSessionForUser,
  upsertAiSession,
  setAiSessionShare,
  deleteAiSession,
  type AiSessionRow,
  type AiSessionMessage,
  type UpsertAiSessionInput,
} from './queries/ai-sessions.js';
// AI agent presets — org-level agents (prompt + model/tool/role scoping).
export {
  listAiAgents,
  getAiAgent,
  createAiAgent,
  updateAiAgent,
  deleteAiAgent,
  seedSystemAgents,
  type AiAgentRow,
  type CreateAiAgentInput,
  type UpdateAiAgentInput,
} from './queries/ai-agents.js';
// AI tool policy (admin, per role) + per-user auto-approve preferences.
export {
  listAiToolPolicies,
  setAiToolPolicy,
  listAiToolPrefs,
  setAiToolPref,
} from './queries/ai-tools.js';
// Flow automation — jsonb column shapes (structural mirrors of the
// @northbeam/core flow contracts; db can't import core).
export type {
  FlowEdgeJson,
  FlowGraphJson,
  FlowNodeJson,
  FlowReferenceMeta,
  FlowRunContext,
  FlowRunStatus,
  FlowRunStepStatus,
  FlowRunTriggerType,
  FlowSource,
  FlowStatus,
  FlowTriggerJson,
  FlowTriggerType,
} from './schema.js';
// Flow metadata CRUD + activate-time version snapshots.
export {
  createFlow,
  getFlow,
  getFlowByKey,
  listFlows,
  listActiveFlowsForObject,
  listActiveScheduledFlows,
  updateFlow,
  deleteFlow,
  createFlowVersion,
  getFlowVersion,
  listFlowVersions,
  setActiveVersion,
  type FlowRow,
  type FlowVersionRow,
} from './queries/flows.js';
// Flow run lifecycle — outbox inserts, the claim gate, park/resume, steps,
// history, and the sweeper's cross-org scans.
export {
  createRuns,
  claimRun,
  parkRun,
  completeRun,
  failRun,
  cancelRun,
  heartbeatRun,
  insertStep,
  listRuns,
  getRunWithSteps,
  staleQueuedRuns,
  overdueWaitingRuns,
  staleRunningRuns,
  type FlowRunRow,
  type FlowRunStepRow,
  type NewFlowRunInput,
  type SweeperRunRef,
} from './queries/flow-runs.js';
// In-app notifications (topbar bell).
export {
  insertNotifications,
  listNotificationsForUser,
  unreadNotificationCount,
  markNotificationsRead,
  markAllNotificationsRead,
  type NewNotificationInput,
  type NotificationRow,
} from './queries/notifications.js';
