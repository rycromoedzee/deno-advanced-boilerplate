/**
 * @file handlers/permissions/permissions.handler.ts
 * @description System-permissions listing + user direct-permissions handlers.
 *
 * Grouped (rule 7 divergence): this single file backs TWO route files —
 *   list-permissions.route.ts (list all system permissions)
 *   update-user-permissions.route.ts (assign direct permissions to a user)
 * Both are thin permission-check + service calls outside the group-CRUD aspect,
 * kept together rather than as two trivial one-handler files.
 */

import { loggerAppSections } from "@logger/index.ts";
import { listPermissionsRoute } from "@routes/permissions/list-permissions.route.ts";
import { updateUserPermissionsRoute } from "@routes/permissions/update-user-permissions.route.ts";
import { getPermissionsListService, getPermissionsUpdateService, hasPermission } from "@services/permissions/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { defineHandler } from "@handlers/shared/handler.factory.ts";
import { SchemaPermissionListResponse, SchemaUserPermissionsUpdateResponse } from "@models/permissions/index.ts";

const ENTITY_TYPE = "permission_group" as const;

const baseConfig = {
  entityType: ENTITY_TYPE,
  loggerSection: loggerAppSections.AUTH,
};

/**
 * List all system permissions
 * GET /api/permissions
 */
export const listPermissionsHandler = defineHandler(
  {
    ...baseConfig,
    route: listPermissionsRoute,
    operationName: "permissions_list",
    responseSchema: SchemaPermissionListResponse,
  },
  async ({ userId, isAdmin }) => {
    const hasAccess = await hasPermission(isAdmin, userId, "permissionGroups.read");
    if (!hasAccess) {
      throwHttpError("AUTH.INSUFFICIENT_PERMISSIONS");
    }

    const permissions = await getPermissionsListService().listPermissions();
    return { data: permissions, status: 200 };
  },
);

/**
 * Update user direct permissions
 * PATCH /api/permissions/users/{userId}
 */
export const updateUserPermissionsHandler = defineHandler(
  {
    ...baseConfig,
    route: updateUserPermissionsRoute,
    operationName: "user_permissions_update",
    responseSchema: SchemaUserPermissionsUpdateResponse,
  },
  async ({ userId, isAdmin, params, body }) => {
    const hasAccess = await hasPermission(isAdmin, userId, "permissionGroupsExtra.assign");
    if (!hasAccess) {
      throwHttpError("AUTH.INSUFFICIENT_PERMISSIONS");
    }

    const result = await getPermissionsUpdateService().updateUserPermissions(
      userId,
      params.userId,
      isAdmin,
      body.permissions,
      body.admin,
    );

    return { data: result, status: 200 };
  },
);
