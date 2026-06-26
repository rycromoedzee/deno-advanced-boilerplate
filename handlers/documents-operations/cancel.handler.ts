/**
 * @file handlers/documents-operations/cancel.handler.ts
 * @description Handler for cancelling move operations
 */

import { RouteHandler } from "@deps";
import { AppHttpException, throwHttpError } from "@utils/http-exception.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { getAuthContext } from "@utils/auth/context.ts";
import { cancelMoveOperationRoute } from "@routes/documents-operations/documents-operations.route.ts";
import { getMoveOperationService } from "@services/documents-operations/index.ts";

/**
 * Handler for DELETE /api/documents/operations/{operationId}
 * Cancels a pending or in-progress move operation
 */
export const cancelMoveOperationHandler: RouteHandler<typeof cancelMoveOperationRoute> = async (c) => {
  try {
    const { userId, environmentId } = getAuthContext(c);
    const { operationId } = c.req.valid("param");

    const moveService = getMoveOperationService();
    const status = await moveService.getOperationStatus(operationId);

    if (!status) {
      throwHttpError("COMMON.NOT_FOUND");
    }

    // Verify user owns this operation
    if (status.userId !== userId || status.environmentId !== environmentId) {
      throwHttpError("COMMON.FORBIDDEN");
    }

    // Only allow cancelling pending or processing operations
    if (status.status !== "pending" && status.status !== "processing") {
      throwHttpError("COMMON.BAD_REQUEST");
    }

    await moveService.markCancelled(operationId, "Cancelled by user");

    return c.body(null, 204);
  } catch (error) {
    if (error instanceof AppHttpException) {
      throw error;
    }

    await useLogger(LoggerLevels.error, {
      message: "Failed to cancel move operation",
      section: loggerAppSections.DOCUMENTS,
      messageKey: "move_operation_cancel_error",
      details: { error: error instanceof Error ? error.message : String(error) },
    });

    throwHttpError("COMMON.INTERNAL_SERVER_ERROR");
  }
};
