/**
 * @file constants/documents/bulk-operations.ts
 * @description Bulk operation constraints
 *
 * Consolidates limits from validation schemas and services.
 * Ensures validation and business logic use the same limits.
 */

/**
 * Bulk operation constraints
 */
export const BULK_OPERATION_CONSTRAINTS = {
  // Document operations
  MIN_DOCUMENTS: 1,
  MAX_DOCUMENTS: 100,

  // Tag operations
  MIN_TAGS: 1,
  MAX_TAGS: 50,

  // User sharing
  MIN_USERS: 1,
  MAX_USERS: 100,

  // Folder operations
  MIN_FOLDERS: 1,
  MAX_FOLDERS: 100,
} as const;

/**
 * Bulk operation types enum
 */
export const BULK_OPERATION_TYPES = {
  DELETE: "delete",
  ARCHIVE: "archive",
  RESTORE: "restore",
  MOVE: "move",
  TAG_ASSIGN: "tag_assign",
  SHARE: "share",
} as const;
