/**
 * @file services/notifications/notification-list.service.ts
 * @description Service for listing notifications and getting unread count
 */

import { and, count, desc, eq, isNull, lte, sql } from "@deps";

import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { loggerAppSections } from "@logger/index.ts";
import { traced } from "@services/tracing/index.ts";
import { getTenantDB, tenantTables } from "@db/index.ts";

export class NotificationListService {
  async list(
    userId: string,
    options: { cursor?: number; limit: number; status?: "unread" | "read" | "dismissed" },
  ) {
    return await tracedWithServiceErrorHandling(
      "NotificationList.list",
      {
        service: "NotificationList",
        method: "list",
        section: loggerAppSections.NOTIFICATIONS,
        details: { userId, status: options.status, limit: options.limit },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["user_id"] = userId;
        span.attributes["limit"] = options.limit;

        const db = await getTenantDB();

        // Build WHERE conditions based on status filter
        const conditions = [eq(tenantTables.notifications.userId, userId)];

        if (options.status === "unread") {
          conditions.push(eq(tenantTables.notifications.isRead, false));
          conditions.push(isNull(tenantTables.notifications.dismissedAt));
        } else if (options.status === "read") {
          conditions.push(eq(tenantTables.notifications.isRead, true));
          conditions.push(isNull(tenantTables.notifications.dismissedAt));
        } else if (options.status === "dismissed") {
          conditions.push(sql`${tenantTables.notifications.dismissedAt} IS NOT NULL`);
        } else {
          // Default: exclude dismissed notifications
          conditions.push(isNull(tenantTables.notifications.dismissedAt));
        }

        // Add cursor
        if (options.cursor) {
          conditions.push(lte(tenantTables.notifications.createdAt, options.cursor));
        }

        const whereClause = and(...conditions);

        const rows = await traced("NotificationList.list", "db.query", () => {
          return db.select()
            .from(tenantTables.notifications)
            .where(whereClause)
            .orderBy(desc(tenantTables.notifications.createdAt))
            .limit(options.limit + 1); // Fetch one extra to determine if there's a next page
        });

        const hasMore = rows.length > options.limit;
        const items = hasMore ? rows.slice(0, options.limit) : rows;
        const nextCursor = hasMore ? items[items.length - 1].createdAt : null;

        return { notifications: items, nextCursor };
      },
    );
  }

  async getUnreadCount(userId: string): Promise<number> {
    return await tracedWithServiceErrorHandling(
      "NotificationList.getUnreadCount",
      {
        service: "NotificationList",
        method: "getUnreadCount",
        section: loggerAppSections.NOTIFICATIONS,
        details: { userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["user_id"] = userId;

        const db = await getTenantDB();

        const [result] = await traced("NotificationList.getUnreadCount", "db.query", () => {
          return db.select({ count: count() })
            .from(tenantTables.notifications)
            .where(
              and(
                eq(tenantTables.notifications.userId, userId),
                eq(tenantTables.notifications.isRead, false),
                isNull(tenantTables.notifications.dismissedAt),
              ),
            );
        });

        return result?.count ?? 0;
      },
    );
  }
}
