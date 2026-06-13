// Public entrypoint. Apps that need a db client call createDb(); apps that
// just need the schema (e.g. type imports) can use the schema export.
export * as schema from './schema.js';
export { createDb, type Database } from './client.js';
export { ROLES, type Role, isRole } from './roles.js';
export {
  FIELD_TYPES,
  FIELD_TYPE_IDS,
  fieldTypeMeta,
  mapSalesforceType,
  SF_TYPE_MAP,
  type FieldType,
  type FieldStorage,
  type FieldConfig,
  type PicklistOption,
  type RollupFn,
  type ObjectLayout,
  type LayoutSection,
} from './field-types.js';
export { STANDARD_OBJECTS, seedStandardObjects } from './seed.js';
// Metadata (object_def / field_def) queries.
export {
  listObjects,
  getObjectByKey,
  getObjectById,
  displayName,
  sanitizeData,
  type ObjectRow,
  type FieldRow,
  type ObjectWithFields,
} from './queries/crm.js';
// Native record CRUD (per-object physical tables).
export {
  listRecords,
  getRecord,
  createRecord,
  updateRecord,
  deleteRecord,
  resolveRefLabels,
  listRelated,
  type RecordRow,
  type RelatedGroup,
} from './dynamic/records.js';
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
