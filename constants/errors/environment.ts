/**
 * @file constants/errors/environment.ts
 * @description Environment error message constants
 */
import type { ErrorCategory } from "./types.ts";

export const ENVIRONMENT_ERRORS = {
  ALREADY_DEACTIVATED: {
    message: "Environment is already deactivated",
    messageKey: "environment.already-deactivated",
    statusCode: 409,
  },
  NOT_DEACTIVATED: {
    message: "Environment must be deactivated before destruction",
    messageKey: "environment.not-deactivated",
    statusCode: 409,
  },
  CONFIRMATION_MISMATCH: {
    message: "Confirmation does not match environment name",
    messageKey: "environment.confirmation-mismatch",
    statusCode: 400,
  },
  ALREADY_SUSPENDED: {
    message: "Environment is already suspended",
    messageKey: "environment.already-suspended",
    statusCode: 409,
  },
  NOT_SUSPENDED: {
    message: "Environment is not suspended",
    messageKey: "environment.not-suspended",
    statusCode: 409,
  },
  DEACTIVATED_NO_REACTIVATE: {
    message: "Deactivated environments cannot be reactivated",
    messageKey: "environment.deactivated-no-reactivate",
    statusCode: 409,
  },
  ALREADY_REGISTERED: {
    message: "Database already registered for this environment",
    messageKey: "environment.already-registered",
    statusCode: 409,
  },
  NO_DB: {
    message: "No database registered for this environment",
    messageKey: "environment.no-db",
    statusCode: 409,
  },
  NOT_PROVISIONING: {
    message: "Environment is not in provisioning state",
    messageKey: "environment.not-provisioning",
    statusCode: 409,
  },
  SUSPENDED: {
    message: "Environment is suspended",
    messageKey: "environment.suspended",
    statusCode: 503,
  },
  ADMIN_EXISTS: {
    message: "Admin user already exists for this environment",
    messageKey: "environment.admin-exists",
    statusCode: 409,
  },
  ALREADY_ACTIVE: {
    message: "Environment is already active",
    messageKey: "environment.already-active",
    statusCode: 409,
  },
  LOCAL_DB_EXISTS: {
    message: "Local database file already exists with this name",
    messageKey: "environment.local-db-exists",
    statusCode: 409,
  },
  FEATURE_DISABLED: {
    message: "This feature is not available for your environment",
    messageKey: "environment.feature-disabled",
    statusCode: 403,
  },
  QUOTA_EXCEEDED_USERS: {
    message: "User limit reached for this environment",
    messageKey: "environment.quota-exceeded-users",
    statusCode: 403,
  },
  QUOTA_EXCEEDED_STORAGE: {
    message: "Storage limit reached for this environment",
    messageKey: "environment.quota-exceeded-storage",
    statusCode: 403,
  },
  QUOTA_EXCEEDED_FILE_SIZE: {
    message: "File size exceeds the maximum allowed for this environment",
    messageKey: "environment.quota-exceeded-file-size",
    statusCode: 403,
  },
  NO_PRIMARY_ADMIN: {
    message: "No primary admin found for this environment",
    messageKey: "environment.no-primary-admin",
    statusCode: 404,
  },
} as const satisfies ErrorCategory;

export type EnvironmentErrorKey = keyof typeof ENVIRONMENT_ERRORS;
