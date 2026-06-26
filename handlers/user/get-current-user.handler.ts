/**
 * @file handlers/user/get-current-user.handler.ts
 * @description Handler for GET /user/me endpoint
 */

import { defineHandler } from "@handlers/shared/handler.factory.ts";
import { loggerAppSections } from "@logger/index.ts";
import { getCurrentUserService } from "@services/user/index.ts";
import { getCurrentUserRoute } from "@routes/user/get-current-user.route.ts";
import { SchemaCurrentUserResponse } from "@models/environment-config-user/index.ts";

/**
 * Get current user handler
 * GET /api/user/me
 *
 * Returns the authenticated user's full profile with enhanced permission details
 */
export const getCurrentUserHandler = defineHandler(
  {
    route: getCurrentUserRoute,
    operationName: "current_user_get",
    entityType: "user",
    loggerSection: loggerAppSections.USER,
    responseSchema: SchemaCurrentUserResponse,
  },
  async ({ userId, environmentId }) => {
    const result = await getCurrentUserService(userId, environmentId);
    return { data: result, status: 200 };
  },
);
