/**
 * @file services/notifications/notification-update.service.ts
 * @description Service for marking notifications as read/dismissed (single and bulk)
 */

import { and, eq, isNull } from "@deps";

import { getTimeNowForStorage } from "@utils/shared/time.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { loggerAppSections } from "@logger/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { traced } from "@services/tracing/index.ts";
import { getTenantDB, tenantTables } from "@db/index.ts";

export class NotificationUpdateService {
  async markAsRead(notificationId: string, userId: string): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "NotificationUpdate.markAsRead",
      {
        service: "NotificationUpdate",
        method: "markAsRead",
        section: loggerAppSections.NOTIFICATIONS,
        details: { notificationId, userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["notification_id"] = notificationId;
        span.attributes["user_id"] = userId;

        const db = await getTenantDB();
        const now = getTimeNowForStorage();

        const result = await traced("NotificationUpdate.markAsRead", "db.query", () => {
          return db.update(tenantTables.notifications)
            .set({ isRead: true, updatedAt: now })
            .where(
              and(
                eq(tenantTables.notifications.id, notificationId),
                eq(tenantTables.notifications.userId, userId),
                eq(tenantTables.notifications.isRead, false),
              ),
            );
        });

        if (result.rowsAffected === 0) {
          throwHttpError("COMMON.NOT_FOUND");
        }
      },
    );
  }

  async dismiss(notificationId: string, userId: string): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "NotificationUpdate.dismiss",
      {
        service: "NotificationUpdate",
        method: "dismiss",
        section: loggerAppSections.NOTIFICATIONS,
        details: { notificationId, userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["notification_id"] = notificationId;
        span.attributes["user_id"] = userId;

        const db = await getTenantDB();
        const now = getTimeNowForStorage();

        const result = await traced("NotificationUpdate.dismiss", "db.query", () => {
          return db.update(tenantTables.notifications)
            .set({ dismissedAt: now, updatedAt: now })
            .where(
              and(
                eq(tenantTables.notifications.id, notificationId),
                eq(tenantTables.notifications.userId, userId),
                isNull(tenantTables.notifications.dismissedAt),
              ),
            );
        });

        // Idempotent: if rowsAffected is 0, check if already dismissed vs not found
        if (result.rowsAffected === 0) {
          const existing = await traced("NotificationUpdate.dismiss", "db.query", () => {
            return db.select({ id: tenantTables.notifications.id })
              .from(tenantTables.notifications)
              .where(
                and(
                  eq(tenantTables.notifications.id, notificationId),
                  eq(tenantTables.notifications.userId, userId),
                ),
              )
              .limit(1);
          });

          if (existing.length === 0) {
            throwHttpError("COMMON.NOT_FOUND");
          }
          // Already dismissed — treat as success (idempotent)
        }
      },
    );
  }

  async markAllAsRead(userId: string): Promise<number> {
    return await tracedWithServiceErrorHandling(
      "NotificationUpdate.markAllAsRead",
      {
        service: "NotificationUpdate",
        method: "markAllAsRead",
        section: loggerAppSections.NOTIFICATIONS,
        details: { userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["user_id"] = userId;

        const db = await getTenantDB();
        const now = getTimeNowForStorage();

        const result = await traced("NotificationUpdate.markAllAsRead", "db.query", () => {
          return db.update(tenantTables.notifications)
            .set({ isRead: true, updatedAt: now })
            .where(
              and(
                eq(tenantTables.notifications.userId, userId),
                eq(tenantTables.notifications.isRead, false),
                isNull(tenantTables.notifications.dismissedAt),
              ),
            );
        });

        return result.rowsAffected ?? 0;
      },
    );
  }

  async dismissAll(userId: string): Promise<number> {
    return await tracedWithServiceErrorHandling(
      "NotificationUpdate.dismissAll",
      {
        service: "NotificationUpdate",
        method: "dismissAll",
        section: loggerAppSections.NOTIFICATIONS,
        details: { userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["user_id"] = userId;

        const db = await getTenantDB();
        const now = getTimeNowForStorage();

        const result = await traced("NotificationUpdate.dismissAll", "db.query", () => {
          return db.update(tenantTables.notifications)
            .set({ dismissedAt: now, updatedAt: now })
            .where(
              and(
                eq(tenantTables.notifications.userId, userId),
                isNull(tenantTables.notifications.dismissedAt),
              ),
            );
        });

        return result.rowsAffected ?? 0;
      },
    );
  }
}
