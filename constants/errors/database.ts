/**
 * @file constants/errors/database.ts
 * @description Database error message constants
 */
/**
 * Database and Storage Error Constants
 */

import type { ErrorCategory } from "./types.ts";

/**
 * Database and Storage Errors
 */
export const DATABASE_ERRORS = {
  CONNECTION_FAILED: {
    message: "Database connection failed",
    messageKey: "database.connection-failed",
    statusCode: 503,
  },
  QUERY_FAILED: {
    message: "Database query failed",
    messageKey: "database.query-failed",
    statusCode: 500,
  },
  TRANSACTION_FAILED: {
    message: "Database transaction failed",
    messageKey: "database.transaction-failed",
    statusCode: 500,
  },
  CONSTRAINT_VIOLATION: {
    message: "Database constraint violation",
    messageKey: "database.constraint-violation",
    statusCode: 409,
  },
  DUPLICATE_ENTRY: {
    message: "Duplicate entry detected",
    messageKey: "database.duplicate-entry",
    statusCode: 409,
  },
  MIGRATION_FAILED: {
    message: "Database migration failed",
    messageKey: "database.migration-failed",
    statusCode: 500,
  },
  BACKUP_FAILED: {
    message: "Database backup operation failed",
    messageKey: "database.backup-failed",
    statusCode: 500,
  },
  RESTORE_FAILED: {
    message: "Database restore operation failed",
    messageKey: "database.restore-failed",
    statusCode: 500,
  },
  POOL_EXHAUSTED: {
    message: "Database connection pool exhausted",
    messageKey: "database.pool-exhausted",
    statusCode: 503,
  },
  CREATE_WITH_RETRY_FAILED: {
    message: "Database create with retry failed",
    messageKey: "database.create-with-retry-failed",
    statusCode: 500,
  },
} as const satisfies ErrorCategory;

export type DatabaseErrorKey = keyof typeof DATABASE_ERRORS;
