/**
 * @file handlers/jobs/task-stream.handler.ts
 * @description Handler for streaming job status updates via SSE
 */

import { RouteHandler } from "@deps";
import { AppHttpException, throwHttpError } from "@utils/http-exception.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { getAuthContext } from "@utils/auth/context.ts";
import { streamTaskStatusRoute } from "@routes/jobs/jobs.route.ts";
import { getTaskStatusService } from "@services/background-jobs/singletons.ts";

/**
 * Handler for GET /api/jobs/:taskId/stream
 * Establishes SSE connection for real-time job status updates
 *
 * Note: Uses RouteHandler directly (not defineHandler) because SSE streams
 * return Response objects directly, not { data, status } tuples.
 */
export const streamTaskStatusHandler: RouteHandler<typeof streamTaskStatusRoute> = async (c) => {
  try {
    const { userId, environmentId } = getAuthContext(c);
    const params = c.req.valid("param");
    const taskId = params.taskId;

    // Get SSE stream from service
    return await getTaskStatusService().streamTaskStatus(
      c,
      taskId,
      userId,
      environmentId,
    );
  } catch (error) {
    if (error instanceof AppHttpException) {
      throw error;
    }

    await useLogger(LoggerLevels.error, {
      message: "Failed to establish SSE stream for job status",
      section: loggerAppSections.INTERNAL,
      messageKey: "task_stream_error",
      details: { error: error instanceof Error ? error.message : String(error) },
    });

    throwHttpError("JOBS.PROCESSING_FAILED");
  }
};
