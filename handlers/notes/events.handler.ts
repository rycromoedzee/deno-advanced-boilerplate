/**
 * @file handlers/notes/events.handler.ts
 * @description SSE handler for note mutation events.
 * stream handler — no responseSchema
 */

import { RouteHandler } from "@deps";
import { AppHttpException, throwHttpError } from "@utils/http-exception.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { getAuthContext } from "@utils/auth/context.ts";
import { getNoteEventsStreamRoute } from "@routes/notes/events.route.ts";
import { getNoteEventsSSEService } from "@services/notes-events/singletons.ts";
import { createSSEResponse } from "@handlers/shared/create-sse-response.ts";

const MAX_SSE_CONNECTIONS_PER_USER = 3;

export const getNoteEventsStreamHandler: RouteHandler<typeof getNoteEventsStreamRoute> = async (c) => {
  try {
    const { userId, environmentId } = getAuthContext(c);
    const query = c.req.valid("query") as { noteId?: string };

    const sseService = getNoteEventsSSEService();
    await sseService.initializePubSub();
    const active = sseService.getUserConnectionCount(userId, environmentId);
    if (active >= MAX_SSE_CONNECTIONS_PER_USER) {
      throwHttpError("RATE_LIMIT.TOO_MANY_REQUESTS", {
        details: {
          activeConnections: active,
          maxAllowed: MAX_SSE_CONNECTIONS_PER_USER,
          message: "Too many concurrent note SSE connections.",
        },
      });
    }

    return createSSEResponse({
      service: sseService,
      userId,
      environmentId,
      filters: { noteId: query.noteId },
    });
  } catch (error) {
    if (error instanceof AppHttpException) throw error;
    await useLogger(LoggerLevels.error, {
      message: "Failed to establish SSE stream for note events",
      section: loggerAppSections.NOTES,
      messageKey: "notes_events_stream_error",
      details: { error: error instanceof Error ? error.message : String(error) },
    });
    throwHttpError("COMMON.INTERNAL_SERVER_ERROR");
  }
};
