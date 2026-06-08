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
} from './field-types.js';
export { STANDARD_OBJECTS, seedStandardObjects } from './seed.js';
export {
  listObjects,
  getObjectByKey,
  listRecords,
  getRecord,
  createRecord,
  updateRecord,
  deleteRecord,
  resolveRefLabels,
  displayName,
  sanitizeData,
  type ObjectRow,
  type FieldRow,
  type RecordRow,
  type ObjectWithFields,
} from './queries/crm.js';
