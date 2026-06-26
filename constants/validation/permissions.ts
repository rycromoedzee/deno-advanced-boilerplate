/**
 * @file constants/validation/permissions.ts
 * @description Permission level constraints
 *
 * Provides centralized permission level definitions and validation ranges.
 */

/**
 * Permission level constraints for internal sharing (full permission range)
 */
export const PERMISSION_CONSTRAINTS = {
  // Internal sharing (full permission range)
  INTERNAL_MIN: 0,
  INTERNAL_MAX: 5,

  // Public sharing (restricted permission range)
  PUBLIC_MIN: 0,
  PUBLIC_MAX: 3,

  // Default permissions
  DEFAULT_READ_LEVEL: 0,
  DEFAULT_WRITE_LEVEL: 2,
  DEFAULT_ADMIN_LEVEL: 5,
} as const;

/**
 * Permission level enum (reference from config/db-enums.ts)
 */
export const PERMISSION_LEVELS = {
  READ: 0,
  COMMENT: 1,
  WRITE: 2,
  DOWNLOAD: 3,
  SHARE: 4,
  ADMIN: 5,
} as const;
