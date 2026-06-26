/**
 * @file services/environment-config-notifications/environment-config-notifications-list.service.ts
 * @description Read operations for notification catalog and environment defaults
 */

import { getTenantDB, tenantTables } from "@db/index.ts";
import { eq } from "@deps";

import {
  NOTIFICATION_CATEGORY_META,
  NOTIFICATION_SCOPES,
  type NotificationCategory,
  type NotificationScope,
} from "@config/notification-catalog.ts";
import type { INotificationType } from "@models/notifications/index.ts";
import { traced } from "../tracing/span-utils.ts";

/**
 * Service for listing notification catalog data.
 */
export class EnvironmentConfigNotificationsListService {
  /**
   * Get all notification types from catalog with environment-level settings.
   *
   * For admin scope notifications, returns the environment override
   * if it exists, otherwise falls back to catalog defaults.
   * For user scope notifications, always returns catalog defaults
   * (since those are configurable per-user).
   *
   * @param environmentId - The environment ID to get settings for
   * @returns Notification types with resolved channel settings
   */
  async getNotificationCatalog(
    _environmentId: string,
  ): Promise<INotificationType[]> {
    const db = await getTenantDB();

    // Fetch all active notification types
    const [types, envDefaults] = await traced("EnvironmentConfigNotificationsListService.getNotificationTypes", "db.query", () => {
      return Promise.all([
        db.select().from(tenantTables.notificationTypes).where(eq(tenantTables.notificationTypes.isActive, true)),
        db.select().from(tenantTables.environmentNotificationDefaults),
      ]);
    });

    const envDefaultsMap = new Map(
      envDefaults.map((d) => [d.notificationTypeId, d]),
    );

    return types.map((t) => {
      // Start with catalog defaults
      let email = t.defaultEmail;
      let inApp = t.defaultInApp;
      let push = t.defaultPush;

      // For admin scope, check for environment override
      if (t.scope === NOTIFICATION_SCOPES.ADMIN) {
        const envDefault = envDefaultsMap.get(t.id);
        if (envDefault) {
          email = envDefault.emailEnabled;
          inApp = envDefault.inAppEnabled;
          push = envDefault.pushEnabled;
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
  }

  /**
   * Get notification types grouped by category with environment-level settings.
   *
   * @param environmentId - The environment ID to get settings for
   * @returns Categories with notification types with resolved channel settings
   */
  async getNotificationCatalogGrouped(
    environmentId: string,
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
    const types = await this.getNotificationCatalog(environmentId);

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
