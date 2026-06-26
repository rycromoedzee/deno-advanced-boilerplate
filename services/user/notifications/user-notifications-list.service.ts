/**
 * @file services/user/notifications/user-notifications-list.service.ts
 * @description Read operations for user notification preferences
 */

import { eq } from "@deps";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { traced } from "@services/tracing/index.ts";
import { loggerAppSections } from "@logger/index.ts";
import {
  NOTIFICATION_CATEGORY_META,
  NOTIFICATION_SCOPES,
  type NotificationCategory,
  type NotificationScope,
} from "@config/notification-catalog.ts";
import type { INotificationType } from "@models/notifications/index.ts";
import { getTenantDB, tenantTables } from "@db/index.ts";

/**
 * Service for listing user notification preferences.
 */
export class UserNotificationsListService {
  /**
   * Get notification preferences for a user (resolved defaults + overrides)
   */
  async getUserNotificationPreferences(
    userId: string,
    environmentId: string,
    isAdmin: boolean = true,
  ): Promise<INotificationType[]> {
    return await tracedWithServiceErrorHandling(
      "UserNotificationPreferencesRead.getUserNotificationPreferences",
      {
        service: "UserNotificationPreferencesRead",
        method: "getUserNotificationPreferences",
        section: loggerAppSections.NOTIFICATION_CONFIG,
        details: { userId, environmentId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["user_id"] = userId;
        span.attributes["environment_id"] = environmentId;

        const db = await getTenantDB(environmentId);

        // Fetch all notification data in parallel
        const [types, userPrefs, envDefaults] = await traced(
          "UserNotificationsListService.getUserNotificationPreferences",
          "db.query",
          () => {
            return Promise.all([
              db.select().from(tenantTables.notificationTypes).where(eq(tenantTables.notificationTypes.isActive, true)),
              db.select().from(tenantTables.userNotificationPreferences).where(eq(tenantTables.userNotificationPreferences.userId, userId)),
              db.select().from(tenantTables.environmentNotificationDefaults),
            ]);
          },
        );

        const userPrefsMap = new Map(
          userPrefs.map((p) => [p.notificationTypeId, p]),
        );

        // Note: environmentNotificationDefaults in SQLite schema doesn't have environmentId column
        // because it's per-tenant.
        const envDefaultsMap = new Map(
          envDefaults.map((d) => [d.notificationTypeId, d]),
        );

        span.attributes["types_count"] = types.length;
        span.attributes["user_prefs_count"] = userPrefs.length;
        span.attributes["env_defaults_count"] = envDefaults.length;

        // Filter out admin-scoped types for non-admin users
        const filteredTypes = isAdmin ? types : types.filter((t) => t.scope !== NOTIFICATION_SCOPES.ADMIN);

        return filteredTypes.map((t) => {
          // Start with catalog defaults
          let email = t.defaultEmail;
          let inApp = t.defaultInApp;
          let push = t.defaultPush;

          // For admin scope, apply environment overrides if present
          if (t.scope === NOTIFICATION_SCOPES.ADMIN) {
            const envDefault = envDefaultsMap.get(t.id);
            if (envDefault) {
              email = envDefault.emailEnabled;
              inApp = envDefault.inAppEnabled;
              push = envDefault.pushEnabled;
            }
          }

          // Apply user override for user scope
          if (t.scope === NOTIFICATION_SCOPES.USER) {
            const userPref = userPrefsMap.get(t.id);
            if (userPref) {
              email = userPref.emailEnabled;
              inApp = userPref.inAppEnabled;
              push = userPref.pushEnabled;
            }
          }

          return {
            id: t.id,
            category: t.category as NotificationCategory,
            scope: t.scope as NotificationScope,
            label: t.label,
            description: t.description,
            availableChannels: t.availableChannels.split(",") as (
              | "email"
              | "inApp"
              | "push"
            )[],
            defaults: {
              email,
              inApp,
              push,
            },
          };
        });
      },
      {
        logOverrides: {
          message: "Unexpected error getting user notification preferences",
          messageKey: "notifications.user_pref.read.unexpected_error",
        },
      },
    );
  }

  /**
   * Get notification preferences grouped by category
   */
  async getUserNotificationPreferencesGrouped(
    userId: string,
    environmentId: string,
    isAdmin: boolean = true,
  ): Promise<
    Array<{
      id: NotificationCategory;
      title: string;
      description: string;
      icon: string;
      scope: NotificationScope;
      types: INotificationType[];
    }>
  > {
    const types = await this.getUserNotificationPreferences(userId, environmentId, isAdmin);

    // Group by category
    const grouped = new Map<NotificationCategory, INotificationType[]>();
    for (const type of types) {
      if (!grouped.has(type.category)) {
        grouped.set(type.category, []);
      }
      grouped.get(type.category)!.push(type);
    }

    // Convert to array with metadata
    return Array.from(grouped.entries()).map(([category, types]) => ({
      id: category,
      title: NOTIFICATION_CATEGORY_META[category].title,
      description: NOTIFICATION_CATEGORY_META[category].description,
      icon: NOTIFICATION_CATEGORY_META[category].icon,
      scope: types[0]?.scope ?? NOTIFICATION_SCOPES.USER,
      types,
    }));
  }
}
