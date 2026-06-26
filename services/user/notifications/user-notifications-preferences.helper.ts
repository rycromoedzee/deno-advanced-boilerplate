/**
 * @file services/user/notifications/user-notifications-preferences.helper.ts
 * @description Helper functions for user notification preference management
 */

import { getTenantDB, tenantTables } from "@db/index.ts";
import { and, eq } from "@deps";

import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { loggerAppSections } from "@logger/index.ts";
import { NOTIFICATION_SCOPES } from "@config/notification-catalog.ts";
import { parseAvailableChannels } from "@services/notifications/notification-channels.ts";
import type { NotificationChannel } from "@services/notifications/notification-channels.ts";

/**
 * Check if a user has a notification preference enabled for a specific channel.
 *
 * @param userId - The user ID to check
 * @param notificationName - The notification type ID (e.g., "security.login.new-device")
 * @param notificationPref - Optional channel to check: "email", "inApp", or "push".
 *                           If omitted, returns true if ANY channel is enabled.
 * @returns Promise<boolean> - True if the preference is enabled
 *
 * @example
 * // Check if email notifications are enabled for login alerts
 * const emailEnabled = await hasNotificationPrefSet(environmentId, userId, "security.login.new-device", "email");
 *
 * @example
 * // Check if any channel is enabled for a notification
 * const anyEnabled = await hasNotificationPrefSet(environmentId, userId, "security.login.new-device");
 */
export async function hasNotificationPrefSet(
  environmentId: string,
  userId: string,
  notificationName: string,
  notificationPref?: NotificationChannel,
): Promise<boolean> {
  return await tracedWithServiceErrorHandling(
    "UserNotificationPreferencesHelper.hasNotificationPrefSet",
    {
      service: "UserNotificationPreferencesHelper",
      method: "hasNotificationPrefSet",
      section: loggerAppSections.NOTIFICATION_CONFIG,
      details: { userId, notificationName, notificationPref },
    },
    "COMMON.INTERNAL_SERVER_ERROR",
    async (span) => {
      span.attributes["user_id"] = userId;
      span.attributes["notification_name"] = notificationName;
      span.attributes["notification_pref"] = notificationPref ?? "any";

      const db = await getTenantDB(environmentId);

      // Get the notification type
      const [type] = await db
        .select()
        .from(tenantTables.notificationTypes)
        .where(eq(tenantTables.notificationTypes.id, notificationName))
        .limit(1);

      if (!type || !type.isActive) {
        span.attributes["notification_found"] = false;
        return false;
      }

      span.attributes["notification_found"] = true;
      span.attributes["notification_scope"] = type.scope;

      if (type.scope !== NOTIFICATION_SCOPES.USER) {
        span.attributes["scope_mismatch"] = true;
        return false;
      }

      const availableChannels = parseAvailableChannels(type.availableChannels);

      // Start from defaults
      let email = type.defaultEmail;
      let inApp = type.defaultInApp;
      let push = type.defaultPush;

      // Check user preference override
      const [userPref] = await db
        .select()
        .from(tenantTables.userNotificationPreferences)
        .where(
          and(
            eq(tenantTables.userNotificationPreferences.userId, userId),
            eq(tenantTables.userNotificationPreferences.notificationTypeId, notificationName),
          ),
        )
        .limit(1);

      if (userPref) {
        email = userPref.emailEnabled;
        inApp = userPref.inAppEnabled;
        push = userPref.pushEnabled;
        span.attributes["preference_source"] = "user";
      } else {
        span.attributes["preference_source"] = "default";
      }

      // Enforce available channels
      if (!availableChannels.has("email")) email = false;
      if (!availableChannels.has("inApp")) inApp = false;
      if (!availableChannels.has("push")) push = false;

      // Return based on requested channel or any channel
      if (notificationPref === "email") {
        span.attributes["result"] = email;
        return email;
      }
      if (notificationPref === "inApp") {
        span.attributes["result"] = inApp;
        return inApp;
      }
      if (notificationPref === "push") {
        span.attributes["result"] = push;
        return push;
      }

      // No specific channel requested - check if any is enabled
      const anyEnabled = email || inApp || push;
      span.attributes["result"] = anyEnabled;
      return anyEnabled;
    },
    {
      logOverrides: {
        message: "Unexpected error checking user notification preference",
        messageKey: "notifications.has_user_pref_set.unexpected_error",
      },
    },
  );
}
