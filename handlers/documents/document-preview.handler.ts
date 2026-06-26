/**
 * @file handlers/documents/document-preview.handler.ts
 * @description Handler for document thumbnail previews
 */

import { RouteHandler } from "@deps";
import { AppHttpException, throwHttpError } from "@utils/http-exception.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@services/logger/index.ts";
import { getAuthContext } from "@utils/auth/context.ts";
import { previewDocumentRoute } from "@routes/documents/documents.route.ts";
import { createFileStreamResponse, PREVIEW_STREAM_OPTIONS } from "@utils/streaming/index.ts";
import { getTraceContext } from "@services/tracing/index.ts";
import { ensureMinimumProcessingTime, TIMING_PROFILES } from "@utils/shared/timing.ts";
import { getDocumentDownloadService } from "@services/documents/index.ts";
import { DataAccessService } from "@services/encryption/data-access.service.ts";
import type { IEncryptionTableConfig } from "@interfaces/encryption.ts";
import { tenantTables } from "@db/index.ts";

// Table config for documents data keys
const documentsTableConfig: IEncryptionTableConfig = {
  tableName: tenantTables.documentsDataKeys,
  resourceIdColumn: "documentId",
};

/**
 * Handler for GET /api/documents/{id}/preview
 * Returns the thumbnail preview image for a document
 */
// stream/download handler — no responseSchema
export const previewDocumentHandler: RouteHandler<typeof previewDocumentRoute> = async (c) => {
  const requestStartTime = performance.now();
  const traceService = getTraceContext();

  try {
    const { userId } = getAuthContext(c);

    const { id: documentId } = c.req.valid("param");
    if (!documentId) {
      await ensureMinimumProcessingTime(requestStartTime, TIMING_PROFILES.STANDARD);
      throwHttpError("UPLOAD.DOCUMENT_ID_REQUIRED");
    }

    traceService.addBreadcrumb("handler", "Document preview requested", "info", {
      documentId,
    });

    // Get user encryption key for decrypting thumbnail
    // Pass documentId and tableConfig to ensure correct key selection based on data key's encryptionMode
    const encryptionKey = await DataAccessService.getEncryptionKeyForDataMasterKey(
      c,
      documentId,
      documentsTableConfig,
    );

    const downloadService = getDocumentDownloadService();
    const result = await downloadService.preview(documentId, userId, encryptionKey.key);

    traceService.addBreadcrumb("handler", "Document preview retrieved", "info", {
      documentId,
    });

    // Return thumbnail stream with caching headers
    return createFileStreamResponse(c, result, {
      ...PREVIEW_STREAM_OPTIONS,
      headers: {
        ...PREVIEW_STREAM_OPTIONS.headers,
        additional: {
          ...PREVIEW_STREAM_OPTIONS.headers.additional,
          "ETag": `"${documentId}-thumbnail"`,
        },
      },
      context: {
        userId,
        documentId,
      },
    });
  } catch (error) {
    await ensureMinimumProcessingTime(requestStartTime, TIMING_PROFILES.STANDARD);

    if (error instanceof AppHttpException) {
      throw error;
    }

    await useLogger(LoggerLevels.error, {
      message: "Document preview failed",
      section: loggerAppSections.DOCUMENTS_DOWNLOAD,
      messageKey: "preview_handler_error",
      raw: error,
      details: { error: error instanceof Error ? error.message : String(error) },
    });

    throwHttpError("DOCUMENT.DOWNLOAD_FAILED");
  }
};
