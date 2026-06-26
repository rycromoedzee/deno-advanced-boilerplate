/**
 * @file constants/validation/numeric-limits.ts
 * @description Numeric constraints for validation schemas
 *
 * Provides centralized numeric limits to ensure consistency across the application.
 * These constraints define array sizes, file limits, and other numeric validations.
 */

/**
 * Numeric constraints for validation schemas
 */
export const NUMERIC_LIMITS = {
  // Array sizes
  MAX_TAGS_PER_DOCUMENT: 20,
  MAX_USERS_PER_SHARE: 100,
  MAX_USERS_PER_FOLDER_SHARE: 50,

  // IP/Domain restrictions
  MAX_IP_RESTRICTIONS: 10,
  MAX_DOMAIN_RESTRICTIONS: 10,

  // Folder constraints
  MAX_FOLDER_DEPTH: 10,

  // File upload
  MAX_FILE_SIZE_BYTES: 5 * 1024 * 1024 * 1024, // 5GB
  MAX_FILE_SIZE_GB: 5,
} as const;
