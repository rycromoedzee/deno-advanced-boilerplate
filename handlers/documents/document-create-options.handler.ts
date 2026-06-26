/**
 * @file handlers/documents/document-create-options.handler.ts
 * @description Handler for document create options endpoint
 *
 * Returns available options for document creation:
 * - Folders (owned or with write access)
 * - Tags (owned by user)
 * - Users (for sharing, in same environment)
 */

import { RouteHandler } from "@deps";
import { getDocumentCreateOptionsRoute } from "@routes/documents/documents.route.ts";
import { getAuthContext } from "@utils/auth/context.ts";
import { getDocumentCreateOptionsService } from "@services/documents/index.ts";
import { SchemaDocumentCreateOptionsResponse } from "@models/documents/document-create-options.model.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@services/logger/index.ts";

/**
 * Handler for GET /api/documents/create-options
 * Returns available folders, tags, and users for document creation
 */
export const getDocumentCreateOptionsHandler: RouteHandler<typeof getDocumentCreateOptionsRoute> = async (c) => {
  try {
    const { userId, environmentId } = getAuthContext(c);

    const service = getDocumentCreateOptionsService();
    const options = await service.getCreateOptions(userId, environmentId);

    return c.json(SchemaDocumentCreateOptionsResponse.parse(options), 200);
  } catch (error) {
    await useLogger(LoggerLevels.error, {
      message: "Failed to fetch document create options",
      section: loggerAppSections.DOCUMENTS,
      messageKey: "document_create_options_error",
      details: { error: error instanceof Error ? error.message : String(error) },
    });

    throwHttpError("DOCUMENT.INTERNAL_SERVER_ERROR");
  }
};
