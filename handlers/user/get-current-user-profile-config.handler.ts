/**
 * @file handlers/user/get-current-user-profile-config.handler.ts
 * @description Handler for GET /user/profile-config endpoint
 */

import { defineHandler } from "@handlers/shared/handler.factory.ts";
import { loggerAppSections } from "@logger/index.ts";
import { getCurrentUserProfileConfigService } from "@services/user/index.ts";
import { getCurrentUserProfileConfigRoute } from "@routes/user/get-current-user-profile-config.route.ts";
import { SchemaCurrentUserProfileConfigResponse } from "@models/user-profile-config/index.ts";

/**
 * Get current user profile config handler
 * GET /api/user/profile-config
 */
export const getCurrentUserProfileConfigHandler = defineHandler(
  {
    route: getCurrentUserProfileConfigRoute,
    operationName: "current_user_profile_config_get",
    entityType: "user_profile_config",
    loggerSection: loggerAppSections.USER,
    responseSchema: SchemaCurrentUserProfileConfigResponse,
  },
  async ({ userId, environmentId, isAdmin }) => {
    const result = await getCurrentUserProfileConfigService(userId, environmentId, isAdmin);
    return { data: result, status: 200 };
  },
);
