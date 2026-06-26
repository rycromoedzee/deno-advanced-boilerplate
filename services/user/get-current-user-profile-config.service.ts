/**
 * @file services/user/get-current-user-profile-config.service.ts
 * @description Service to get current user profile config data
 */

import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { loggerAppSections } from "@logger/index.ts";
import { getCurrentUserService } from "./get-current-user.service.ts";
import { PasskeyManagementService } from "./passkey-management.service.ts";
import { getUserNotificationsListService } from "./notifications/index.ts";
import type { ICurrentUserProfileConfigResponse } from "@models/user-profile-config/index.ts";

let passkeyManagementService: PasskeyManagementService | null = null;

function getPasskeyManagementService(): PasskeyManagementService {
  if (!passkeyManagementService) {
    passkeyManagementService = new PasskeyManagementService();
  }
  return passkeyManagementService;
}

/**
 * Get current user profile configuration
 * @param userId - The authenticated user's ID
 * @param environmentId - The current environment ID
 * @returns Profile config with passkeys and notification preferences
 */
export async function getCurrentUserProfileConfigService(
  userId: string,
  environmentId: string,
  isAdmin: boolean,
): Promise<ICurrentUserProfileConfigResponse> {
  return await tracedWithServiceErrorHandling(
    "GetCurrentUserProfileConfig.getCurrentUserProfileConfig",
    {
      service: "GetCurrentUserProfileConfigService",
      method: "getCurrentUserProfileConfig",
      section: loggerAppSections.USER,
      details: { userId, environmentId },
    },
    "COMMON.INTERNAL_SERVER_ERROR",
    async (span) => {
      span.attributes["user_id"] = userId;
      span.attributes["environment_id"] = environmentId;

      const passkeyService = getPasskeyManagementService();
      const notificationService = getUserNotificationsListService();

      const [user, passkeys, categories] = await Promise.all([
        getCurrentUserService(userId, environmentId),
        passkeyService.listPasskeys(userId),
        notificationService.getUserNotificationPreferencesGrouped(userId, environmentId, isAdmin),
      ]);

      span.attributes["passkey_count"] = passkeys.length;
      span.attributes["notification_category_count"] = categories.length;
      span.attributes["permission_count"] = user.permissions.length;

      // PRF setup is required when any passkey is missing PRF configuration
      const passkeysRequirePrfSetup = passkeys.length > 0 && passkeys.some((p) => !p.hasPrf);

      return {
        user,
        passkeys,
        passkeysRequirePrfSetup,
        notificationPreferences: { categories },
      };
    },
    {
      logOverrides: {
        message: "Unexpected error getting current user profile config",
        messageKey: "user.profile_config.unexpected_error",
      },
    },
  );
}
