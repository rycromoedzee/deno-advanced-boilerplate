/**
 * @file handlers/documents/document-download.handler.ts
 * @description Handler for document downloads with decryption
 */

import { RouteHandler } from "@deps";
import { AppHttpException, throwHttpError } from "@utils/http-exception.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@services/logger/index.ts";
import { getAuthContext } from "@utils/auth/context.ts";
import { downloadDocumentRoute } from "@routes/documents/documents.route.ts";
import { createFileStreamResponse, DOWNLOAD_STREAM_OPTIONS } from "@utils/streaming/index.ts";
import { getTraceContext } from "@services/tracing/index.ts";
import { ensureMinimumProcessingTime, TIMING_PROFILES } from "@utils/shared/timing.ts";

import { DataAccessService } from "@services/encryption/index.ts";
import { getDocumentDownloadService } from "@services/documents/index.ts";
import type { IEncryptionTableConfig } from "@interfaces/encryption.ts";
import { tenantTables } from "@db/index.ts";

// Table config for documents data keys
const documentsTableConfig: IEncryptionTableConfig = {
  tableName: tenantTables.documentsDataKeys,
  resourceIdColumn: "documentId",
};

/**
 * Handler for GET /api/documents/{id}/download
 * Downloads a document with decryption
 */
// stream/download handler — no responseSchema
export const downloadDocumentHandler: RouteHandler<typeof downloadDocumentRoute> = async (c) => {
  const requestStartTime = performance.now();
  const traceService = getTraceContext();

  try {
    const { userId } = getAuthContext(c);

    const { id: documentId } = c.req.valid("param");
    if (!documentId) {
      await ensureMinimumProcessingTime(requestStartTime, TIMING_PROFILES.STANDARD);
      throwHttpError("UPLOAD.DOCUMENT_ID_REQUIRED");
    }

    traceService.addBreadcrumb("handler", "Document download started", "info", {
      documentId,
    });

    const encryptionKeyResult = await DataAccessService.getEncryptionKeyForDataMasterKey(
      c,
      documentId,
      documentsTableConfig,
    );

    traceService.addBreadcrumb("handler", "Using encryption key", "info", {
      keySource: encryptionKeyResult.type,
    });

    const downloadService = getDocumentDownloadService();
    const result = await downloadService.download(
      documentId,
      userId,
      encryptionKeyResult.key,
    );

    traceService.addBreadcrumb("handler", "Document download completed", "info", {
      documentId,
    });

    // Stream the decrypted document using Hono's stream() helper.
    //
    // Previously this returned a raw `new Response(result.stream, ...)` with an
    // explicit Content-Length taken from `result.fileSize` (the DB-recorded
    // original size). Pairing a lazy decryption ReadableStream with a fixed
    // Content-Length forces fixed-length response encoding; if the emitted byte
    // count does not exactly match the declared length, the browser keeps the
    // request "pending" forever waiting for the missing bytes. It also relied on
    // the raw stream being pumped, which Hono does not guarantee for a returned
    // Response.
    //
    // createFileStreamResponse (the same path /preview uses) pipes the stream via
    // Hono's stream() API with proper abort/error handling, which is fully
    // compatible with XHR's blob responseType.
    return createFileStreamResponse(c, result, {
      ...DOWNLOAD_STREAM_OPTIONS,
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
      message: "Document download failed",
      section: loggerAppSections.DOCUMENTS_DOWNLOAD,
      messageKey: "download_handler_error",
      raw: error,
      details: { error: error instanceof Error ? error.message : String(error) },
    });

    throwHttpError("DOCUMENT.DOWNLOAD_FAILED");
  }
};
