// Public entrypoint. Apps that need a db client call createDb(); apps that
// just need the schema (e.g. type imports) can use the schema export.
export * as schema from './schema.js';
export { createDb, type Database } from './client.js';
export { ROLES, type Role, isRole } from './roles.js';
