/**
 * @file services/user/notifications/user-notifications-create.service.ts
 * @description User Notifications Create service (user notifications)
 */
import { eq, inArray } from "@deps";
import { throwHttpError } from "@utils/http-exception.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { traced } from "@services/tracing/index.ts";
import { loggerAppSections } from "@logger/index.ts";
import { NOTIFICATION_SCOPES } from "@config/notification-catalog.ts";
import { coerceToAvailableChannels, parseAvailableChannels } from "@services/notifications/notification-channels.ts";
import { getGlobalDB, getTenantDB, globalTables, tenantTables } from "@db/index.ts";

// ============================================================================
// Types
// ============================================================================

export interface UserPreferenceInput {
  notificationTypeId: string;
  emailEnabled: boolean;
  inAppEnabled: boolean;
  pushEnabled: boolean;
}

// ============================================================================
// User Preference Operations (User Scope Only)
// ============================================================================

/**
 * Service for creating/updating user notification preferences.  Endpoint: GET /api/task-items

  Add query params:
  - createdById: string — filter to items where createdBy == userId
  - involvedUserId: string — filter to items where the user appears in the activity log (any edit/comment/status change/assignment change). This is the "touched" filter.

  Definition of "involved": user is referenced in any task_item_activity row for the item (authored the activity entry). Alternatively: assignee, creator, commenter, or editor. Backend picks the join
  strategy that performs.
 */
export class UserNotificationsCreateService {
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
   * Upsert user notification preference
   * Only allowed for user-scope notification types
   */
  async upsertUserNotificationPreference(
    userId: string,
    input: UserPreferenceInput,
    isAdmin = false,
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "UserNotificationPreferencesCreate.UpsertUserPreference",
      {
        service: "UserNotificationPreferencesCreate",
        method: "upsertUserPreference",
        section: loggerAppSections.NOTIFICATION_CONFIG,
        details: { userId, notificationTypeId: input.notificationTypeId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["user_id"] = userId;
        span.attributes["notification_type_id"] = input.notificationTypeId;

        const { tenantDb } = await this.getContext(userId);

        // Validate notification type exists
        const [type] = await traced(
          "UserNotificationsCreateService.upsertUserNotificationPreference",
          "db.query",
          () => {
            return tenantDb
              .select()
              .from(tenantTables.notificationTypes)
              .where(eq(tenantTables.notificationTypes.id, input.notificationTypeId))
              .limit(1);
          },
        );

        if (!type) {
          throwHttpError("COMMON.NOT_FOUND", "Notification type not found");
        }

        if (!type.isActive) {
          throwHttpError("VALIDATION.INVALID_FORMAT", "Notification type is inactive");
        }

        const isUserScope = type.scope === NOTIFICATION_SCOPES.USER;
        const isAdminScope = type.scope === NOTIFICATION_SCOPES.ADMIN;

        if (!isUserScope && !(isAdminScope && isAdmin)) {
          throwHttpError(
            "AUTH.INSUFFICIENT_PERMISSIONS",
            "Cannot modify environment-scope notification preferences. Contact an administrator.",
          );
        }

        // Coerce unavailable channels to false
        const coerced = coerceToAvailableChannels(
          parseAvailableChannels(type.availableChannels),
          input,
        );

        // Upsert preference
        await traced(
          "UserNotificationsCreateService.upsertUserNotificationPreference.upsert",
          "db.query",
          () => {
            return tenantDb
              .insert(tenantTables.userNotificationPreferences)
              .values({
                userId,
                notificationTypeId: input.notificationTypeId,
                emailEnabled: coerced.emailEnabled,
                inAppEnabled: coerced.inAppEnabled,
                pushEnabled: coerced.pushEnabled,
              })
              .onConflictDoUpdate({
                target: [tenantTables.userNotificationPreferences.userId, tenantTables.userNotificationPreferences.notificationTypeId],
                set: {
                  emailEnabled: coerced.emailEnabled,
                  inAppEnabled: coerced.inAppEnabled,
                  pushEnabled: coerced.pushEnabled,
                },
              });
          },
        );

        span.attributes["success"] = true;
      },
      {
        logOverrides: {
          message: "Unexpected error upserting user notification preference",
          messageKey: "notifications.user_pref.upsert.unexpected_error",
        },
      },
    );
  }

  /**
   * Batch upsert user preferences
   */
  async batchUpsertUserPreferences(
    userId: string,
    inputs: UserPreferenceInput[],
    isAdmin = false,
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "UserNotificationPreferencesCreate.BatchUpsertUserPreferences",
      {
        service: "UserNotificationPreferencesCreate",
        method: "batchUpsertUserPreferences",
        section: loggerAppSections.NOTIFICATION_CONFIG,
        details: { userId, count: inputs.length },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["user_id"] = userId;
        span.attributes["count"] = inputs.length;

        const { tenantDb } = await this.getContext(userId);

        if (inputs.length === 0) {
          return;
        }

        // Validate notification types exist
        const ids = inputs.map((i) => i.notificationTypeId);
        const types = await traced(
          "UserNotificationsCreateService.batchUpsertUserPreferences.getTypes",
          "db.query",
          () => {
            return tenantDb
              .select()
              .from(tenantTables.notificationTypes)
              .where(inArray(tenantTables.notificationTypes.id, ids));
          },
        );

        const typesMap = new Map(types.map((t) => [t.id, t]));

        for (const input of inputs) {
          const type = typesMap.get(input.notificationTypeId);
          if (!type) {
            throwHttpError("COMMON.NOT_FOUND", "Notification type not found");
          }

          if (!type.isActive) {
            throwHttpError("VALIDATION.INVALID_FORMAT", "Notification type is inactive");
          }

          const isUserScope = type.scope === NOTIFICATION_SCOPES.USER;
          const isAdminScope = type.scope === NOTIFICATION_SCOPES.ADMIN;

          if (!isUserScope && !(isAdminScope && isAdmin)) {
            throwHttpError(
              "AUTH.INSUFFICIENT_PERMISSIONS",
              "Cannot modify environment-scope notification preferences. Contact an administrator.",
            );
          }
        }

        // Coerce unavailable channels to false for each input
        const coercedInputs = inputs.map((input) => {
          const type = typesMap.get(input.notificationTypeId)!;
          const coerced = coerceToAvailableChannels(
            parseAvailableChannels(type.availableChannels),
            input,
          );
          return { ...input, ...coerced };
        });

        await tenantDb.transaction(async (tx) => {
          for (const input of coercedInputs) {
            await tx
              .insert(tenantTables.userNotificationPreferences)
              .values({
                userId,
                notificationTypeId: input.notificationTypeId,
                emailEnabled: input.emailEnabled,
                inAppEnabled: input.inAppEnabled,
                pushEnabled: input.pushEnabled,
              })
              .onConflictDoUpdate({
                target: [tenantTables.userNotificationPreferences.userId, tenantTables.userNotificationPreferences.notificationTypeId],
                set: {
                  emailEnabled: input.emailEnabled,
                  inAppEnabled: input.inAppEnabled,
                  pushEnabled: input.pushEnabled,
                },
              });
          }
        });

        span.attributes["success"] = true;
      },
      {
        logOverrides: {
          message: "Unexpected error batch upserting user preferences",
          messageKey: "notifications.user_pref.batch_upsert.unexpected_error",
        },
      },
    );
  }
}
