/**
 * @file handlers/notifications/notification-inbox.handler.ts
 * @description Handlers for notification inbox REST endpoints
 */

import { loggerAppSections } from "@logger/index.ts";
import { defineHandler } from "@handlers/shared/handler.factory.ts";
import {
  dismissAllRoute,
  dismissRoute,
  listNotificationsRoute,
  markAllReadRoute,
  markReadRoute,
  unreadCountRoute,
} from "@routes/notifications/notifications.route.ts";
import { getNotificationListService, getNotificationUpdateService } from "@services/notifications/index.ts";
import { SchemaNotificationListResponse, SchemaNotificationMarkResponse, SchemaUnreadCountResponse } from "@models/notifications/index.ts";

const ENTITY_TYPE = "notification" as const;

const baseConfig = {
  entityType: ENTITY_TYPE,
  loggerSection: loggerAppSections.NOTIFICATIONS,
};

export const listNotificationsHandler = defineHandler(
  {
    ...baseConfig,
    route: listNotificationsRoute,
    operationName: "notification_list",
    responseSchema: SchemaNotificationListResponse,
  },
  async ({ userId, query }) => {
    const result = await getNotificationListService().list(userId, {
      cursor: query.cursor ? Number(query.cursor) : undefined,
      limit: query.limit ?? 20,
      status: query.status,
    });
    return { data: result, status: 200 };
  },
);

export const unreadCountHandler = defineHandler(
  {
    ...baseConfig,
    route: unreadCountRoute,
    operationName: "notification_unread_count",
    responseSchema: SchemaUnreadCountResponse,
  },
  async ({ userId }) => {
    const count = await getNotificationListService().getUnreadCount(userId);
    return { data: { count }, status: 200 };
  },
);

export const markReadHandler = defineHandler(
  {
    ...baseConfig,
    route: markReadRoute,
    operationName: "notification_mark_read",
    responseSchema: SchemaNotificationMarkResponse,
  },
  async ({ userId, params }) => {
    await getNotificationUpdateService().markAsRead(params.id, userId);
    return { data: { success: true }, status: 200 };
  },
);

export const dismissHandler = defineHandler(
  {
    ...baseConfig,
    route: dismissRoute,
    operationName: "notification_dismiss",
    responseSchema: SchemaNotificationMarkResponse,
  },
  async ({ userId, params }) => {
    await getNotificationUpdateService().dismiss(params.id, userId);
    return { data: { success: true }, status: 200 };
  },
);

export const markAllReadHandler = defineHandler(
  {
    ...baseConfig,
    route: markAllReadRoute,
    operationName: "notification_mark_all_read",
    responseSchema: SchemaNotificationMarkResponse,
  },
  async ({ userId }) => {
    await getNotificationUpdateService().markAllAsRead(userId);
    return { data: { success: true }, status: 200 };
  },
);

export const dismissAllHandler = defineHandler(
  {
    ...baseConfig,
    route: dismissAllRoute,
    operationName: "notification_dismiss_all",
    responseSchema: SchemaNotificationMarkResponse,
  },
  async ({ userId }) => {
    await getNotificationUpdateService().dismissAll(userId);
    return { data: { success: true }, status: 200 };
  },
);
