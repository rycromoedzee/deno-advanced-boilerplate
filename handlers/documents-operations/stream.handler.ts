/**
 * @file handlers/documents-operations/stream.handler.ts
 * @description Handler for SSE streaming of move operation updates
 */

import { RouteHandler } from "@deps";
import { AppHttpException, throwHttpError } from "@utils/http-exception.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { getAuthContext } from "@utils/auth/context.ts";
import { streamMoveOperationRoute } from "@routes/documents-operations/documents-operations.route.ts";
import { createMoveOperationSSEStream, getMoveOperationService } from "@services/documents-operations/index.ts";

/**
 * Handler for GET /api/documents/operations/{operationId}/stream
 * Establishes SSE connection for real-time move operation updates
 */
// stream/SSE handler — no responseSchema
export const streamMoveOperationHandler: RouteHandler<typeof streamMoveOperationRoute> = async (c) => {
  try {
    const { userId, environmentId } = getAuthContext(c);
    const { operationId } = c.req.valid("param");

    // Verify operation exists and user owns it
    const moveService = getMoveOperationService();
    const status = await moveService.getOperationStatus(operationId);

    if (!status) {
      throwHttpError("COMMON.NOT_FOUND");
    }

    if (status.userId !== userId || status.environmentId !== environmentId) {
      throwHttpError("COMMON.FORBIDDEN");
    }

    // Create SSE stream
    const stream = createMoveOperationSSEStream(operationId);

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no", // Disable nginx buffering
      },
    });
  } catch (error) {
    if (error instanceof AppHttpException) {
      throw error;
    }

    await useLogger(LoggerLevels.error, {
      message: "Failed to establish SSE stream for move operation",
      section: loggerAppSections.DOCUMENTS,
      messageKey: "move_operation_stream_error",
      details: { error: error instanceof Error ? error.message : String(error) },
    });

    throwHttpError("COMMON.INTERNAL_SERVER_ERROR");
  }
};
