/**
 * @file services/environment-config-notifications/environment-config-notifications-create.service.ts
 * @description Create/Update (upsert) operations for environment notification defaults
 */

import { getTenantDB, tenantTables } from "@db/index.ts";
import { eq, inArray } from "@deps";

import { throwHttpError, throwHttpErrorWithCustomMessage } from "@utils/http-exception.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { traced } from "@services/tracing/index.ts";
import { loggerAppSections } from "@logger/index.ts";
import { parseAvailableChannels, validateEnabledChannels } from "./environment-config-notifications-preferences.helper.ts";

// ============================================================================
// Types
// ============================================================================

export interface EnvironmentPreferenceInput {
  notificationTypeId: string;
  emailEnabled: boolean;
  inAppEnabled: boolean;
  pushEnabled: boolean;
}

// ============================================================================
// Environment Default Operations (Admin Only, Environment Scope)
// ============================================================================

/**
 * Service for creating/updating environment notification defaults.
 */
export class EnvironmentConfigNotificationsCreateService {
  private get dbPromise() {
    return getTenantDB();
  }

  /**
   * Upsert environment notification default
   * Only allowed for environment-scope notification types and admins
   */
  async upsertEnvironmentNotificationDefault(
    adminUserId: string,
    environmentId: string,
    isAdmin: boolean,
    input: EnvironmentPreferenceInput,
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "NotificationDefaultsCreate.UpsertEnvironmentDefault",
      {
        service: "NotificationDefaultsCreate",
        method: "upsertEnvironmentDefault",
        section: loggerAppSections.NOTIFICATION_CONFIG,
        details: {
          adminUserId,
          environmentId,
          notificationTypeId: input.notificationTypeId,
        },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        const db = await this.dbPromise;
        span.attributes["admin_user_id"] = adminUserId;
        span.attributes["environment_id"] = environmentId;
        span.attributes["notification_type_id"] = input.notificationTypeId;

        if (!isAdmin) {
          throwHttpError(
            "AUTH.INSUFFICIENT_PERMISSIONS",
            "Only administrators can modify environment notification defaults",
          );
        }

        // Validate notification type exists
        const [type] = await traced(
          "EnvironmentConfigNotificationsCreateService.upsertEnvironmentNotificationDefault",
          "db.query",
          () => {
            return db
              .select()
              .from(tenantTables.notificationTypes)
              .where(eq(tenantTables.notificationTypes.id, input.notificationTypeId))
              .limit(1);
          },
        );

        if (!type) {
          throwHttpErrorWithCustomMessage("COMMON.NOT_FOUND", `Notification type not found: ${input.notificationTypeId}`);
        }

        if (!type.isActive) {
          throwHttpErrorWithCustomMessage("VALIDATION.INVALID_FORMAT", `Notification type is inactive: ${input.notificationTypeId}`);
        }

        const invalidChannels = validateEnabledChannels(
          parseAvailableChannels(type.availableChannels),
          input,
        );
        if (invalidChannels.length > 0) {
          throwHttpErrorWithCustomMessage(
            "VALIDATION.INVALID_FORMAT",
            `Channels not available for notification type ${input.notificationTypeId}: ${invalidChannels.join(", ")}`,
          );
        }

        // Upsert default
        await traced(
          "EnvironmentConfigNotificationsCreateService.upsertEnvironmentNotificationDefault.upsert",
          "db.query",
          () => {
            return db
              .insert(tenantTables.environmentNotificationDefaults)
              .values({
                notificationTypeId: input.notificationTypeId,
                emailEnabled: input.emailEnabled,
                inAppEnabled: input.inAppEnabled,
                pushEnabled: input.pushEnabled,
              })
              .onConflictDoUpdate({
                target: [tenantTables.environmentNotificationDefaults.notificationTypeId],
                set: {
                  emailEnabled: input.emailEnabled,
                  inAppEnabled: input.inAppEnabled,
                  pushEnabled: input.pushEnabled,
                  updatedAt: Math.floor(Date.now() / 1000),
                },
              });
          },
        );

        span.attributes["success"] = true;
      },
      {
        logOverrides: {
          message: "Unexpected error upserting environment notification default",
          messageKey: "notifications.upsert_env_default.unexpected_error",
        },
      },
    );
  }

  /**
   * Batch upsert environment defaults in a transaction
   */
  async batchUpsertEnvironmentDefaults(
    adminUserId: string,
    environmentId: string,
    isAdmin: boolean,
    inputs: EnvironmentPreferenceInput[],
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "NotificationDefaultsCreate.BatchUpsertEnvironmentDefaults",
      {
        service: "NotificationDefaultsCreate",
        method: "batchUpsertEnvironmentDefaults",
        section: loggerAppSections.NOTIFICATION_CONFIG,
        details: { adminUserId, environmentId, count: inputs.length },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        const db = await this.dbPromise;
        span.attributes["admin_user_id"] = adminUserId;
        span.attributes["environment_id"] = environmentId;
        span.attributes["count"] = inputs.length;

        if (!isAdmin) {
          throwHttpError(
            "AUTH.INSUFFICIENT_PERMISSIONS",
            "Only administrators can modify environment notification defaults",
          );
        }

        if (inputs.length === 0) {
          return;
        }

        // Validate notification types exist
        const ids = inputs.map((i) => i.notificationTypeId);
        const types = await traced(
          "EnvironmentConfigNotificationsCreateService.batchUpsertEnvironmentDefaults.getTypes",
          "db.query",
          () => {
            return db
              .select()
              .from(tenantTables.notificationTypes)
              .where(inArray(tenantTables.notificationTypes.id, ids));
          },
        );

        const typesMap = new Map(types.map((t) => [t.id, t]));

        for (const input of inputs) {
          const type = typesMap.get(input.notificationTypeId);
          if (!type) {
            throwHttpErrorWithCustomMessage("COMMON.NOT_FOUND", `Notification type not found: ${input.notificationTypeId}`);
          }

          if (!type.isActive) {
            throwHttpErrorWithCustomMessage("VALIDATION.INVALID_FORMAT", `Notification type is inactive: ${input.notificationTypeId}`);
          }

          const invalidChannels = validateEnabledChannels(
            parseAvailableChannels(type.availableChannels),
            input,
          );
          if (invalidChannels.length > 0) {
            throwHttpErrorWithCustomMessage(
              "VALIDATION.INVALID_FORMAT",
              `Channels not available for notification type ${input.notificationTypeId}: ${invalidChannels.join(", ")}`,
            );
          }
        }

        // Batch upsert using transaction with sequential inserts
        // (Drizzle doesn't support batch insert with onConflictDoUpdate in a single query)
        await db.transaction(async (tx) => {
          for (const input of inputs) {
            await tx
              .insert(tenantTables.environmentNotificationDefaults)
              .values({
                notificationTypeId: input.notificationTypeId,
                emailEnabled: input.emailEnabled,
                inAppEnabled: input.inAppEnabled,
                pushEnabled: input.pushEnabled,
              })
              .onConflictDoUpdate({
                target: [tenantTables.environmentNotificationDefaults.notificationTypeId],
                set: {
                  emailEnabled: input.emailEnabled,
                  inAppEnabled: input.inAppEnabled,
                  pushEnabled: input.pushEnabled,
                  updatedAt: Math.floor(Date.now() / 1000),
                },
              });
          }
        });

        span.attributes["success"] = true;
      },
      {
        logOverrides: {
          message: "Unexpected error batch upserting environment defaults",
          messageKey: "notifications.batch_upsert_env.unexpected_error",
        },
      },
    );
  }
}
