/**
 * @file handlers/documents-activity-logs/activity-logs-stream.handler.ts
 * @description Handler for streaming activity logs via Server-Sent Events (SSE)
 */

import { RouteHandler } from "@deps";
import { AppHttpException, throwHttpError } from "@utils/http-exception.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { getAuthContext } from "@utils/auth/context.ts";
import { getActivityLogsStreamRoute } from "@routes/documents-activity-logs/activity-logs-stream.route.ts";
import { getDocumentSSEActivityLogService } from "@services/documents-activity-logs/index.ts";
import { createSSEResponse } from "@handlers/shared/create-sse-response.ts";
import type { IActivityLogQuery } from "@models/documents/activity-logs.model.ts";

/**
 * Maximum concurrent SSE connections per user.
 * Unlike request-based rate limiting, this counts active connections,
 * not connection attempts. Disconnects (tab close, refresh, HMR) free up slots.
 */
const MAX_SSE_CONNECTIONS_PER_USER = 3;

/**
 * Handler for GET /api/documents/activity-logs/stream
 * Establishes SSE connection for real-time activity log updates
 */
// stream/SSE handler — no responseSchema
export const getActivityLogsStreamHandler: RouteHandler<typeof getActivityLogsStreamRoute> = async (c) => {
  try {
    const { userId, environmentId } = getAuthContext(c);
    const query = c.req.valid("query") as Partial<IActivityLogQuery>;

    const sseService = getDocumentSSEActivityLogService();

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

    // Extract filters from query parameters
    const filters = {
      documentId: query.documentId,
      folderId: query.folderId,
      accessType: query.accessType,
      accessMethod: query.accessMethod,
    };

    return createSSEResponse({
      service: sseService,
      userId,
      environmentId,
      filters,
    });
  } catch (error) {
    if (error instanceof AppHttpException) {
      throw error;
    }

    await useLogger(LoggerLevels.error, {
      message: "Failed to establish SSE stream for activity logs",
      section: loggerAppSections.DOCUMENTS,
      messageKey: "activity_logs_stream_error",
      details: { error: error instanceof Error ? error.message : String(error) },
    });

    throwHttpError("DOCUMENT.ACTIVITY_LOGS_STREAM_FAILED");
  }
};
