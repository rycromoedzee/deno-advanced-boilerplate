/**
 * @file routes/notifications/index.ts
 * @description Notification configuration routes
 *
 * This module contains:
 * - Catalog routes (notification types)
 * - Environment defaults routes (admin-only)
 * - Inbox routes (list, read, dismiss, SSE stream)
 *
 * For user notification preferences, see /routes/user/index.ts
 */

import { createRateLimitedApp } from "@utils/openapi/openapi-wrapper.ts";

// Routes
import {
  batchUpdateEnvironmentDefaultsRoute,
  getNotificationCatalogGroupedRoute,
  resetEnvironmentDefaultRoute,
  updateEnvironmentDefaultRoute,
} from "./notification-preferences.route.ts";

import {
  dismissAllRoute,
  dismissRoute,
  listNotificationsRoute,
  markAllReadRoute,
  markReadRoute,
  notificationStreamRoute,
  unreadCountRoute,
} from "./notifications.route.ts";

// Handlers
import {
  batchUpdateEnvironmentDefaultsHandler,
  dismissAllHandler,
  dismissHandler,
  getNotificationCatalogGroupedHandler,
  listNotificationsHandler,
  markAllReadHandler,
  markReadHandler,
  notificationStreamHandler,
  resetEnvironmentDefaultHandler,
  unreadCountHandler,
  updateEnvironmentDefaultHandler,
} from "@handlers/notifications/index.ts";

// Rate limit configuration
const STANDARD_RATE_LIMIT = {
  max: 100,
  window: 60 * 1000, // 1 minute
  enableIPBasedAdjustment: true,
  suspiciousIPMultiplier: 0.3,
};

const WRITE_RATE_LIMIT = {
  max: 30,
  window: 60 * 1000,
  enableIPBasedAdjustment: true,
  suspiciousIPMultiplier: 0.3,
};

const notificationsApp = createRateLimitedApp();

// =====================================
// Catalog (Read)
// =====================================

notificationsApp.openapiWithRateLimit(
  getNotificationCatalogGroupedRoute,
  getNotificationCatalogGroupedHandler,
  STANDARD_RATE_LIMIT,
);

// =====================================
// Environment Defaults (Admin Only)
// =====================================

notificationsApp.openapiWithRateLimit(
  batchUpdateEnvironmentDefaultsRoute,
  batchUpdateEnvironmentDefaultsHandler,
  WRITE_RATE_LIMIT,
);

notificationsApp.openapiWithRateLimit(
  updateEnvironmentDefaultRoute,
  updateEnvironmentDefaultHandler,
  WRITE_RATE_LIMIT,
);

notificationsApp.openapiWithRateLimit(
  resetEnvironmentDefaultRoute,
  resetEnvironmentDefaultHandler,
  WRITE_RATE_LIMIT,
);

// =====================================
// Inbox routes (read)
// =====================================

notificationsApp.openapiWithRateLimit(
  listNotificationsRoute,
  listNotificationsHandler,
  STANDARD_RATE_LIMIT,
);

notificationsApp.openapiWithRateLimit(
  unreadCountRoute,
  unreadCountHandler,
  STANDARD_RATE_LIMIT,
);

// =====================================
// Inbox routes (write)
// =====================================

notificationsApp.openapiWithRateLimit(
  markReadRoute,
  markReadHandler,
  WRITE_RATE_LIMIT,
);

notificationsApp.openapiWithRateLimit(
  dismissRoute,
  dismissHandler,
  WRITE_RATE_LIMIT,
);

notificationsApp.openapiWithRateLimit(
  markAllReadRoute,
  markAllReadHandler,
  WRITE_RATE_LIMIT,
);

notificationsApp.openapiWithRateLimit(
  dismissAllRoute,
  dismissAllHandler,
  WRITE_RATE_LIMIT,
);

// =====================================
// SSE stream
// =====================================

// SSE uses concurrency-based limiting in the handler (not request-count rate limiting).
// This prevents penalizing users for disconnects (refresh, HMR, tab close) since
// the connection count is decremented immediately when connections close.
// See notification-stream.handler.ts for the MAX_SSE_CONNECTIONS_PER_USER check.
notificationsApp.openapi(
  notificationStreamRoute,
  notificationStreamHandler,
);

export default notificationsApp;
