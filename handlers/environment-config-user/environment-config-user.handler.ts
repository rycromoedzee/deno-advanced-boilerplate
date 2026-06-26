/**
 * @file handlers/environment-config-user/environment-config-user.handler.ts
 * @description Environment-config user-management handlers
 *   (mirrors routes/environment-config-user/environment-config-user.route.ts).
 */

import {
  getEnvironmentConfigUserCreateService,
  getEnvironmentConfigUserDeleteService,
  getEnvironmentConfigUserListService,
  getEnvironmentConfigUserReadService,
  getEnvironmentConfigUserUpdateService,
} from "@services/environment-config-user/index.ts";
import {
  createUserRoute,
  deleteUserRoute,
  getUserRoute,
  listUsersRoute,
  updateUserRoute,
} from "@routes/environment-config-user/environment-config-user.route.ts";
import { loggerAppSections } from "@logger/index.ts";
import { defineHandler } from "@handlers/shared/handler.factory.ts";

import {
  SchemaEnvironmentConfigUserCreateResponse,
  SchemaEnvironmentConfigUserDeleteResponse,
  SchemaEnvironmentConfigUserListResponse,
  SchemaEnvironmentConfigUserResponse,
  SchemaEnvironmentConfigUserUpdateResponse,
} from "@models/environment-config-user/index.ts";

const ENTITY_TYPE = "env_config_user" as const;

const baseConfig = {
  entityType: ENTITY_TYPE,
  loggerSection: loggerAppSections.ENV_CONFIG_USER,
};

/**
 * List users handler
 * GET /api/environment-config/users
 */
export const listUsersHandler = defineHandler(
  {
    ...baseConfig,
    route: listUsersRoute,
    operationName: "env_config_user_list",
    responseSchema: SchemaEnvironmentConfigUserListResponse,
  },
  async ({ userId, environmentId, query, isAdmin }) => {
    const result = await getEnvironmentConfigUserListService().listUsers(
      environmentId,
      query,
      userId,
      isAdmin,
    );
    return { data: result, status: 200 };
  },
);

/**
 * Create user handler
 * POST /api/environment-config/users
 */
export const createUserHandler = defineHandler(
  {
    ...baseConfig,
    route: createUserRoute,
    operationName: "env_config_user_create",
    responseSchema: SchemaEnvironmentConfigUserCreateResponse,
  },
  async ({ userId, environmentId, isAdmin, body, fullName }) => {
    const result = await getEnvironmentConfigUserCreateService().createUser(
      userId,
      fullName,
      isAdmin,
      environmentId,
      body,
    );
    return { data: result, status: 201 };
  },
);

/**
 * Get user handler
 * GET /api/environment-config/users/{userId}
 */
export const getUserHandler = defineHandler(
  {
    ...baseConfig,
    route: getUserRoute,
    operationName: "env_config_user_get",
    responseSchema: SchemaEnvironmentConfigUserResponse,
  },
  async ({ params, environmentId }) => {
    const result = await getEnvironmentConfigUserReadService().getUserById(
      params.userId,
      environmentId,
    );
    return { data: result, status: 200 };
  },
);

/**
 * Update user handler
 * PATCH /api/environment-config/users/{userId}
 */
export const updateUserHandler = defineHandler(
  {
    ...baseConfig,
    route: updateUserRoute,
    operationName: "env_config_user_update",
    responseSchema: SchemaEnvironmentConfigUserUpdateResponse,
  },
  async ({ params, environmentId, body, userId, isAdmin }) => {
    const result = await getEnvironmentConfigUserUpdateService().updateUser(
      params.userId,
      environmentId,
      body,
      userId,
      isAdmin,
    );
    return { data: result, status: 200 };
  },
);

/**
 * Delete user handler
 * DELETE /api/environment-config/users/{userId}
 */
export const deleteUserHandler = defineHandler(
  {
    ...baseConfig,
    route: deleteUserRoute,
    operationName: "env_config_user_delete",
    responseSchema: SchemaEnvironmentConfigUserDeleteResponse,
  },
  async ({ params, environmentId, userId, isAdmin }) => {
    await getEnvironmentConfigUserDeleteService().deleteUser(
      params.userId,
      environmentId,
      userId,
      isAdmin,
    );
    return { data: { success: true, message: "User deleted successfully" }, status: 200 };
  },
);
