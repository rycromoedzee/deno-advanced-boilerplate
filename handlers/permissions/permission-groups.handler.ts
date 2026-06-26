/**
 * @file handlers/permissions/permission-groups.handler.ts
 * @description Permission-group CRUD handlers.
 *
 * Grouped (rule 7 divergence): this single file backs FIVE route files —
 *   list-groups.route.ts, read-group.route.ts, create-group.route.ts,
 *   update-group.route.ts, delete-group.route.ts.
 * Each is a thin permission-check + service call, so 1:1 file-per-route would
 * spawn five trivial files; they are kept together as one cohesive CRUD aspect.
 */

import { PAGINATION_DEFAULTS } from "@constants/pagination.ts";
import { loggerAppSections } from "@logger/index.ts";
import { createGroupRoute } from "@routes/permissions/create-group.route.ts";
import { deleteGroupRoute } from "@routes/permissions/delete-group.route.ts";
import { listGroupsRoute } from "@routes/permissions/list-groups.route.ts";
import { readGroupRoute } from "@routes/permissions/read-group.route.ts";
import { updateGroupRoute } from "@routes/permissions/update-group.route.ts";
import {
  getPermissionsCreateService,
  getPermissionsDeleteService,
  getPermissionsListService,
  getPermissionsReadService,
  getPermissionsUpdateService,
  hasPermission,
} from "@services/permissions/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { defineHandler } from "@handlers/shared/handler.factory.ts";
import {
  SchemaPermissionGroupCreateResponse,
  SchemaPermissionGroupListResponse,
  SchemaPermissionGroupReadResponse,
  SchemaPermissionGroupUpdateResponse,
} from "@models/permissions/index.ts";

const ENTITY_TYPE = "permission_group" as const;

const baseConfig = {
  entityType: ENTITY_TYPE,
  loggerSection: loggerAppSections.AUTH,
};

/**
 * List permission groups
 * GET /api/permissions/groups
 */
export const listGroupsHandler = defineHandler(
  {
    ...baseConfig,
    route: listGroupsRoute,
    operationName: "permission_groups_list",
    responseSchema: SchemaPermissionGroupListResponse,
  },
  async ({ userId, environmentId, isAdmin, query }) => {
    const hasAccess = await hasPermission(isAdmin, userId, "permissionGroups.list");
    if (!hasAccess) {
      throwHttpError("AUTH.UNAUTHORIZED");
    }

    const page = Math.max(1, parseInt(query.page as string || String(PAGINATION_DEFAULTS.DEFAULT_PAGE), 10));
    const limit = Math.min(
      PAGINATION_DEFAULTS.MAX_LIMIT,
      Math.max(1, parseInt(query.limit as string || String(PAGINATION_DEFAULTS.DEFAULT_LIMIT), 10)),
    );
    const search = query.search as string | undefined;

    const result = await getPermissionsListService().listGroups(environmentId, page, limit, search);
    return { data: result, status: 200 };
  },
);

/**
 * Read a single permission group
 * GET /api/permissions/groups/{groupId}
 */
export const readGroupHandler = defineHandler(
  {
    ...baseConfig,
    route: readGroupRoute,
    operationName: "permission_group_read",
    responseSchema: SchemaPermissionGroupReadResponse,
  },
  async ({ userId, environmentId, isAdmin, params }) => {
    const hasAccess = await hasPermission(isAdmin, userId, "permissionGroups.read");
    if (!hasAccess) {
      throwHttpError("AUTH.UNAUTHORIZED");
    }

    const group = await getPermissionsReadService().readGroup(params.groupId, environmentId);
    if (!group) {
      throwHttpError("COMMON.NOT_FOUND");
    }

    return { data: { data: group }, status: 200 };
  },
);

/**
 * Create a permission group
 * POST /api/permissions/groups
 */
export const createGroupHandler = defineHandler(
  {
    ...baseConfig,
    route: createGroupRoute,
    operationName: "permission_group_create",
    responseSchema: SchemaPermissionGroupCreateResponse,
  },
  async ({ userId, environmentId, body, isAdmin }) => {
    const hasAccess = await hasPermission(isAdmin, userId, "permissionGroups.create");
    if (!hasAccess) {
      throwHttpError("AUTH.INSUFFICIENT_PERMISSIONS");
    }

    const group = await getPermissionsCreateService().createGroup(
      userId,
      isAdmin,
      body.name,
      body.description,
      environmentId,
      body.permissions,
    );

    return { data: { group }, status: 201 };
  },
);

/**
 * Update a permission group
 * PATCH /api/permissions/groups/{groupId}
 */
export const updateGroupHandler = defineHandler(
  {
    ...baseConfig,
    route: updateGroupRoute,
    operationName: "permission_group_update",
    responseSchema: SchemaPermissionGroupUpdateResponse,
  },
  async ({ userId, environmentId, isAdmin, params, body }) => {
    const hasAccess = await hasPermission(isAdmin, userId, "permissionGroups.update");
    if (!hasAccess) {
      throwHttpError("AUTH.INSUFFICIENT_PERMISSIONS");
    }

    const group = await getPermissionsUpdateService().updateGroup(
      userId,
      isAdmin,
      params.groupId,
      environmentId,
      body.name,
      body.description,
      body.permissions,
    );

    return { data: { group }, status: 200 };
  },
);

/**
 * Delete a permission group
 * DELETE /api/permissions/groups/{groupId}
 */
export const deleteGroupHandler = defineHandler(
  {
    ...baseConfig,
    route: deleteGroupRoute,
    operationName: "permission_group_delete",
  },
  async ({ userId, environmentId, params, body, isAdmin }) => {
    const hasAccess = await hasPermission(isAdmin, userId, "permissionGroups.delete");
    if (!hasAccess) {
      throwHttpError("AUTH.INSUFFICIENT_PERMISSIONS");
    }

    const groupId = params.groupId;
    const replacementGroupId = body.replacementGroupId;

    await getPermissionsDeleteService().deleteGroup(userId, isAdmin, groupId, environmentId, replacementGroupId);

    return { status: 204 };
  },
);
