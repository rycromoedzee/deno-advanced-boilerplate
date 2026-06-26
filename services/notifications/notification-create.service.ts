/**
 * @file services/notifications/notification-create.service.ts
 * @description Service for creating notifications with deduplication and SSE emission
 */

import { and, eq, isNull } from "@deps";

import { generateIdRandomWithTimestamp } from "@utils/database/id-generation/index.ts";
import { getTimeNowForStorage } from "@utils/shared/time.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { loggerAppSections } from "@logger/index.ts";
import { isInAppNotificationEnabled } from "./notification.helper.ts";
import type { INotificationCreateInput, INotificationSSEPayload } from "@interfaces/notification.ts";
import { getSSENotificationsService } from "./sse-notifications.service.ts";
import { traced } from "@services/tracing/index.ts";
import { getTenantDB, tenantTables } from "@db/index.ts";
import { databaseCreateWithRetry } from "@utils/database/collision-create.ts";

export class NotificationCreateService {
  /**
   * Create a notification (or update existing if duplicate) and emit via SSE.
   * Skips entirely if the user has inApp disabled for this notification type.
   */
  async createAndEmit(input: INotificationCreateInput): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "NotificationCreate.createAndEmit",
      {
        service: "NotificationCreate",
        method: "createAndEmit",
        section: loggerAppSections.NOTIFICATIONS,
        details: { userId: input.userId, type: input.type },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["user_id"] = input.userId;
        span.attributes["notification_type"] = input.type;
        span.attributes["resource_id"] = input.resourceId ?? "none";
        span.attributes["actor_id"] = input.actorId ?? "none";

        // 1. Check inApp preference
        const inAppEnabled = await isInAppNotificationEnabled(
          input.environmentId,
          input.userId,
          input.type,
        );
        if (!inAppEnabled) {
          span.attributes["in_app_enabled"] = false;
          return; // Skip entirely
        }

        const db = await getTenantDB(input.environmentId);
        const now = getTimeNowForStorage();

        // 2. Check for existing unread notification with same (userId, type, resourceId)
        let notificationId: string | undefined;
        const resourceId = input.resourceId;

        if (resourceId) {
          const [existing] = await traced("NotificationCreate.createAndEmit", "db.query", () => {
            return db.select({ id: tenantTables.notifications.id })
              .from(tenantTables.notifications)
              .where(
                and(
                  eq(tenantTables.notifications.userId, input.userId),
                  eq(tenantTables.notifications.type, input.type),
                  eq(tenantTables.notifications.resourceId, resourceId),
                  isNull(tenantTables.notifications.dismissedAt),
                  eq(tenantTables.notifications.isRead, false),
                ),
              )
              .limit(1);
          }) as [{ id: string }?];

          if (existing) {
            // Update existing notification
            notificationId = existing.id;
            await traced("NotificationCreate.createAndEmit", "db.query", async () => {
              await db.update(tenantTables.notifications)
                .set({
                  actorId: input.actorId,
                  actorName: input.actorName,
                  updatedAt: now,
                })
                .where(eq(tenantTables.notifications.id, existing.id));
            });
          }
        }

        if (!notificationId) {
          // Insert new notification
          notificationId = await traced("NotificationCreate.createAndEmit", "db.query", async () => {
            return await databaseCreateWithRetry(async (newId) => {
              await db.insert(tenantTables.notifications).values({
                id: newId,
                userId: input.userId,
                type: input.type,
                titleKey: input.titleKey,
                bodyKey: input.bodyKey,
                actionRoute: input.actionRoute,
                resourceId: input.resourceId,
                actorId: input.actorId,
                actorName: input.actorName,
                createdAt: now,
                updatedAt: now,
              });
              return newId;
            }, () => generateIdRandomWithTimestamp(16));
          });
        }

        // 3. Broadcast via SSE
        const ssePayload: INotificationSSEPayload = {
          id: notificationId,
          type: input.type,
          titleKey: input.titleKey,
          bodyKey: input.bodyKey,
          actionRoute: input.actionRoute,
          resourceId: input.resourceId,
          actorId: input.actorId,
          actorName: input.actorName,
          recipientUserId: input.userId,
          createdAt: now,
        };

        getSSENotificationsService().broadcast(ssePayload, input.userId, input.environmentId);
      },
    );
  }
}
