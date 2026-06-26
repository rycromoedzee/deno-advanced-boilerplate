/**
 * @file handlers/notifications/index.ts
 * @description Barrel for notification handlers (mirrors routes/notifications/).
 *
 * Route ↔ handler mirror:
 *   notification-preferences.handler.ts ↔ notification-preferences.route.ts (catalog + env defaults)
 *   notification-inbox.handler.ts        ↔ notifications.route.ts           (inbox REST: list/read/dismiss)
 *   notification-stream.handler.ts       ↔ notifications.route.ts           (SSE stream — no responseSchema)
 *
 * For user notification preferences, see /handlers/user/index.ts
 */

export {
  batchUpdateEnvironmentDefaultsHandler,
  getNotificationCatalogGroupedHandler,
  resetEnvironmentDefaultHandler,
  updateEnvironmentDefaultHandler,
} from "./notification-preferences.handler.ts";

export {
  dismissAllHandler,
  dismissHandler,
  listNotificationsHandler,
  markAllReadHandler,
  markReadHandler,
  unreadCountHandler,
} from "./notification-inbox.handler.ts";

export { notificationStreamHandler } from "./notification-stream.handler.ts";
