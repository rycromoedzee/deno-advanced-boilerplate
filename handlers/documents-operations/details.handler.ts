/**
 * @file handlers/documents-operations/details.handler.ts
 * @description Handler for retrieving detailed move operation information
 */

import { RouteHandler } from "@deps";
import { AppHttpException, throwHttpError } from "@utils/http-exception.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { getAuthContext } from "@utils/auth/context.ts";
import { getMoveOperationDetailsRoute } from "@routes/documents-operations/documents-operations.route.ts";
import { getMoveOperationService } from "@services/documents-operations/index.ts";

/**
 * Handler for GET /api/documents/operations/{operationId}/details
 * Retrieves detailed information about a move operation
 */
export const getMoveOperationDetailsHandler: RouteHandler<typeof getMoveOperationDetailsRoute> = async (c) => {
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

    // Return full status with all details
    return c.json(status, 200);
  } catch (error) {
    if (error instanceof AppHttpException) {
      throw error;
    }

    await useLogger(LoggerLevels.error, {
      message: "Failed to retrieve move operation details",
      section: loggerAppSections.DOCUMENTS,
      messageKey: "move_operation_details_error",
      details: { error: error instanceof Error ? error.message : String(error) },
    });

    throwHttpError("COMMON.INTERNAL_SERVER_ERROR");
  }
};
