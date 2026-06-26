/**
 * @file handlers/notifications/notification-stream.handler.ts
 * @description SSE handler for real-time notification streaming
 * stream handler — no responseSchema
 */

import { RouteHandler } from "@deps";
import { AppHttpException, throwHttpError } from "@utils/http-exception.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { getAuthContext } from "@utils/auth/context.ts";
import { notificationStreamRoute } from "@routes/notifications/notifications.route.ts";
import { createSSEResponse } from "@handlers/shared/create-sse-response.ts";
import { getSSENotificationsService } from "@services/notifications/index.ts";

/**
 * Maximum concurrent SSE connections per user.
 * Unlike request-based rate limiting, this counts active connections,
 * not connection attempts. Disconnects (tab close, refresh, HMR) free up slots.
 */
const MAX_SSE_CONNECTIONS_PER_USER = 3;

export const notificationStreamHandler: RouteHandler<typeof notificationStreamRoute> = async (c) => {
  try {
    const { userId, environmentId } = getAuthContext(c);

    const sseService = getSSENotificationsService();
    await sseService.initializePubSub();

    // Check concurrent connection count BEFORE creating the SSE response.
    // This uses the service's built-in connection tracking, which accurately
    // reflects active connections (disconnects decrement the count immediately).
    const activeConnections = sseService.getUserConnectionCount(userId, environmentId);
    if (activeConnections >= MAX_SSE_CONNECTIONS_PER_USER) {
      throwHttpError("RATE_LIMIT.TOO_MANY_REQUESTS", {
        details: {
          activeConnections,
          maxAllowed: MAX_SSE_CONNECTIONS_PER_USER,
          message: "Too many concurrent SSE connections. Close other tabs and try again.",
        },
      });
    }

    return createSSEResponse({
      service: sseService,
      userId,
      environmentId,
      heartbeatIntervalMs: 30000,
    });
  } catch (error) {
    if (error instanceof AppHttpException) {
      throw error;
    }

    await useLogger(LoggerLevels.error, {
      message: "Failed to establish SSE stream for notifications",
      section: loggerAppSections.NOTIFICATIONS,
      messageKey: "notifications_stream_error",
      details: { error: error instanceof Error ? error.message : String(error) },
    });

    throwHttpError("COMMON.INTERNAL_SERVER_ERROR");
  }
};
