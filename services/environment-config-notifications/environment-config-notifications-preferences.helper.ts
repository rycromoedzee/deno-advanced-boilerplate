/**
 * @file services/environment-config-notifications/environment-config-notifications-preferences.helper.ts
 * @description Helper functions for notification preference management
 */

import { getTenantDB, tenantTables } from "@db/index.ts";
import { eq } from "@deps";

import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { loggerAppSections } from "@logger/index.ts";
import { NOTIFICATION_SCOPES } from "@config/notification-catalog.ts";
import { parseAvailableChannels } from "@services/notifications/notification-channels.ts";
import type { NotificationChannel } from "@services/notifications/notification-channels.ts";

// Channel parsing/coercion/validation logic lives in the shared module below.
// Re-exported here so existing importers keep resolving without churn.
export {
  coerceToAvailableChannels,
  parseAvailableChannels,
  validateEnabledChannels,
} from "@services/notifications/notification-channels.ts";
export type { NotificationChannel, PreferenceInputBase } from "@services/notifications/notification-channels.ts";

/**
 * Check if an environment notification preference is enabled for a specific channel.
 *
 * @param environmentId - The environment ID to check
 * @param notificationName - The notification type ID (e.g., "document.uploaded")
 * @param notificationPref - Optional channel to check: "email", "inApp", or "push".
 *                           If omitted, returns true if ANY channel is enabled.
 * @returns Promise<boolean> - True if the preference is enabled
 */
export async function hasNotificationAdminPrefSet(
  environmentId: string,
  notificationName: string,
  notificationPref?: NotificationChannel,
): Promise<boolean> {
  return await tracedWithServiceErrorHandling(
    "NotificationPreferencesHelper.hasNotificationAdminPrefSet",
    {
      service: "NotificationPreferencesHelper",
      method: "hasNotificationAdminPrefSet",
      section: loggerAppSections.NOTIFICATION_CONFIG,
      details: { environmentId, notificationName, notificationPref },
    },
    "COMMON.INTERNAL_SERVER_ERROR",
    async (span) => {
      span.attributes["environment_id"] = environmentId;
      span.attributes["notification_name"] = notificationName;
      span.attributes["notification_pref"] = notificationPref ?? "any";

      const db = await getTenantDB();

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

      if (type.scope !== NOTIFICATION_SCOPES.ADMIN) {
        span.attributes["scope_mismatch"] = true;
        return false;
      }

      const availableChannels = parseAvailableChannels(type.availableChannels);

      // Start from defaults
      let email = type.defaultEmail;
      let inApp = type.defaultInApp;
      let push = type.defaultPush;

      const [envPref] = await db
        .select()
        .from(tenantTables.environmentNotificationDefaults)
        .where(
          eq(tenantTables.environmentNotificationDefaults.notificationTypeId, notificationName),
        )
        .limit(1);

      if (envPref) {
        email = envPref.emailEnabled;
        inApp = envPref.inAppEnabled;
        push = envPref.pushEnabled;
        span.attributes["preference_source"] = "environment";
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
        message: "Unexpected error checking admin notification preference",
        messageKey: "notifications.has_admin_pref_set.unexpected_error",
      },
    },
  );
}

/**
 * Validate that a notification type ID exists in the catalog
 */
export async function validateNotificationTypeExists(
  notificationTypeId: string,
): Promise<boolean> {
  const db = await getTenantDB();
  const [type] = await db
    .select({ id: tenantTables.notificationTypes.id })
    .from(tenantTables.notificationTypes)
    .where(eq(tenantTables.notificationTypes.id, notificationTypeId))
    .limit(1);

  return !!type;
}

/**
 * Get notification type by ID
 */
export async function getNotificationTypeById(
  notificationTypeId: string,
): Promise<typeof tenantTables.notificationTypes.$inferSelect | null> {
  const db = await getTenantDB();
  const [type] = await db
    .select()
    .from(tenantTables.notificationTypes)
    .where(eq(tenantTables.notificationTypes.id, notificationTypeId))
    .limit(1);

  return type ?? null;
}
