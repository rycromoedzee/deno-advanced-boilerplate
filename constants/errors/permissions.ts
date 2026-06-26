/**
 * @file constants/errors/permissions.ts
 * @description Permissions error message constants
 */
import type { ErrorCategory } from "./types.ts";

export const PERMISSION_ERRORS = {
  MISSING_PERMISSIONS: {
    message: "Missing required permissions",
    messageKey: "permissions.missing-permissions",
    statusCode: 403,
  },
};

export type PermissionErrorKey = keyof typeof PERMISSION_ERRORS;

/**
 * Permission Group Errors
 *
 * Default error keys for the permission_group entity handlers. The handler
 * factory derives keys as `PERMISSION_GROUP.<OPERATION>_FAILED` from each
 * handler's operationName (with the `permission_group_` prefix stripped).
 */
export const PERMISSION_GROUP_ERRORS = {
  PERMISSIONS_LIST_FAILED: {
    message: "Failed to list permissions",
    messageKey: "permission-group.permissions-list-failed",
    statusCode: 500,
  },
  GROUPS_LIST_FAILED: {
    message: "Failed to list permission groups",
    messageKey: "permission-group.groups-list-failed",
    statusCode: 500,
  },
  READ_FAILED: {
    message: "Failed to read permission group",
    messageKey: "permission-group.read-failed",
    statusCode: 500,
  },
  CREATE_FAILED: {
    message: "Failed to create permission group",
    messageKey: "permission-group.create-failed",
    statusCode: 500,
  },
  UPDATE_FAILED: {
    message: "Failed to update permission group",
    messageKey: "permission-group.update-failed",
    statusCode: 500,
  },
  DELETE_FAILED: {
    message: "Failed to delete permission group",
    messageKey: "permission-group.delete-failed",
    statusCode: 500,
  },
  USER_PERMISSIONS_UPDATE_FAILED: {
    message: "Failed to update user permissions",
    messageKey: "permission-group.user-permissions-update-failed",
    statusCode: 500,
  },
} as const satisfies ErrorCategory;

export type PermissionGroupErrorKey = keyof typeof PERMISSION_GROUP_ERRORS;
