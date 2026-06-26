/**
 * @file services/user/notifications/user-notifications-delete.service.ts
 * @description Delete (reset) operations for user notification preferences
 */

import { and, eq } from "@deps";
import { throwHttpError } from "@utils/http-exception.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { traced } from "@services/tracing/index.ts";
import { loggerAppSections } from "@logger/index.ts";
import { NOTIFICATION_SCOPES } from "@config/notification-catalog.ts";
import { getGlobalDB, getTenantDB, globalTables, tenantTables } from "@db/index.ts";

/**
 * Service for deleting user notification preferences.
 */
export class UserNotificationsDeleteService {
  private async getContext(userId: string) {
    const globalDb = getGlobalDB();
    const [userRow] = await globalDb.select({ environmentId: globalTables.users.environmentId })
      .from(globalTables.users)
      .where(eq(globalTables.users.id, userId))
      .limit(1);

    if (!userRow) {
      throwHttpError("USER.NOT_FOUND");
    }

    const tenantDb = await getTenantDB(userRow.environmentId);
    return { environmentId: userRow.environmentId, tenantDb, globalDb };
  }

  /**
   * Reset user notification preference
   */
  async resetUserNotificationPreference(
    userId: string,
    notificationTypeId: string,
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "UserNotificationPreferencesDelete.ResetUserPreference",
      {
        service: "UserNotificationPreferencesDelete",
        method: "resetUserPreference",
        section: loggerAppSections.NOTIFICATION_CONFIG,
        details: { userId, notificationTypeId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["user_id"] = userId;
        span.attributes["notification_type_id"] = notificationTypeId;

        const { tenantDb } = await this.getContext(userId);

        const [type] = await traced(
          "UserNotificationsDeleteService.resetUserNotificationPreference.getType",
          "db.query",
          () => {
            return tenantDb
              .select()
              .from(tenantTables.notificationTypes)
              .where(eq(tenantTables.notificationTypes.id, notificationTypeId))
              .limit(1);
          },
        );

        if (!type) {
          throwHttpError("COMMON.NOT_FOUND", "Notification type not found");
        }

        if (!type.isActive) {
          throwHttpError("VALIDATION.INVALID_FORMAT", "Notification type is inactive");
        }

        if (type.scope !== NOTIFICATION_SCOPES.USER) {
          throwHttpError(
            "AUTH.INSUFFICIENT_PERMISSIONS",
            "Cannot modify environment-scope notification preferences. Contact an administrator.",
          );
        }

        await traced(
          "UserNotificationsDeleteService.resetUserNotificationPreference.delete",
          "db.query",
          () => {
            return tenantDb
              .delete(tenantTables.userNotificationPreferences)
              .where(
                and(
                  eq(tenantTables.userNotificationPreferences.userId, userId),
                  eq(tenantTables.userNotificationPreferences.notificationTypeId, notificationTypeId),
                ),
              );
          },
        );

        span.attributes["success"] = true;
      },
      {
        logOverrides: {
          message: "Unexpected error resetting user notification preference",
          messageKey: "notifications.user_pref.reset.unexpected_error",
        },
      },
    );
  }
}
