/**
 * @file routes/notifications/notifications.route.ts
 * @description OpenAPI route definitions for notification inbox
 */

import { createRoute } from "@deps";
import { httpResponseInternalServerError, httpResponseNotFound, httpResponseUnauthorized } from "@utils/openapi/open-api-shared.ts";
import { OpenAPITags } from "@utils/openapi/tags.ts";
import {
  SchemaNotificationIdParam,
  SchemaNotificationListQuery,
  SchemaNotificationListResponse,
  SchemaNotificationMarkResponse,
  SchemaUnreadCountResponse,
} from "@models/notifications/index.ts";

// GET /api/notifications/stream (SSE — no OpenAPI schema needed)
export const notificationStreamRoute = createRoute({
  method: "get",
  path: "/stream",
  summary: "Stream real-time notifications via SSE",
  operationId: "notificationStream",
  description: `Opens a Server-Sent Events connection that pushes new notifications to the current user in real time.

**Behavior:** Establishes a long-lived SSE stream backed by pub/sub; sends a heartbeat every 30s. Rejects with 429 if the user already holds the per-user concurrent-connection limit.
**Auth:** cookie session
**Permissions:** none beyond auth
**Notes:** Tenant-scoped to the caller's environment; limit is 3 concurrent SSE connections per user (disconnects free slots immediately).`,
  tags: [OpenAPITags.notifications],
  responses: {
    200: {
      description: "SSE stream",
      content: { "text/event-stream": { schema: {} } },
    },
    ...httpResponseUnauthorized,
  },
});

// GET /api/notifications
export const listNotificationsRoute = createRoute({
  method: "get",
  path: "/",
  summary: "List notifications for current user",
  operationId: "notificationsList",
  description: `Returns a cursor-paginated list of the calling user's notifications, newest first.

**Behavior:** Supports filtering by status and cursor-based pagination using the createdAt of the last item.
**Auth:** cookie session
**Permissions:** none beyond auth (only the caller's own notifications)
**Notes:** Tenant-scoped to the caller's environment; page size capped at 100, default 20.`,
  tags: [OpenAPITags.notifications],
  request: {
    query: SchemaNotificationListQuery,
  },
  responses: {
    200: {
      description: "Paginated notification list",
      content: { "application/json": { schema: SchemaNotificationListResponse } },
    },
    ...httpResponseUnauthorized,
    ...httpResponseInternalServerError,
  },
});

// GET /api/notifications/unread-count
export const unreadCountRoute = createRoute({
  method: "get",
  path: "/unread-count",
  summary: "Get unread notification count",
  operationId: "notificationsUnreadCount",
  description: `Returns the number of unread notifications for the calling user, typically used for badge counts.

**Behavior:** Reads a single aggregate count scoped to the caller.
**Auth:** cookie session
**Permissions:** none beyond auth`,
  tags: [OpenAPITags.notifications],
  responses: {
    200: {
      description: "Unread count",
      content: { "application/json": { schema: SchemaUnreadCountResponse } },
    },
    ...httpResponseUnauthorized,
    ...httpResponseInternalServerError,
  },
});

// POST /api/notifications/:id/read
export const markReadRoute = createRoute({
  method: "post",
  path: "/{id}/read",
  summary: "Mark a notification as read",
  operationId: "notificationMarkRead",
  description: `Marks a single notification as read for the calling user.

**Behavior:** Sets the read flag on the notification; no-op if already read.
**Auth:** cookie session
**Permissions:** ownership (caller can only act on their own notification)
**Notes:** Returns 404 when the notification does not exist or belongs to another user.`,
  tags: [OpenAPITags.notifications],
  request: {
    params: SchemaNotificationIdParam,
  },
  responses: {
    200: {
      description: "Notification marked as read",
      content: { "application/json": { schema: SchemaNotificationMarkResponse } },
    },
    ...httpResponseUnauthorized,
    ...httpResponseNotFound,
    ...httpResponseInternalServerError,
  },
});

// POST /api/notifications/:id/dismiss
export const dismissRoute = createRoute({
  method: "post",
  path: "/{id}/dismiss",
  summary: "Dismiss a notification",
  operationId: "notificationDismiss",
  description: `Dismisses a single notification for the calling user, hiding it from the inbox.

**Behavior:** Records the dismissal timestamp on the notification.
**Auth:** cookie session
**Permissions:** ownership (caller can only act on their own notification)
**Notes:** Returns 404 when the notification does not exist or belongs to another user.`,
  tags: [OpenAPITags.notifications],
  request: {
    params: SchemaNotificationIdParam,
  },
  responses: {
    200: {
      description: "Notification dismissed",
      content: { "application/json": { schema: SchemaNotificationMarkResponse } },
    },
    ...httpResponseUnauthorized,
    ...httpResponseNotFound,
    ...httpResponseInternalServerError,
  },
});

// POST /api/notifications/read-all
export const markAllReadRoute = createRoute({
  method: "post",
  path: "/read-all",
  summary: "Mark all unread notifications as read",
  operationId: "notificationsMarkAllRead",
  description: `Marks every unread notification owned by the calling user as read.

**Behavior:** Bulk-updates all of the caller's unread notifications in one operation.
**Auth:** cookie session
**Permissions:** none beyond auth (scoped to the caller)
**Notes:** Tenant-scoped to the caller's environment.`,
  tags: [OpenAPITags.notifications],
  responses: {
    200: {
      description: "All notifications marked as read",
      content: { "application/json": { schema: SchemaNotificationMarkResponse } },
    },
    ...httpResponseUnauthorized,
    ...httpResponseInternalServerError,
  },
});

// POST /api/notifications/dismiss-all
export const dismissAllRoute = createRoute({
  method: "post",
  path: "/dismiss-all",
  summary: "Dismiss all non-dismissed notifications",
  operationId: "notificationsDismissAll",
  description: `Dismisses every notification owned by the calling user that has not already been dismissed.

**Behavior:** Bulk-dismisses all of the caller's currently visible notifications in one operation.
**Auth:** cookie session
**Permissions:** none beyond auth (scoped to the caller)
**Notes:** Tenant-scoped to the caller's environment.`,
  tags: [OpenAPITags.notifications],
  responses: {
    200: {
      description: "All notifications dismissed",
      content: { "application/json": { schema: SchemaNotificationMarkResponse } },
    },
    ...httpResponseUnauthorized,
    ...httpResponseInternalServerError,
  },
});
