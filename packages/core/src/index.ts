export { logger } from './logger.js';
export { NorthbeamError, type NorthbeamErrorCode } from './errors.js';
export { requires, may, requireSession, requireOrg, type AuthContext } from './auth.js';
export {
  ROLES,
  type Role,
  isRole,
  type Permission,
  PERMISSIONS,
  PERMISSION_GROUPS,
  type PermissionEntry,
  type PermissionGroup,
  ROLE_LABELS,
  ROLE_DESCRIPTIONS,
  can,
  meetsRole,
  rankOf,
} from './roles.js';
