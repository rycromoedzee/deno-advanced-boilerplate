/**
 * @file services/environment-config-notifications/environment-config-notifications-delete.service.ts
 * @description Delete (reset) operations for environment notification defaults
 */

import { getTenantDB, tenantTables } from "@db/index.ts";
import { eq } from "@deps";

import { throwHttpError, throwHttpErrorWithCustomMessage } from "@utils/http-exception.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { traced } from "@services/tracing/index.ts";
import { loggerAppSections } from "@logger/index.ts";

/**
 * Service for deleting/resetting environment notification defaults.
 */
export class EnvironmentConfigNotificationsDeleteService {
  /**
   * Reset environment default to catalog default (delete override)
   */
  async resetEnvironmentNotificationDefault(
    adminUserId: string,
    environmentId: string,
    isAdmin: boolean,
    notificationTypeId: string,
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "NotificationDefaultsDelete.ResetEnvironmentDefault",
      {
        service: "NotificationDefaultsDelete",
        method: "resetEnvironmentDefault",
        section: loggerAppSections.NOTIFICATION_CONFIG,
        details: { adminUserId, environmentId, notificationTypeId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["admin_user_id"] = adminUserId;
        span.attributes["environment_id"] = environmentId;
        span.attributes["notification_type_id"] = notificationTypeId;

        if (!isAdmin) {
          throwHttpError(
            "AUTH.INSUFFICIENT_PERMISSIONS",
            "Only administrators can modify environment notification defaults",
          );
        }

        const db = await getTenantDB();

        const [type] = await traced(
          "EnvironmentConfigNotificationsDeleteService.resetEnvironmentNotificationDefault.getType",
          "db.query",
          () => {
            return db
              .select()
              .from(tenantTables.notificationTypes)
              .where(eq(tenantTables.notificationTypes.id, notificationTypeId))
              .limit(1);
          },
        );

        if (!type) {
          throwHttpErrorWithCustomMessage("COMMON.NOT_FOUND", `Notification type not found: ${notificationTypeId}`);
        }

        if (!type.isActive) {
          throwHttpErrorWithCustomMessage("VALIDATION.INVALID_FORMAT", `Notification type is inactive: ${notificationTypeId}`);
        }

        await traced(
          "EnvironmentConfigNotificationsDeleteService.resetEnvironmentNotificationDefault.delete",
          "db.query",
          () => {
            return db
              .delete(tenantTables.environmentNotificationDefaults)
              .where(
                eq(
                  tenantTables.environmentNotificationDefaults.notificationTypeId,
                  notificationTypeId,
                ),
              );
          },
        );

        span.attributes["success"] = true;
      },
      {
        logOverrides: {
          message: "Unexpected error resetting environment notification default",
          messageKey: "notifications.reset_env_default.unexpected_error",
        },
      },
    );
  }
}
