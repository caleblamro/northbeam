// Public entrypoint. Apps that need a db client call createDb(); apps that
// just need the schema (e.g. type imports) can use the schema export.
export * as schema from './schema.js';
export {
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
  SF_TYPE_MAP,
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
  FilterOp,
  FilterValue,
} from './views.js';
export {
  listViewsForUser,
  getView,
  getDefaultView,
  type ViewRow,
} from './queries/views.js';
// Metadata (object_def / field_def) queries.
export {
  listObjects,
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
  sumField,
  createRecord,
  updateRecord,
  deleteRecord,
  resolveRefLabels,
  listRelated,
  listChildrenByRef,
  type RecordRow,
  type RelatedGroup,
} from './dynamic/records.js';
export { aggregateChildField } from './dynamic/rollups.js';
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
  resolveReferencesBySfid,
  type ImportRow,
} from './dynamic/bulk.js';
// Salesforce connection persistence (ciphertext tokens only).
export {
  getConnection,
  upsertConnection,
  setConnectionStatus,
  deleteConnection,
  type SalesforceConnectionRow,
  type ConnectionStatus,
} from './queries/salesforce.js';
// Audit log — append-only event trail.
export {
  writeAuditEvent,
  listAuditEvents,
  type AuditEventRow,
  type AuditEventWithActor,
  type WriteAuditEventInput,
} from './queries/audit.js';
