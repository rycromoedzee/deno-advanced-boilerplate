/**
 * @file constants/errors/environment-config-user.ts
 * @description Environment Config User error message constants
 */
/**
 * Environment Config User Error Constants
 */

import type { ErrorCategory } from "./types.ts";

/**
 * Environment Config User Errors
 */
export const ENV_CONFIG_USER_ERRORS = {
  LIST_FAILED: {
    message: "Failed to list users",
    messageKey: "env-config-user.list-failed",
    statusCode: 500,
  },
  GET_FAILED: {
    message: "Failed to get user",
    messageKey: "env-config-user.get-failed",
    statusCode: 500,
  },
  PERMISSION_DENIED: {
    message: "Permission denied",
    messageKey: "env-config-user.permission-denied",
    statusCode: 403,
  },
  INVALID_PERMISSION: {
    message: "Invalid permission",
    messageKey: "env-config-user.invalid-permission",
    statusCode: 400,
  },
  ADMIN_ONLY_OPERATION: {
    message: "This operation requires admin privileges",
    messageKey: "env-config-user.admin-only-operation",
    statusCode: 403,
  },
  IDENTITY_NOT_FOUND: {
    message: "Identity not found",
    messageKey: "env-config-user.identity-not-found",
    statusCode: 404,
  },
  USERNAME_ALREADY_EXISTS: {
    message: "Username already in use",
    messageKey: "env-config-user.username-already-exists",
    statusCode: 409,
  },
  EMAIL_ALREADY_EXISTS: {
    message: "Email address already in use",
    messageKey: "env-config-user.email-already-exists",
    statusCode: 409,
  },
  CREATE_FAILED: {
    message: "Failed to create user",
    messageKey: "env-config-user.create-failed",
    statusCode: 500,
  },
  UPDATE_FAILED: {
    message: "Failed to update user",
    messageKey: "env-config-user.update-failed",
    statusCode: 500,
  },
  DELETE_FAILED: {
    message: "Failed to delete user",
    messageKey: "env-config-user.delete-failed",
    statusCode: 500,
  },
  USER_NOT_FOUND: {
    message: "User not found",
    messageKey: "env-config-user.user-not-found",
    statusCode: 404,
  },
  INVALID_ENVIRONMENT: {
    message: "Invalid environment",
    messageKey: "env-config-user.invalid-environment",
    statusCode: 400,
  },
  INVALID_IDENTITY: {
    message: "Invalid identity",
    messageKey: "env-config-user.invalid-identity",
    statusCode: 400,
  },
} as const satisfies ErrorCategory;

export type EnvConfigUserErrorKey = keyof typeof ENV_CONFIG_USER_ERRORS;
